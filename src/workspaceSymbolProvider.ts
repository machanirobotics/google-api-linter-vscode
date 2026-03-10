import * as path from "node:path";
import * as vscode from "vscode";
import { findProtoFiles } from "./utils/fileUtils";
import {
	flattenSymbols,
	type ProtoSymbol,
	parseProtoDocument,
} from "./utils/protoParser";

const kindMap: Record<ProtoSymbol["kind"], vscode.SymbolKind> = {
	message: vscode.SymbolKind.Class,
	service: vscode.SymbolKind.Interface,
	enum: vscode.SymbolKind.Enum,
	rpc: vscode.SymbolKind.Method,
	field: vscode.SymbolKind.Field,
	enumValue: vscode.SymbolKind.Constant,
};

/**
 * Provides workspace-wide symbol search (Go to Symbol in Workspace) for messages, services, enums, rpcs.
 */
export class ProtoWorkspaceSymbolProvider
	implements vscode.WorkspaceSymbolProvider
{
	async provideWorkspaceSymbols(
		query: string,
		token: vscode.CancellationToken,
	): Promise<vscode.SymbolInformation[]> {
		const files = await findProtoFiles();
		const results: vscode.SymbolInformation[] = [];
		const q = query.toLowerCase();

		for (const uri of files) {
			if (token.isCancellationRequested) break;
			try {
				const document = await vscode.workspace.openTextDocument(uri);
				const symbols = parseProtoDocument(document);
				const flat = flattenSymbols(symbols);
				const containerName = path.basename(uri.fsPath, ".proto");
				for (const s of flat) {
					if (!q || s.name.toLowerCase().includes(q)) {
						results.push(
							new vscode.SymbolInformation(
								s.name,
								kindMap[s.kind],
								s.detail ?? containerName,
								new vscode.Location(uri, s.selectionRange),
							),
						);
					}
				}
			} catch {
				// skip unreadable files
			}
		}

		return results;
	}
}
