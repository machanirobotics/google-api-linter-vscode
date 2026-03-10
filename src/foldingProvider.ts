import * as vscode from "vscode";
import { flattenSymbols, parseProtoDocument } from "./utils/protoParser";

/**
 * Folding for message, service, enum, and oneof blocks (no need for #region).
 */
export class ProtoFoldingRangeProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.FoldingRange[]> {
		const symbols = parseProtoDocument(document);
		const flat = flattenSymbols(symbols);
		const ranges: vscode.FoldingRange[] = [];

		for (const s of flat) {
			if (
				s.kind === "message" ||
				s.kind === "service" ||
				s.kind === "enum" ||
				s.kind === "rpc"
			) {
				const r = s.range;
				if (r.start.line < r.end.line) {
					ranges.push(
						new vscode.FoldingRange(
							r.start.line,
							r.end.line,
							this.kindFor(s.kind),
						),
					);
				}
			}
		}

		// Oneof blocks: simple brace matching
		const lines = document.getText().split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (/^\s*oneof\s+\w+/.test(lines[i]) && lines[i].includes("{")) {
				let depth = 0;
				for (let j = i; j < lines.length; j++) {
					for (const ch of lines[j]) {
						if (ch === "{") depth++;
						else if (ch === "}") {
							depth--;
							if (depth === 0) {
								if (j > i)
									ranges.push(
										new vscode.FoldingRange(
											i,
											j,
											vscode.FoldingRangeKind.Region,
										),
									);
								break;
							}
						}
					}
					if (depth === 0) break;
				}
			}
		}

		return ranges;
	}

	private kindFor(kind: string): vscode.FoldingRangeKind {
		switch (kind) {
			case "message":
				return vscode.FoldingRangeKind.Region;
			case "service":
				return vscode.FoldingRangeKind.Region;
			case "enum":
				return vscode.FoldingRangeKind.Region;
			case "rpc":
				return vscode.FoldingRangeKind.Region;
			default:
				return vscode.FoldingRangeKind.Region;
		}
	}
}
