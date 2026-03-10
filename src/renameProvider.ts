import * as vscode from "vscode";
import { findProtoFiles } from "./utils/fileUtils";
import {
	collectTypeReferences,
	flattenSymbols,
	parseProtoDocument,
	simpleName,
} from "./utils/protoParser";

/**
 * Provides rename for message, service, enum, and rpc names; updates all references in the workspace.
 */
export class ProtoRenameProvider implements vscode.RenameProvider {
	async provideRenameEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		token: vscode.CancellationToken,
	): Promise<vscode.WorkspaceEdit | null> {
		const symbols = parseProtoDocument(document);
		const flat = flattenSymbols(symbols);
		const symbol = flat.find((s) => s.selectionRange.contains(position));
		if (
			!symbol ||
			(symbol.kind !== "message" &&
				symbol.kind !== "service" &&
				symbol.kind !== "enum" &&
				symbol.kind !== "rpc")
		) {
			return null;
		}
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return null;

		const oldName = symbol.name;
		const targetSimple = simpleName(oldName);
		const locations: vscode.Location[] = [];

		// Definition (current file)
		locations.push(new vscode.Location(document.uri, symbol.selectionRange));

		// References in current file
		const refs = collectTypeReferences(document);
		for (const ref of refs) {
			if (
				simpleName(ref.typeName) === targetSimple &&
				!ref.range.contains(position)
			) {
				locations.push(new vscode.Location(document.uri, ref.range));
			}
		}

		// Other files: definitions and references
		const allProto = await findProtoFiles();
		for (const uri of allProto) {
			if (token.isCancellationRequested) break;
			try {
				const doc = await vscode.workspace.openTextDocument(uri);
				const otherSymbols = parseProtoDocument(doc);
				const otherFlat = flattenSymbols(otherSymbols);
				for (const s of otherFlat) {
					if (s.kind !== "rpc" && simpleName(s.name) === targetSimple) {
						const already = locations.some(
							(l) =>
								l.uri.toString() === uri.toString() &&
								l.range.isEqual(s.selectionRange),
						);
						if (!already)
							locations.push(new vscode.Location(uri, s.selectionRange));
					}
				}
				if (uri.toString() !== document.uri.toString()) {
					const refsOther = collectTypeReferences(doc);
					for (const ref of refsOther) {
						if (simpleName(ref.typeName) === targetSimple) {
							locations.push(new vscode.Location(uri, ref.range));
						}
					}
				}
			} catch {
				// skip
			}
		}

		const edit = new vscode.WorkspaceEdit();
		for (const loc of locations) {
			const doc = await vscode.workspace.openTextDocument(loc.uri);
			const text = doc.getText(loc.range);
			const newText = text.includes(".")
				? text.slice(0, text.lastIndexOf(".") + 1) + newName
				: newName;
			edit.replace(loc.uri, loc.range, newText);
		}
		return edit;
	}

	async prepareRename?(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): Promise<
		vscode.Range | { range: vscode.Range; placeholder: string } | null
	> {
		const symbols = parseProtoDocument(document);
		const flat = flattenSymbols(symbols);
		const symbol = flat.find((s) => s.selectionRange.contains(position));
		if (
			!symbol ||
			(symbol.kind !== "message" &&
				symbol.kind !== "service" &&
				symbol.kind !== "enum" &&
				symbol.kind !== "rpc")
		) {
			return null;
		}
		return { range: symbol.selectionRange, placeholder: symbol.name };
	}
}
