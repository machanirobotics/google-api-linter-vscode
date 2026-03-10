import * as vscode from 'vscode';

/**
 * Provides signature help (parameter hints) for Protocol Buffers:
 * - rpc MethodName( stream? Request ) returns ( stream? Response )
 * - option (google.api.http) = { get:, post:, body:, ... }
 */
export class ProtoSignatureHelpProvider implements vscode.SignatureHelpProvider {
  provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.SignatureHelp> {
    const line = document.lineAt(position).text;
    const prefix = line.substring(0, position.character);

    // RPC: "rpc Name(" or "rpc Name( stream" -> show request param
    if (/rpc\s+\w+\s*\(/.test(prefix) && !/returns\s*\(/.test(prefix)) {
      return this.rpcRequestSignature(prefix, position);
    }
    // RPC: "returns (" -> show response param
    if (/returns\s*\(/.test(prefix)) {
      return this.rpcResponseSignature(prefix, position);
    }
    // option (google.api.http) = { ... } -> show http option fields
    if (/option\s*\(\s*google\.api\.http\s*\)\s*=\s*\{/.test(prefix) || /option\s*\(\s*google\.api\.http\s*\)\s*=\s*\{\s*\w*/.test(prefix)) {
      return this.httpOptionSignature(prefix, position);
    }

    return null;
  }

  private rpcRequestSignature(prefix: string, position: vscode.Position): vscode.SignatureHelp {
    const sig = new vscode.SignatureInformation(
      'rpc MethodName(stream? Request) returns (stream? Response)',
      new vscode.MarkdownString(
        '**RPC method.**\n\n- First parenthesis: **request** type. Add `stream` for client streaming.\n- `returns ( ... )`: **response** type. Add `stream` for server streaming.'
      )
    );
    sig.parameters = [
      new vscode.ParameterInformation('stream? Request', 'Request message type (e.g. GetFooRequest). Prefix with `stream` for client streaming.'),
      new vscode.ParameterInformation('returns (stream? Response)', 'Response message type. Prefix with `stream` for server streaming.'),
    ];
    const help = new vscode.SignatureHelp();
    help.signatures = [sig];
    help.activeSignature = 0;
    help.activeParameter = prefix.includes('returns') ? 1 : 0;
    return help;
  }

  private rpcResponseSignature(prefix: string, position: vscode.Position): vscode.SignatureHelp {
    const sig = new vscode.SignatureInformation(
      'returns (stream? Response)',
      new vscode.MarkdownString('**Response type** for the RPC. Use `stream ResponseType` for server streaming.')
    );
    sig.parameters = [
      new vscode.ParameterInformation('stream? Response', 'Response message type (e.g. Foo).'),
    ];
    const help = new vscode.SignatureHelp();
    help.signatures = [sig];
    help.activeSignature = 0;
    help.activeParameter = 0;
    return help;
  }

  private httpOptionSignature(prefix: string, position: vscode.Position): vscode.SignatureHelp {
    const sig = new vscode.SignatureInformation(
      '(google.api.http) = { get | post | put | patch | delete, body? }',
      new vscode.MarkdownString(
        '**HTTP mapping.** Set one of: `get`, `post`, `put`, `patch`, `delete` (path string). Optionally set `body` to a request field name for the HTTP body.'
      )
    );
    sig.parameters = [
      new vscode.ParameterInformation('get: "/path"', 'GET path template. Use `{name}` for path variables.'),
      new vscode.ParameterInformation('post: "/path"', 'POST path.'),
      new vscode.ParameterInformation('put: "/path"', 'PUT path.'),
      new vscode.ParameterInformation('patch: "/path"', 'PATCH path.'),
      new vscode.ParameterInformation('delete: "/path"', 'DELETE path.'),
      new vscode.ParameterInformation('body: "field_name"', 'Request field whose value is the HTTP body.'),
    ];
    const help = new vscode.SignatureHelp();
    help.signatures = [sig];
    help.activeSignature = 0;
    help.activeParameter = 0;
    return help;
  }
}
