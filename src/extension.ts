import * as vscode from 'vscode';
import { ApiLinterProvider } from './linterProvider';
import { ApiLinterHoverProvider } from './hoverProvider';
import { EXTENSION_NAME, OUTPUT_CHANNEL_NAME, PROTO_FILE_PATTERN, DIAGNOSTIC_SOURCE } from './constants';
import { ProtoDefinitionProvider } from './definitionProvider';
import { ProtoCompletionProvider } from './completionProvider';
import { ProtoSignatureHelpProvider } from './signatureHelpProvider';
import { ProtoDocumentSymbolProvider } from './documentSymbolProvider';
import { ProtoWorkspaceSymbolProvider } from './workspaceSymbolProvider';
import { ProtoReferenceProvider } from './referenceProvider';
import { ProtoRenameProvider } from './renameProvider';
import { ProtoCodeActionProvider } from './codeActionProvider';
import { ProtoDocumentLinkProvider } from './documentLinkProvider';
import { registerFormatProvider } from './formatProvider';
import { registerConfigValidation } from './configValidator';
import { registerStatusBar } from './statusBar';
import { ProtoSymbolHoverProvider } from './symbolHoverProvider';
import { ProtoFoldingRangeProvider } from './foldingProvider';
import { registerProtoView } from './protoView';
import { isProtoFile, getActiveProtoEditor } from './utils/fileUtils';
import {
  createLintCurrentFileCommand,
  createLintWorkspaceCommand,
  createConfigCommand,
  createRestartCommand,
  createUpdateGoogleapisCommitCommand,
  createReinstallCommand,
  createInitWorkspaceCommand,
} from './commands';

let diagnosticCollection: vscode.DiagnosticCollection;
let linterProvider: ApiLinterProvider;

/**
 * Activates the Google API Linter extension.
 * Sets up providers, commands, and document listeners.
 * @param context - The extension context provided by VS Code
 */
export async function activate(context: vscode.ExtensionContext) {
  try {
    console.log(`${EXTENSION_NAME} extension is now active`);
    
    diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    
    linterProvider = new ApiLinterProvider(diagnosticCollection, outputChannel);
    
    // Log startup message to output channel with version info
    outputChannel.appendLine('='.repeat(60));
    outputChannel.appendLine(`${EXTENSION_NAME} Extension Activated`);
    outputChannel.appendLine(`Extension Version: 1.1.2`);
    outputChannel.appendLine(`Timestamp: ${new Date().toISOString()}`);
    
    // Get binary manager to fetch versions
    const binaryManager = (linterProvider as any).binaryManager;
    const binaryVersion = await binaryManager.getBinaryVersion();
    const googleapisCommit = await binaryManager.getGoogleapisCommit();
    const protobufCommit = await binaryManager.getProtobufCommit();
    
    outputChannel.appendLine(`API Linter Version: ${binaryVersion}`);
    outputChannel.appendLine(`googleapis Commit: ${googleapisCommit}`);
    outputChannel.appendLine(`protobuf Commit: ${protobufCommit}`);
    outputChannel.appendLine('='.repeat(60));
    outputChannel.appendLine('');
    outputChannel.show(true); // Show the output channel
    
    vscode.window.showInformationMessage(`${EXTENSION_NAME} activated! Check Output panel.`);

    const protoDocSelector = [
      { scheme: 'file', language: 'proto3' },
      { scheme: 'file', language: 'protobuf' },
    ];
    context.subscriptions.push(
      diagnosticCollection,
      outputChannel,
      registerHoverProvider(diagnosticCollection),
      registerSymbolHoverProvider(protoDocSelector),
      registerDefinitionProvider(),
      registerReferenceProvider(protoDocSelector),
      registerRenameProvider(protoDocSelector),
      registerCodeActionProvider(protoDocSelector),
      registerDocumentLinkProvider(protoDocSelector),
      registerFormatProvider(protoDocSelector),
      registerDocumentSymbolProvider(protoDocSelector),
      registerWorkspaceSymbolProvider(),
      registerFoldingProvider(protoDocSelector),
      registerCompletionProvider(protoDocSelector),
      registerSignatureHelpProvider(protoDocSelector),
    );
    context.subscriptions.push(createLintCurrentFileCommand(linterProvider));
    context.subscriptions.push(createLintWorkspaceCommand(linterProvider));
    context.subscriptions.push(createConfigCommand());
    context.subscriptions.push(createRestartCommand(diagnosticCollection, linterProvider));
    context.subscriptions.push(createUpdateGoogleapisCommitCommand());
    context.subscriptions.push(createReinstallCommand(binaryManager));
    context.subscriptions.push(createInitWorkspaceCommand());

    registerProtoView(
      context,
      diagnosticCollection,
      () => binaryManager.getBinaryVersion(),
      () => binaryManager.getGoogleapisCommit()
    );

    registerStatusBar(context, diagnosticCollection);

    const configDiagnosticCollection = vscode.languages.createDiagnosticCollection(`${DIAGNOSTIC_SOURCE}-config`);
    registerConfigValidation(context, configDiagnosticCollection);

    registerDocumentListeners(context, linterProvider);
    lintActiveProtoFile();
  } catch (error) {
    console.error('Failed to activate extension:', error);
    vscode.window.showErrorMessage(`${EXTENSION_NAME} failed to activate: ${error}`);
  }
}

/**
 * Registers the hover provider for displaying rule documentation.
 * @param diagnosticCollection - The diagnostic collection to read from
 * @returns Disposable for the hover provider registration
 */
function registerHoverProvider(diagnosticCollection: vscode.DiagnosticCollection): vscode.Disposable {
  const hoverProvider = new ApiLinterHoverProvider(diagnosticCollection);
  return vscode.languages.registerHoverProvider(
    [
      { scheme: 'file', language: 'proto3' },
      { scheme: 'file', language: 'protobuf' }
    ],
    hoverProvider
  );
}

/**
 * Registers hover for proto symbols (message, service, enum, rpc) when no linter diagnostic at position.
 */
function registerSymbolHoverProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerHoverProvider(selector, new ProtoSymbolHoverProvider());
}

/**
 * Registers the definition provider for go-to-definition on proto types.
 * @returns Disposable for the definition provider registration
 */
function registerDefinitionProvider(): vscode.Disposable {
  const definitionProvider = new ProtoDefinitionProvider();
  return vscode.languages.registerDefinitionProvider(
    [
      { scheme: 'file', language: 'proto3' },
      { scheme: 'file', language: 'protobuf' }
    ],
    definitionProvider
  );
}

/**
 * Registers find references for message/enum/service types.
 */
function registerReferenceProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerReferenceProvider(selector, new ProtoReferenceProvider());
}

/**
 * Registers rename for message/service/enum/rpc; updates all references.
 */
function registerRenameProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerRenameProvider(selector, new ProtoRenameProvider());
}

/**
 * Registers code actions: Add (google.api.http), Add (google.api.resource), Add UNSPECIFIED enum value.
 */
function registerCodeActionProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(selector, new ProtoCodeActionProvider(), {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  });
}

/**
 * Registers document links for import "path/to/file.proto" (click to open).
 */
function registerDocumentLinkProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerDocumentLinkProvider(selector, new ProtoDocumentLinkProvider());
}

/**
 * Registers document outline (Outline view) for message, service, enum, rpc.
 */
function registerDocumentSymbolProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerDocumentSymbolProvider(selector, new ProtoDocumentSymbolProvider());
}

/**
 * Registers workspace symbol search (Go to Symbol in Workspace).
 */
function registerWorkspaceSymbolProvider(): vscode.Disposable {
  return vscode.languages.registerWorkspaceSymbolProvider(new ProtoWorkspaceSymbolProvider());
}

/**
 * Registers folding for message, service, enum, oneof blocks.
 */
function registerFoldingProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  return vscode.languages.registerFoldingRangeProvider(selector, new ProtoFoldingRangeProvider());
}

/**
 * Registers the completion provider for type hints (messages, services, RPC, options).
 * @param selector - Document selector for proto files
 * @returns Disposable for the completion provider registration
 */
function registerCompletionProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  const completionProvider = new ProtoCompletionProvider();
  return vscode.languages.registerCompletionItemProvider(selector, completionProvider);
}

/**
 * Registers the signature help provider for RPC and option(...) parameter hints.
 * @param selector - Document selector for proto files
 * @returns Disposable for the signature help provider registration
 */
function registerSignatureHelpProvider(selector: vscode.DocumentSelector): vscode.Disposable {
  const signatureHelpProvider = new ProtoSignatureHelpProvider();
  return vscode.languages.registerSignatureHelpProvider(selector, signatureHelpProvider, '(', ',');
}

/**
 * Registers document event listeners for auto-linting.
 * Handles save, change, open, and configuration change events.
 * @param context - The extension context
 * @param linterProvider - The linter provider instance
 */
function registerDocumentListeners(
  context: vscode.ExtensionContext,
  linterProvider: ApiLinterProvider
): void {
  const config = vscode.workspace.getConfiguration('gapi');
  const enableOnSave = config.get<boolean>('enableOnSave', true);
  const enableOnType = config.get<boolean>('enableOnType', false);

  if (enableOnSave) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (isProtoFile(document.fileName)) {
          await linterProvider.lintDocument(document);
        }
      })
    );
  }

  if (enableOnType) {
    const timeouts = new Map<string, NodeJS.Timeout>();
    
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(async (event) => {
        if (isProtoFile(event.document.fileName)) {
          const uri = event.document.uri.toString();
          
          const existingTimeout = timeouts.get(uri);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }
          
          const timeout = setTimeout(async () => {
            await linterProvider.lintDocument(event.document, true);
            timeouts.delete(uri);
          }, 1000);
          
          timeouts.set(uri, timeout);
        }
      })
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (isProtoFile(document.fileName)) {
        console.log('Proto file opened, linting:', document.fileName);
        await linterProvider.lintDocument(document);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gapi')) {
        vscode.window.showInformationMessage(
          `${EXTENSION_NAME} configuration changed. Reload window for changes to take effect.`
        );
      }
    })
  );
}

/**
 * Lints the currently active proto file if one is open.
 */
function lintActiveProtoFile(): void {
  try {
    const editor = getActiveProtoEditor();
    if (editor) {
      console.log('Active editor is proto file, linting immediately');
      linterProvider.lintDocument(editor.document);
    }
  } catch (error) {
    console.error('Error in lintActiveProtoFile:', error);
  }
}

/**
 * Deactivates the extension and cleans up resources.
 */
export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
}
