import * as vscode from "vscode";
import { type ProtoSymbol, parseProtoDocument } from "./utils/protoParser";

const kindMap: Record<ProtoSymbol["kind"], vscode.SymbolKind> = {
	message: vscode.SymbolKind.Class,
	service: vscode.SymbolKind.Interface,
	enum: vscode.SymbolKind.Enum,
	rpc: vscode.SymbolKind.Method,
	field: vscode.SymbolKind.Field,
	enumValue: vscode.SymbolKind.Constant,
};

function toDocumentSymbol(s: ProtoSymbol): vscode.DocumentSymbol {
	const sym = new vscode.DocumentSymbol(
		s.name,
		s.detail ?? "",
		kindMap[s.kind],
		s.range,
		s.selectionRange,
	);
	if (s.children?.length) {sym.children = s.children.map(toDocumentSymbol);}
	return sym;
}

/**
 * Provides document outline (Outline view) for .proto files: message, service, enum, rpc.
 */
export class ProtoDocumentSymbolProvider
	implements vscode.DocumentSymbolProvider
{
	provideDocumentSymbols(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.DocumentSymbol[]> {
		const symbols = parseProtoDocument(document);
		return symbols.map(toDocumentSymbol);
	}
}
