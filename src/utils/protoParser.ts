import * as vscode from "vscode";

export type ProtoSymbolKind =
	| "message"
	| "service"
	| "enum"
	| "rpc"
	| "field"
	| "enumValue";

export interface ProtoSymbol {
	name: string;
	kind: ProtoSymbolKind;
	/** Full range including body (e.g. message Foo { ... }) */
	range: vscode.Range;
	/** Range of the name only (for selection) */
	selectionRange: vscode.Range;
	/** For message/service/enum: nested symbols (rpcs, nested messages) */
	children?: ProtoSymbol[];
	/** Optional detail, e.g. "Request" for rpc GetFoo(GetFooRequest) returns (Foo) */
	detail?: string;
}

const RE_COMMENT = /^\s*(\/\/|\/\*)/;
const RE_MESSAGE = /^\s*(message|extend)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/;
const RE_SERVICE = /^\s*service\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/;
const RE_ENUM = /^\s*enum\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/;
const RE_RPC =
	/^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(stream\s+)?([A-Za-z_.][A-Za-z0-9_.]*)\s*\)\s*returns\s*\(\s*(stream\s+)?([A-Za-z_.][A-Za-z0-9_.]*)\s*\)/;
const RE_ONEOF = /^\s*oneof\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{?/;
const RE_FIELD =
	/^\s*(?:repeated|optional|required)?\s*(?:map\s*<[^>]+>\s+)?([A-Za-z_.][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)/;

function findMatchingBrace(
	lines: string[],
	startLine: number,
	openCh: "{",
	closeCh: "}" = "}",
): number {
	let depth = 0;
	for (let i = startLine; i < lines.length; i++) {
		const line = lines[i];
		for (const ch of line) {
			if (ch === openCh) {
				depth++;
			} else if (ch === closeCh) {
				depth--;
				if (depth === 0) {
					return i;
				}
			}
		}
	}
	return startLine;
}

function rangeFromLines(
	startLine: number,
	startChar: number,
	endLine: number,
	endChar: number,
): vscode.Range {
	return new vscode.Range(startLine, startChar, endLine, endChar);
}

function lineRange(
	document: vscode.TextDocument,
	lineIndex: number,
	startChar: number,
	endChar: number,
): vscode.Range {
	const end = Math.min(endChar, document.lineAt(lineIndex).text.length);
	return rangeFromLines(lineIndex, startChar, lineIndex, end);
}

/**
 * Parse a proto document and return a flat list of top-level symbols (message, service, enum)
 * with their ranges and optional children (e.g. rpcs inside service).
 */
export function parseProtoDocument(
	document: vscode.TextDocument,
): ProtoSymbol[] {
	const text = document.getText();
	const lines = text.split("\n");
	const symbols: ProtoSymbol[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (RE_COMMENT.test(line)) {
			i++;
			continue;
		}

		let match = line.match(RE_MESSAGE);
		if (match) {
			const name = match[2];
			const nameStart = line.indexOf(name);
			const nameEnd = nameStart + name.length;
			const hasBrace = line.includes("{");
			const endLine = hasBrace ? findMatchingBrace(lines, i, "{") : i;
			const range = rangeFromLines(i, 0, endLine, lines[endLine].length);
			const selectionRange = lineRange(document, i, nameStart, nameEnd);
			const children: ProtoSymbol[] = [];
			if (hasBrace) {
				parseNestedMessages(lines, i + 1, endLine, document, children);
			}
			symbols.push({
				name,
				kind: "message",
				range,
				selectionRange,
				children: children.length ? children : undefined,
			});
			i = endLine + 1;
			continue;
		}

		match = line.match(RE_SERVICE);
		if (match) {
			const name = match[1];
			const nameStart = line.indexOf(name);
			const nameEnd = nameStart + name.length;
			const hasBrace = line.includes("{");
			const endLine = hasBrace ? findMatchingBrace(lines, i, "{") : i;
			const range = rangeFromLines(i, 0, endLine, lines[endLine].length);
			const selectionRange = lineRange(document, i, nameStart, nameEnd);
			const children: ProtoSymbol[] = [];
			if (hasBrace) {
				for (let j = i + 1; j < endLine; j++) {
					const rpcMatch = lines[j].match(RE_RPC);
					if (rpcMatch && !RE_COMMENT.test(lines[j])) {
						const rpcName = rpcMatch[1];
						const req = rpcMatch[3];
						const res = rpcMatch[5];
						const rpcStart = lines[j].indexOf(rpcName);
						children.push({
							name: rpcName,
							kind: "rpc",
							detail: `(${req}) returns (${res})`,
							range: lineRange(document, j, 0, lines[j].length),
							selectionRange: lineRange(
								document,
								j,
								rpcStart,
								rpcStart + rpcName.length,
							),
						});
					}
				}
			}
			symbols.push({
				name,
				kind: "service",
				range,
				selectionRange,
				children: children.length ? children : undefined,
			});
			i = endLine + 1;
			continue;
		}

		match = line.match(RE_ENUM);
		if (match) {
			const name = match[1];
			const nameStart = line.indexOf(name);
			const nameEnd = nameStart + name.length;
			const hasBrace = line.includes("{");
			const endLine = hasBrace ? findMatchingBrace(lines, i, "{") : i;
			const range = rangeFromLines(i, 0, endLine, lines[endLine].length);
			const selectionRange = lineRange(document, i, nameStart, nameEnd);
			symbols.push({ name, kind: "enum", range, selectionRange });
			i = endLine + 1;
			continue;
		}

		i++;
	}

	return symbols;
}

function parseNestedMessages(
	lines: string[],
	startLine: number,
	endLine: number,
	document: vscode.TextDocument,
	out: ProtoSymbol[],
): void {
	let i = startLine;
	while (i < endLine) {
		const line = lines[i];
		if (RE_COMMENT.test(line)) {
			i++;
			continue;
		}
		// Nested message
		const match = line.match(RE_MESSAGE);
		if (match) {
			const name = match[2];
			const nameStart = line.indexOf(name);
			const nameEnd = nameStart + name.length;
			const hasBrace = line.includes("{");
			const closeLine = hasBrace ? findMatchingBrace(lines, i, "{") : i;
			const range = rangeFromLines(i, 0, closeLine, lines[closeLine].length);
			const selectionRange = lineRange(document, i, nameStart, nameEnd);
			out.push({ name, kind: "message", range, selectionRange });
			i = closeLine + 1;
			continue;
		}
		// Nested enum
		const enumMatch = line.match(RE_ENUM);
		if (enumMatch) {
			const name = enumMatch[1];
			const nameStart = line.indexOf(name);
			const nameEnd = nameStart + name.length;
			const hasBrace = line.includes("{");
			const closeLine = hasBrace ? findMatchingBrace(lines, i, "{") : i;
			const selectionRange = lineRange(document, i, nameStart, nameEnd);
			out.push({
				name,
				kind: "enumValue",
				range: rangeFromLines(i, 0, closeLine, lines[closeLine].length),
				selectionRange,
			});
			i = closeLine + 1;
			continue;
		}
		// Skip oneof blocks (but don't add them as symbols)
		const oneofMatch = line.match(RE_ONEOF);
		if (oneofMatch) {
			const hasBrace = line.includes("{");
			const closeLine = hasBrace ? findMatchingBrace(lines, i, "{") : i;
			i = closeLine + 1;
			continue;
		}
		// Field symbols
		const fieldMatch = line.match(RE_FIELD);
		if (fieldMatch) {
			const name = fieldMatch[2];
			const nameStart = line.indexOf(name);
			const nameEnd = nameStart + name.length;
			out.push({
				name,
				kind: "field",
				range: lineRange(document, i, 0, line.length),
				selectionRange: lineRange(document, i, nameStart, nameEnd),
				detail: fieldMatch[1],
			});
		}
		i++;
	}
}

export interface MessageFieldInfo {
	name: string;
	type: string;
	number: string;
	range: vscode.Range;
}

export interface MessageEnumInfo {
	name: string;
	range: vscode.Range;
}

/**
 * Parse a message body starting at the given line (line should be "message Name {").
 * Returns fields and nested enums with their ranges.
 */
export function parseMessageBody(
	document: vscode.TextDocument,
	messageStartLine: number,
): { fields: MessageFieldInfo[]; enums: MessageEnumInfo[] } {
	const lines = document.getText().split("\n");
	const fields: MessageFieldInfo[] = [];
	const enums: MessageEnumInfo[] = [];
	let startLine = messageStartLine;
	const firstLine = lines[messageStartLine] ?? "";
	if (!firstLine.includes("{")) {
		for (let i = messageStartLine + 1; i < lines.length; i++) {
			if (lines[i].includes("{")) {
				startLine = i;
				break;
			}
		}
	}
	const endLine = findMatchingBrace(lines, startLine, "{");
	for (let i = startLine + 1; i < endLine; i++) {
		const line = lines[i];
		if (RE_COMMENT.test(line.trim())) {
			continue;
		}
		const enumMatch = line.match(RE_ENUM);
		if (enumMatch) {
			const name = enumMatch[1];
			const nameStart = line.indexOf(name);
			enums.push({
				name,
				range: rangeFromLines(i, nameStart, i, nameStart + name.length),
			});
			const hasBrace = line.includes("{");
			if (hasBrace) {
				const closeLine = findMatchingBrace(lines, i, "{");
				i = closeLine;
			}
			continue;
		}
		const fieldMatch = line.match(RE_FIELD);
		if (fieldMatch) {
			const type = fieldMatch[1];
			const name = fieldMatch[2];
			const number = fieldMatch[3];
			const nameStart = line.indexOf(name);
			fields.push({
				name,
				type: type ?? "?",
				number,
				range: rangeFromLines(
					i,
					nameStart,
					i,
					Math.min(nameStart + name.length, (lines[i] ?? "").length),
				),
			});
		}
	}
	return { fields, enums };
}

/** Get all symbols flattened (including nested) for workspace/search. */
export function flattenSymbols(symbols: ProtoSymbol[]): ProtoSymbol[] {
	const result: ProtoSymbol[] = [];
	function add(s: ProtoSymbol) {
		result.push(s);
		if (s.children) {
			s.children.forEach(add);
		}
	}
	symbols.forEach(add);
	return result;
}

/** Find the symbol at position (e.g. message/service/enum/rpc name). */
export function getSymbolAtPosition(
	symbols: ProtoSymbol[],
	position: vscode.Position,
): ProtoSymbol | undefined {
	for (const s of symbols) {
		if (s.selectionRange.contains(position)) {
			return s;
		}
		if (s.children) {
			const found = getSymbolAtPosition(s.children, position);
			if (found) {
				return found;
			}
		}
	}
	return undefined;
}

/** Collect all type names used in the document (for references): field types, rpc request/response. */
export function collectTypeReferences(
	document: vscode.TextDocument,
): { typeName: string; range: vscode.Range }[] {
	const refs: { typeName: string; range: vscode.Range }[] = [];
	const lines = document.getText().split("\n");
	const reFieldType =
		/\b(?:optional|repeated|required|stream)?\s*(\\.?[A-Za-z_][A-Za-z0-9_.]*)\s+(\w+)\s*=\s*\d+/;
	const reRpc =
		/\brpc\s+\w+\s*\(\s*(?:stream\s+)?([A-Za-z_.][A-Za-z0-9_.]*)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([A-Za-z_.][A-Za-z0-9_.]*)\s*\)/;
	const reMap =
		/\bmap\s*<\s*(\\.?[A-Za-z_][A-Za-z0-9_.]*)\s*,\s*(\\.?[A-Za-z_][A-Za-z0-9_.]*)\s*>/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (RE_COMMENT.test(line)) {
			continue;
		}

		let m: RegExpExecArray | null;
		const re1 = new RegExp(reFieldType.source, "g");
		while ((m = re1.exec(line))) {
			const typeName = (m[1].startsWith(".") ? m[1].slice(1) : m[1]).trim();
			if (
				/^(double|float|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|bool|string|bytes)$/.test(
					typeName,
				)
			) {
				continue;
			}
			const typeStart = m.index + m[0].indexOf(m[1]);
			refs.push({
				typeName,
				range: new vscode.Range(i, typeStart, i, typeStart + m[1].length),
			});
		}
		const rpcM = line.match(reRpc);
		if (rpcM) {
			const reqStart = line.indexOf(rpcM[1]);
			refs.push({
				typeName: rpcM[1],
				range: new vscode.Range(i, reqStart, i, reqStart + rpcM[1].length),
			});
			const resStart = line.indexOf(rpcM[2]);
			refs.push({
				typeName: rpcM[2],
				range: new vscode.Range(i, resStart, i, resStart + rpcM[2].length),
			});
		}
		const mapM = line.match(reMap);
		if (mapM) {
			const kStart = line.indexOf(mapM[1]);
			refs.push({
				typeName: mapM[1].replace(/^\./, ""),
				range: new vscode.Range(i, kStart, i, kStart + mapM[1].length),
			});
			const vStart = line.indexOf(mapM[2], kStart + mapM[1].length);
			refs.push({
				typeName: mapM[2].replace(/^\./, ""),
				range: new vscode.Range(i, vStart, i, vStart + mapM[2].length),
			});
		}
	}
	return refs;
}

/** Simple extract of "simple" type name from a possibly fully-qualified name (last segment). */
export function simpleName(fullName: string): string {
	const last = fullName.split(".").pop();
	return last ?? fullName;
}
