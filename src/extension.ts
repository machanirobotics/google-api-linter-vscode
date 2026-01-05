import * as vscode from 'vscode';
import { ApiLinterProvider } from './linterProvider';
import { ApiLinterHoverProvider } from './hoverProvider';
import { EXTENSION_NAME, OUTPUT_CHANNEL_NAME, PROTO_FILE_PATTERN, DIAGNOSTIC_SOURCE } from './constants';
import { isProtoFile, getActiveProtoEditor } from './utils/fileUtils';
import {
  createLintCurrentFileCommand,
  createLintWorkspaceCommand,
  createConfigCommand,
  createRestartCommand,
  createUpdateGoogleapisCommitCommand,
} from './commands';

let diagnosticCollection: vscode.DiagnosticCollection;
let linterProvider: ApiLinterProvider;
let lintTimeout: NodeJS.Timeout | undefined;

/**
 * Activates the Google API Linter extension.
 * Sets up providers, commands, and document listeners.
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  console.log(`${EXTENSION_NAME} extension is now active`);
  vscode.window.showInformationMessage(`${EXTENSION_NAME} activated!`);

  diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  linterProvider = new ApiLinterProvider(diagnosticCollection, outputChannel);

  context.subscriptions.push(
    diagnosticCollection,
    outputChannel,
    registerHoverProvider(diagnosticCollection),
    createLintCurrentFileCommand(linterProvider),
    createLintWorkspaceCommand(linterProvider),
    createConfigCommand(),
    createRestartCommand(diagnosticCollection, linterProvider),
    createUpdateGoogleapisCommitCommand()
  );

  registerDocumentListeners(context, linterProvider);
  lintActiveProtoFile();
}

/**
 * Registers the hover provider for displaying rule documentation.
 * @param diagnosticCollection - The diagnostic collection to read from
 * @returns Disposable for the hover provider registration
 */
function registerHoverProvider(diagnosticCollection: vscode.DiagnosticCollection): vscode.Disposable {
  const hoverProvider = new ApiLinterHoverProvider(diagnosticCollection);
  return vscode.languages.registerHoverProvider(
    { scheme: 'file', pattern: PROTO_FILE_PATTERN },
    hoverProvider
  );
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
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(async (event) => {
        if (isProtoFile(event.document.fileName)) {
          if (lintTimeout) {
            clearTimeout(lintTimeout);
          }
          
          lintTimeout = setTimeout(async () => {
            await linterProvider.lintDocument(event.document, true);
          }, 1000);
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
  const editor = getActiveProtoEditor();
  if (editor) {
    console.log('Active editor is proto file, linting immediately');
    linterProvider.lintDocument(editor.document);
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
