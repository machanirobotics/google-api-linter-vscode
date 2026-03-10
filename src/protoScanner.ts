import * as vscode from "vscode";
import { findProtoFiles } from "./utils/fileUtils";
import { flattenSymbols, parseProtoDocument } from "./utils/protoParser";

export interface LocationItem {
	label: string;
	detail?: string;
	/** Documentation snippet (e.g. leading comment) for hover/tooltip. */
	documentation?: string;
	uri: vscode.Uri;
	range: vscode.Range;
	icon: string;
	/** For MCP: which RPC this option is attached to (same service block). */
	rpcName?: string;
	/** For MCP: tool | prompt | elicitation | service */
	mcpKind?: "tool" | "prompt" | "elicitation" | "service";
}

export interface RpcItem {
	name: string;
	fullName: string;
	requestType: string;
	responseType: string;
	detail: string;
	documentation?: string;
	uri: vscode.Uri;
	range: vscode.Range;
}

export interface ServiceItem {
	name: string;
	uri: vscode.Uri;
	range: vscode.Range;
	rpcs: RpcItem[];
}

export interface WorkspaceProtoScan {
	services: ServiceItem[];
	rpcs: LocationItem[];
	resources: LocationItem[];
	messages: LocationItem[];
	mcp: LocationItem[];
	mcpTools: LocationItem[];
	mcpElicitation: LocationItem[];
	mcpPrompts: LocationItem[];
	others: LocationItem[];
}

const RE_COMMENT = /^\s*(\/\/|\/\*)/;
const _RE_OPTION_GOOGLE_API_RESOURCE =
	/option\s*\(\s*google\.api\.resource\s*\)/;
const RE_OPTION_MCP_SERVICE = /option\s*\(\s*mcp\.protobuf\.service\s*\)/;
const RE_OPTION_MCP_TOOL = /option\s*\(\s*mcp\.protobuf\.tool\s*\)/;
const RE_OPTION_MCP_PROMPT = /option\s*\(\s*mcp\.protobuf\.prompt\s*\)/;
const RE_OPTION_MCP_ELICITATION =
	/option\s*\(\s*mcp\.protobuf\.elicitation\s*\)/;
const RE_RPC_DETAIL = /^\(([^)]+)\)\s*returns\s*\(([^)]+)\)$/;

function getLeadingComment(
	lines: string[],
	lineIndex: number,
): string | undefined {
	const out: string[] = [];
	let i = lineIndex - 1;
	while (i >= 0) {
		const line = lines[i];
		const t = line.trim();
		if (t === "") {
			i--;
			continue;
		}
		if (t.startsWith("//")) {
			out.unshift(t.replace(/^\s*\/\/\s?/, ""));
			i--;
			continue;
		}
		if (t.startsWith("/*")) {
			const end = t.indexOf("*/");
			const block = end >= 0 ? t.slice(2, end).trim() : t.slice(2).trim();
			out.unshift(block);
			break;
		}
		break;
	}
	return out.length > 0 ? out.join(" ").trim() : undefined;
}

/**
 * Scans workspace .proto files and returns RPCs, resources, messages, MCP, and others with locations.
 */
export async function scanWorkspaceProto(
	_workspaceRoot: vscode.Uri,
): Promise<WorkspaceProtoScan> {
	const services: ServiceItem[] = [];
	const rpcs: LocationItem[] = [];
	const resources: LocationItem[] = [];
	const messages: LocationItem[] = [];
	const mcp: LocationItem[] = [];
	const mcpTools: LocationItem[] = [];
	const mcpElicitation: LocationItem[] = [];
	const mcpPrompts: LocationItem[] = [];
	const others: LocationItem[] = [];
	const resourceNames = new Set<string>();

	const protoUris = await findProtoFiles();
	for (const uri of protoUris) {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const text = doc.getText();
			const lines = text.split("\n");

			const symbols = parseProtoDocument(doc);
			const flat = flattenSymbols(symbols);

			// Build services with RPCs (request/response)
			for (const s of symbols) {
				if (s.kind === "service") {
					const rpcItems: RpcItem[] = [];
					for (const c of s.children ?? []) {
						if (c.kind === "rpc") {
							const lineIndex = c.selectionRange.start.line;
							const detail = c.detail ?? "";
							const match = detail.match(RE_RPC_DETAIL);
							const requestType = match ? match[1].trim() : "";
							const responseType = match ? match[2].trim() : "";
							rpcItems.push({
								name: c.name,
								fullName: `${s.name}.${c.name}`,
								requestType,
								responseType,
								detail,
								documentation: getLeadingComment(lines, lineIndex),
								uri,
								range: c.selectionRange,
							});
							rpcs.push({
								label: `${s.name}.${c.name}`,
								detail: c.detail,
								documentation: getLeadingComment(lines, lineIndex),
								uri,
								range: c.selectionRange,
								icon: "symbol-method",
							});
						}
					}
					if (rpcItems.length > 0) {
						services.push({
							name: s.name,
							uri,
							range: s.selectionRange,
							rpcs: rpcItems,
						});
					}
				}
			}
			for (const s of flat) {
				if (s.kind === "message" && s.range) {
					const msgText = text.slice(
						doc.offsetAt(s.range.start),
						doc.offsetAt(s.range.end),
					);
					const lineIndex = s.selectionRange.start.line;
					const docComment = getLeadingComment(lines, lineIndex);
					if (/option\s*\(\s*google\.api\.resource\s*\)/.test(msgText)) {
						resourceNames.add(s.name);
						resources.push({
							label: s.name,
							detail: "google.api.resource",
							documentation: docComment,
							uri,
							range: s.selectionRange,
							icon: "symbol-class",
						});
					} else {
						messages.push({
							label: s.name,
							detail: "message",
							documentation: docComment,
							uri,
							range: s.selectionRange,
							icon: "symbol-class",
						});
					}
				}
				if (s.kind === "enum" && s.range) {
					const lineIndex = s.selectionRange.start.line;
					others.push({
						label: s.name,
						detail: "enum",
						documentation: getLeadingComment(lines, lineIndex),
						uri,
						range: s.selectionRange,
						icon: "symbol-enum",
					});
				}
			}

			// RPC line numbers in this file (for MCP→RPC association)
			const rpcLines: { line: number; rpcName: string }[] = [];
			for (const s of symbols) {
				if (s.kind === "service") {
					for (const c of s.children ?? []) {
						if (c.kind === "rpc") {
							rpcLines.push({
								line: c.range.start.line,
								rpcName: `${s.name}.${c.name}`,
							});
						}
					}
				}
			}
			rpcLines.sort((a, b) => a.line - b.line);

			const getLastRpcBefore = (line: number): string | undefined => {
				let last: string | undefined;
				for (const { line: L, rpcName } of rpcLines) {
					if (L < line) last = rpcName;
					else break;
				}
				return last;
			};

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (RE_COMMENT.test(line.trim())) continue;

				if (RE_OPTION_MCP_SERVICE.test(line)) {
					const serviceMatch =
						line.match(/\bservice\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/) ??
						lines
							.slice(Math.max(0, i - 5), i)
							.join("\n")
							.match(/\bservice\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/);
					const item: LocationItem = {
						label: serviceMatch ? `service ${serviceMatch[1]}` : "MCP service",
						detail: "mcp.protobuf.service",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "symbol-interface",
						mcpKind: "service",
					};
					mcp.push(item);
				}
				if (RE_OPTION_MCP_TOOL.test(line)) {
					const rpcName = getLastRpcBefore(i);
					const item: LocationItem = {
						label: rpcName ? `tool · ${rpcName}` : "tool option",
						detail: "mcp.protobuf.tool",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "tools",
						rpcName,
						mcpKind: "tool",
					};
					mcp.push(item);
					mcpTools.push(item);
				}
				if (RE_OPTION_MCP_PROMPT.test(line)) {
					const rpcName = getLastRpcBefore(i);
					const item: LocationItem = {
						label: rpcName ? `prompt · ${rpcName}` : "prompt option",
						detail: "mcp.protobuf.prompt",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "comment-discussion",
						rpcName,
						mcpKind: "prompt",
					};
					mcp.push(item);
					mcpPrompts.push(item);
				}
				if (RE_OPTION_MCP_ELICITATION.test(line)) {
					const rpcName = getLastRpcBefore(i);
					const item: LocationItem = {
						label: rpcName ? `elicitation · ${rpcName}` : "elicitation option",
						detail: "mcp.protobuf.elicitation",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "question",
						rpcName,
						mcpKind: "elicitation",
					};
					mcp.push(item);
					mcpElicitation.push(item);
				}
			}
		} catch {
			// skip
		}
	}

	services.sort((a, b) => a.name.localeCompare(b.name));
	rpcs.sort((a, b) => a.label.localeCompare(b.label));
	resources.sort((a, b) => a.label.localeCompare(b.label));
	messages.sort((a, b) => a.label.localeCompare(b.label));
	mcp.sort((a, b) => (a.detail ?? a.label).localeCompare(b.detail ?? b.label));
	others.sort((a, b) => a.label.localeCompare(b.label));

	return {
		services,
		rpcs,
		resources,
		messages,
		mcp,
		mcpTools,
		mcpElicitation,
		mcpPrompts,
		others,
	};
}
