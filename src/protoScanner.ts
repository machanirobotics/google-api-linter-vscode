import * as vscode from 'vscode';
import { findProtoFiles } from './utils/fileUtils';
import { parseProtoDocument, flattenSymbols } from './utils/protoParser';

export interface LocationItem {
  label: string;
  detail?: string;
  uri: vscode.Uri;
  range: vscode.Range;
  icon: string;
}

export interface WorkspaceProtoScan {
  rpcs: LocationItem[];
  resources: LocationItem[];
  mcp: LocationItem[];
}

const RE_COMMENT = /^\s*(\/\/|\/\*)/;
const RE_OPTION_GOOGLE_API_RESOURCE = /option\s*\(\s*google\.api\.resource\s*\)/;
const RE_OPTION_MCP_SERVICE = /option\s*\(\s*mcp\.protobuf\.service\s*\)/;
const RE_OPTION_MCP_TOOL = /option\s*\(\s*mcp\.protobuf\.tool\s*\)/;
const RE_OPTION_MCP_PROMPT = /option\s*\(\s*mcp\.protobuf\.prompt\s*\)/;
const RE_OPTION_MCP_ELICITATION = /option\s*\(\s*mcp\.protobuf\.elicitation\s*\)/;

/**
 * Scans workspace .proto files and returns RPCs, resources (google.api.resource), and MCP options with locations.
 */
export async function scanWorkspaceProto(workspaceRoot: vscode.Uri): Promise<WorkspaceProtoScan> {
  const rpcs: LocationItem[] = [];
  const resources: LocationItem[] = [];
  const mcp: LocationItem[] = [];

  const protoUris = await findProtoFiles();
  for (const uri of protoUris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const lines = text.split('\n');

      const symbols = parseProtoDocument(doc);
      const flat = flattenSymbols(symbols);

      for (const s of symbols) {
        if (s.kind === 'service') {
          for (const c of s.children ?? []) {
            if (c.kind === 'rpc') {
              rpcs.push({
                label: `${s.name}.${c.name}`,
                detail: c.detail,
                uri,
                range: c.selectionRange,
                icon: 'symbol-method',
              });
            }
          }
        }
      }
      for (const s of flat) {
        if (s.kind === 'message' && s.range) {
          const msgText = text.slice(doc.offsetAt(s.range.start), doc.offsetAt(s.range.end));
          if (/option\s*\(\s*google\.api\.resource\s*\)/.test(msgText)) {
            resources.push({
              label: s.name,
              detail: 'google.api.resource',
              uri,
              range: s.selectionRange,
              icon: 'symbol-class',
            });
          }
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (RE_COMMENT.test(line.trim())) continue;

        if (RE_OPTION_MCP_SERVICE.test(line)) {
          const serviceMatch = line.match(/\bservice\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/) ?? lines.slice(Math.max(0, i - 5), i).join('\n').match(/\bservice\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{?/);
          mcp.push({
            label: serviceMatch ? `service ${serviceMatch[1]}` : 'MCP service',
            detail: 'mcp.protobuf.service',
            uri,
            range: new vscode.Range(i, 0, i, line.length),
            icon: 'symbol-interface',
          });
        }
        if (RE_OPTION_MCP_TOOL.test(line)) {
          mcp.push({
            label: 'tool option',
            detail: 'mcp.protobuf.tool',
            uri,
            range: new vscode.Range(i, 0, i, line.length),
            icon: 'tools',
          });
        }
        if (RE_OPTION_MCP_PROMPT.test(line)) {
          mcp.push({
            label: 'prompt option',
            detail: 'mcp.protobuf.prompt',
            uri,
            range: new vscode.Range(i, 0, i, line.length),
            icon: 'comment-discussion',
          });
        }
        if (RE_OPTION_MCP_ELICITATION.test(line)) {
          mcp.push({
            label: 'elicitation option',
            detail: 'mcp.protobuf.elicitation',
            uri,
            range: new vscode.Range(i, 0, i, line.length),
            icon: 'question',
          });
        }
      }
    } catch {
      // skip
    }
  }

  rpcs.sort((a, b) => a.label.localeCompare(b.label));
  resources.sort((a, b) => a.label.localeCompare(b.label));
  mcp.sort((a, b) => (a.detail ?? a.label).localeCompare(b.detail ?? b.label));

  return { rpcs, resources, mcp };
}
