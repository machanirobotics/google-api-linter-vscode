import * as vscode from 'vscode';
import * as path from 'path';

const RE_IMPORT = /^\s*import\s+(?:weak|public)?\s*["']([^"']+\.proto)["']\s*;/;

/**
 * Makes import "path/to/file.proto" clickable; resolves path relative to current file or workspace.
 */
export class ProtoDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    const docDir = path.dirname(document.uri.fsPath);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    for (let i = 0; i < document.lineCount; i++) {
      if (token.isCancellationRequested) break;
      const line = document.lineAt(i);
      const match = line.text.match(RE_IMPORT);
      if (!match) continue;

      const importPath = match[1];
      const startQuote = line.text.indexOf('"', line.text.indexOf('import'));
      const endQuote = line.text.indexOf('"', startQuote + 1);
      if (startQuote === -1) {
        const singleStart = line.text.indexOf("'");
        const singleEnd = line.text.indexOf("'", singleStart + 1);
        if (singleStart === -1) continue;
        const range = new vscode.Range(i, singleStart + 1, i, singleEnd);
        const target = this.resolveImport(importPath, docDir, workspaceRoot);
        if (target) links.push(new vscode.DocumentLink(range, target));
        continue;
      }
      const range = new vscode.Range(i, startQuote + 1, i, endQuote);
      const target = this.resolveImport(importPath, docDir, workspaceRoot);
      if (target) links.push(new vscode.DocumentLink(range, target));
    }
    return links;
  }

  private resolveImport(
    importPath: string,
    docDir: string,
    workspaceRoot: string | undefined
  ): vscode.Uri | undefined {
    const fs = require('fs');
    const candidates = [
      path.join(docDir, importPath),
      workspaceRoot ? path.join(workspaceRoot, importPath) : null,
      workspaceRoot ? path.join(workspaceRoot, path.basename(importPath)) : null,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return vscode.Uri.file(candidate);
        }
      } catch {
        // skip
      }
    }
    return undefined;
  }
}
