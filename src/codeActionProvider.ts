import * as vscode from "vscode";
import { getSymbolAtPosition, parseProtoDocument } from "./utils/protoParser";

/**
 * Provides code actions (quick fixes) for proto files:
 * - Add (google.api.http) for RPCs (Get/Create/Update/Delete)
 * - Add (google.api.resource) for messages
 * - Add UNSPECIFIED enum value when missing
 */
export class ProtoCodeActionProvider implements vscode.CodeActionProvider {
	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		const actions: vscode.CodeAction[] = [];
		const position = range.start;
		const symbols = parseProtoDocument(document);
		const symbol = getSymbolAtPosition(symbols, position);

		if (symbol?.kind === "rpc") {
			const _line = document.lineAt(symbol.range.start.line).text;
			if (
				!/option\s*\(\s*google\.api\.http\s*\)/.test(
					document.getText(symbol.range),
				)
			) {
				const method = symbol.name;
				const isGet = /^Get/.test(method);
				const isList = /^List/.test(method);
				const isCreate = /^Create/.test(method);
				const isUpdate = /^Update/.test(method);
				const isDelete = /^Delete/.test(method);
				let path = "/v1/resources";
				if (isGet && !isList) path = "/v1/{name=resources/*}";
				else if (isList) path = "/v1/{parent=resources}";
				else if (isCreate) path = "/v1/{parent=resources}";
				else if (isUpdate) path = "/v1/{resource.name=resources/*}";
				else if (isDelete) path = "/v1/{name=resources/*}";
				const httpMethod =
					isGet && !isList
						? "get"
						: isCreate
							? "post"
							: isUpdate
								? "patch"
								: isDelete
									? "delete"
									: "get";
				const insert = this.insertHttpOption(
					document,
					symbol.range,
					httpMethod,
					path,
					isCreate || isUpdate,
				);
				if (insert) {
					const action = new vscode.CodeAction(
						"Add (google.api.http)",
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = insert;
					action.diagnostics = context.diagnostics.filter((d) =>
						d.range.intersection(symbol.range),
					);
					actions.push(action);
				}
			}
		}

		if (symbol?.kind === "message") {
			const blockText = document.getText(symbol.range);
			if (!/option\s*\(\s*google\.api\.resource\s*\)/.test(blockText)) {
				const insert = this.insertResourceOption(document, symbol);
				if (insert) {
					const action = new vscode.CodeAction(
						"Add (google.api.resource)",
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = insert;
					actions.push(action);
				}
			}
		}

		if (symbol?.kind === "enum") {
			const blockText = document.getText(symbol.range);
			const firstValueMatch = blockText.match(
				/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*0/,
			);
			const enumName = symbol.name;
			const unspecified = `${enumName}_UNSPECIFIED`;
			if (firstValueMatch && firstValueMatch[1] !== unspecified) {
				const insert = this.insertUnspecifiedEnum(document, symbol);
				if (insert) {
					const action = new vscode.CodeAction(
						`Add ${unspecified} = 0 as first enum value`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = insert;
					actions.push(action);
				}
			}
		}

		return actions.length ? actions : undefined;
	}

	private insertHttpOption(
		document: vscode.TextDocument,
		rpcRange: vscode.Range,
		method: string,
		path: string,
		withBody: boolean,
	): vscode.WorkspaceEdit | undefined {
		const edit = new vscode.WorkspaceEdit();
		const anchorLine = document.lineAt(rpcRange.start.line);
		const indent = (anchorLine.text.match(/^\s*/) ?? [""])[0];
		const inner = `${indent}  `;
		const insertLine = rpcRange.start.line + 1;
		let lines = `${inner}option (google.api.http) = {\n`;
		lines += `${inner}  ${method}: "${path}";\n`;
		if (withBody) lines += `${inner}  body: "payload";\n`;
		lines += `${inner}};\n`;
		edit.insert(document.uri, new vscode.Position(insertLine, 0), lines);
		return edit;
	}

	private insertResourceOption(
		document: vscode.TextDocument,
		messageSymbol: { name: string; range: vscode.Range },
	): vscode.WorkspaceEdit | undefined {
		const edit = new vscode.WorkspaceEdit();
		const line = document.lineAt(messageSymbol.range.start.line);
		const indent = (line.text.match(/^\s*/) ?? [""])[0];
		const insertLine = messageSymbol.range.start.line + 1;
		const typeName = messageSymbol.name;
		const pattern = "resources/{resource_id}";
		const toInsert =
			indent +
			"  option (google.api.resource) = {\n" +
			indent +
			'    type: "example.com/' +
			typeName +
			'";\n' +
			indent +
			'    pattern: "' +
			pattern +
			'";\n' +
			indent +
			"  };\n";
		edit.insert(document.uri, new vscode.Position(insertLine, 0), toInsert);
		return edit;
	}

	private insertUnspecifiedEnum(
		document: vscode.TextDocument,
		enumSymbol: { name: string; range: vscode.Range },
	): vscode.WorkspaceEdit | undefined {
		const edit = new vscode.WorkspaceEdit();
		const line = document.lineAt(enumSymbol.range.start.line);
		const indent = (line.text.match(/^\s*/) ?? [""])[0];
		const insertLine = enumSymbol.range.start.line + 1;
		const unspecified = `${enumSymbol.name}_UNSPECIFIED`;
		const toInsert = `${indent}  ${unspecified} = 0;\n`;
		edit.insert(document.uri, new vscode.Position(insertLine, 0), toInsert);
		return edit;
	}
}
