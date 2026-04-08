import * as path from "node:path";
import * as vscode from "vscode";

const RE_IMPORT = /^\s*import\s+(?:weak|public)?\s*["']([^"']+\.proto)["']\s*;/;

/**
 * Makes import "path/to/file.proto" clickable; resolves path relative to current file or workspace.
 */
export class ProtoDocumentLinkProvider implements vscode.DocumentLinkProvider {
	provideDocumentLinks(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.DocumentLink[]> {
		const links: vscode.DocumentLink[] = [];
		const docDir = path.dirname(document.uri.fsPath);
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

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
					const target = this.resolveImport(importPath, docDir, workspaceRoot);
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
					const target = this.resolveImport(importPath, docDir, workspaceRoot);
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
	): vscode.Uri | undefined {
		const fs = require("node:fs");
		const candidates = [
			path.join(docDir, importPath),
			workspaceRoot ? path.join(workspaceRoot, importPath) : null,
			workspaceRoot
				? path.join(workspaceRoot, path.basename(importPath))
				: null,
		].filter(Boolean) as string[];

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
