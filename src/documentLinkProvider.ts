import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getProtoImportSearchRoots } from "./utils/protoImportRoots";

const RE_IMPORT = /^\s*import\s+(?:weak|public)?\s*["']([^"']+\.proto)["']\s*;/;

/**
 * Makes import "path/to/file.proto" clickable; resolves path relative to current file or workspace.
 */
export class ProtoDocumentLinkProvider implements vscode.DocumentLinkProvider {
	async provideDocumentLinks(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): Promise<vscode.DocumentLink[]> {
		const links: vscode.DocumentLink[] = [];
		const docDir = path.dirname(document.uri.fsPath);
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const extraRoots = await getProtoImportSearchRoots(undefined);

		for (let i = 0; i < document.lineCount; i++) {
			if (token.isCancellationRequested) {
				break;
			}
			const line = document.lineAt(i);
			const match = line.text.match(RE_IMPORT);
			if (!match) {
				continue;
			}

			const importPath = match[1];
			const importKeywordIdx = line.text.indexOf("import");
			if (importKeywordIdx === -1) {
				continue;
			}

			// Try double-quoted import first
			const dqStart = line.text.indexOf('"', importKeywordIdx);
			if (dqStart !== -1) {
				const dqEnd = line.text.indexOf('"', dqStart + 1);
				if (dqEnd !== -1) {
					const range = new vscode.Range(i, dqStart + 1, i, dqEnd);
					const target = this.resolveImport(
						importPath,
						docDir,
						workspaceRoot,
						extraRoots,
					);
					if (target) {
						links.push(new vscode.DocumentLink(range, target));
					}
					continue;
				}
			}

			// Fallback: single-quoted import
			const sqStart = line.text.indexOf("'", importKeywordIdx);
			if (sqStart !== -1) {
				const sqEnd = line.text.indexOf("'", sqStart + 1);
				if (sqEnd !== -1) {
					const range = new vscode.Range(i, sqStart + 1, i, sqEnd);
					const target = this.resolveImport(
						importPath,
						docDir,
						workspaceRoot,
						extraRoots,
					);
					if (target) {
						links.push(new vscode.DocumentLink(range, target));
					}
				}
			}
		}
		return links;
	}

	private resolveImport(
		importPath: string,
		docDir: string,
		workspaceRoot: string | undefined,
		extraRoots: string[],
	): vscode.Uri | undefined {
		const candidates: string[] = [
			path.join(docDir, importPath),
			...(workspaceRoot ? [path.join(workspaceRoot, importPath)] : []),
			...(workspaceRoot
				? [path.join(workspaceRoot, path.basename(importPath))]
				: []),
		];
		for (const root of extraRoots) {
			candidates.push(path.join(root, importPath));
		}

		for (const candidate of candidates) {
			try {
				if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
					return vscode.Uri.file(candidate);
				}
			} catch {
				// skip
			}
		}
		return undefined;
	}
}
