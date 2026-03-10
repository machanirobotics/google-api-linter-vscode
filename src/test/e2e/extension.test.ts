import * as path from 'path';
import * as vscode from 'vscode';

/**
 * End-to-end tests run inside the Extension Development Host
 * with the smoke_test/protobuf workspace loaded.
 */
export async function run(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error('Expected a workspace folder (smoke_test/protobuf) to be open');
  }

  // 1. Extension should see workspace with workspace.protobuf.yaml (activation)
  const protobufYaml = path.join(workspaceRoot, 'workspace.protobuf.yaml');
  const yamlUri = vscode.Uri.file(protobufYaml);
  try {
    await vscode.workspace.fs.stat(yamlUri);
  } catch {
    throw new Error(`Expected workspace to contain workspace.protobuf.yaml at ${protobufYaml}`);
  }

  // 2. Open a .proto file and get document symbols (outline)
  const protoPath = path.join(workspaceRoot, 'machanirobotics', 'service', 'service.proto');
  const doc = await vscode.workspace.openTextDocument(protoPath);
  if (doc.languageId !== 'proto3' && doc.languageId !== 'protobuf') {
    throw new Error(`Expected .proto file to have language proto3 or protobuf, got ${doc.languageId}`);
  }

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    doc.uri
  );
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new Error('Expected document symbol provider to return at least one symbol (e.g. service TodoService)');
  }

  const hasService = symbols.some((s) => s.name === 'TodoService' && s.kind === vscode.SymbolKind.Interface);
  if (!hasService) {
    throw new Error(`Expected a document symbol "TodoService" (service), got: ${symbols.map((s) => s.name).join(', ')}`);
  }

  // 3. Completion provider: request completions at a position
  const position = new vscode.Position(0, 0);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    position
  );
  if (!completions?.items?.length) {
    throw new Error('Expected completion provider to return at least one item');
  }

  console.log('E2E: extension activated, document symbols and completions OK');
}
