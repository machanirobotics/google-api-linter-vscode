import * as vscode from "vscode";
import { findProtoFiles } from "./utils/fileUtils";
import {
	collectTypeReferences,
	flattenSymbols,
	parseProtoDocument,
	simpleName,
} from "./utils/protoParser";

/**
 * Provides find references (Where is this type used?) for message, enum, service names.
 */
export class ProtoReferenceProvider implements vscode.ReferenceProvider {
	async provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.ReferenceContext,
		token: vscode.CancellationToken,
	): Promise<vscode.Location[] | null> {
		const symbols = parseProtoDocument(document);
		const _flat = flattenSymbols(symbols);
		const nameAtPosition = document.getText(
			document.getWordRangeAtPosition(position),
		);
		if (!nameAtPosition) return null;

		const targetSimple = simpleName(nameAtPosition);
		const locations: vscode.Location[] = [];

		// Include definition when "include declaration" is on (added below from workspace scan)

		// Current file type references
		const refs = collectTypeReferences(document);
		for (const ref of refs) {
			if (
				simpleName(ref.typeName) === targetSimple &&
				!ref.range.contains(position)
			) {
				locations.push(new vscode.Location(document.uri, ref.range));
			}
		}

		// Other workspace proto files: references and definition
		const allProto = await findProtoFiles();
		for (const uri of allProto) {
			if (token.isCancellationRequested) break;
			try {
				const doc = await vscode.workspace.openTextDocument(uri);
				if (context.includeDeclaration) {
					const symbols = parseProtoDocument(doc);
					const flat = flattenSymbols(symbols);
					for (const s of flat) {
						if (s.kind !== "rpc" && simpleName(s.name) === targetSimple) {
							const alreadyHasDef = locations.some(
								(l) =>
									l.uri.toString() === uri.toString() &&
									l.range.isEqual(s.selectionRange),
							);
							if (!alreadyHasDef)
								locations.push(new vscode.Location(uri, s.selectionRange));
						}
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

		return locations.length ? locations : null;
	}
}
