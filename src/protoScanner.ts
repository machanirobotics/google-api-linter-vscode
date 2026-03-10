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
}

export interface WorkspaceProtoScan {
	rpcs: LocationItem[];
	resources: LocationItem[];
	messages: LocationItem[];
	mcp: LocationItem[];
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
	const rpcs: LocationItem[] = [];
	const resources: LocationItem[] = [];
	const messages: LocationItem[] = [];
	const mcp: LocationItem[] = [];
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

			for (const s of symbols) {
				if (s.kind === "service") {
					for (const c of s.children ?? []) {
						if (c.kind === "rpc") {
							const lineIndex = c.selectionRange.start.line;
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
					mcp.push({
						label: serviceMatch ? `service ${serviceMatch[1]}` : "MCP service",
						detail: "mcp.protobuf.service",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "symbol-interface",
					});
				}
				if (RE_OPTION_MCP_TOOL.test(line)) {
					mcp.push({
						label: "tool option",
						detail: "mcp.protobuf.tool",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "tools",
					});
				}
				if (RE_OPTION_MCP_PROMPT.test(line)) {
					mcp.push({
						label: "prompt option",
						detail: "mcp.protobuf.prompt",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "comment-discussion",
					});
				}
				if (RE_OPTION_MCP_ELICITATION.test(line)) {
					mcp.push({
						label: "elicitation option",
						detail: "mcp.protobuf.elicitation",
						documentation: getLeadingComment(lines, i),
						uri,
						range: new vscode.Range(i, 0, i, line.length),
						icon: "question",
					});
				}
			}
		} catch {
			// skip
		}
	}

	rpcs.sort((a, b) => a.label.localeCompare(b.label));
	resources.sort((a, b) => a.label.localeCompare(b.label));
	messages.sort((a, b) => a.label.localeCompare(b.label));
	mcp.sort((a, b) => (a.detail ?? a.label).localeCompare(b.detail ?? b.label));
	others.sort((a, b) => a.label.localeCompare(b.label));

	return { rpcs, resources, messages, mcp, others };
}
