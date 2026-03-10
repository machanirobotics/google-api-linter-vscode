import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * DocumentFormattingEditProvider for .proto files.
 * Tries `buf format` if available; otherwise applies a simple indent formatter.
 */
export class ProtoFormatProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    return this.formatWithBuf(document).then((formatted) => {
      if (formatted !== null) {
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
      return this.simpleFormat(document, options);
    });
  }

  private async formatWithBuf(document: vscode.TextDocument): Promise<string | null> {
    const text = document.getText();
    let tempPath: string | null = null;
    try {
      const ext = document.uri.fsPath.endsWith('.proto') ? '' : '.proto';
      const tmpFile = path.join(os.tmpdir(), `proto-format-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, text, 'utf8');
      tempPath = tmpFile;
      const result = await new Promise<string>((resolve, reject) => {
        cp.execFile('buf', ['format', tmpFile], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(stdout);
        });
      });
      return result;
    } catch {
      return null;
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {}
      }
    }
  }

  /** Simple formatter: indent per brace level, trim trailing whitespace, single newline at EOF. */
  private simpleFormat(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const lines = document.getText().split(/\r?\n/);
    const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    let depth = 0;
    const out: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        out.push('');
        continue;
      }
      const openCount = (line.match(/\{/g) ?? []).length;
      const closeCount = (line.match(/\}/g) ?? []).length;
      out.push(indent.repeat(depth) + trimmed);
      depth = Math.max(0, depth + openCount - closeCount);
    }
    let result = out.join('\n').trimEnd();
    if (result && !result.endsWith('\n')) {
      result += '\n';
    }
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    return [vscode.TextEdit.replace(fullRange, result)];
  }
}

export function registerFormatProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider(
    selector,
    new ProtoFormatProvider()
  );
}
