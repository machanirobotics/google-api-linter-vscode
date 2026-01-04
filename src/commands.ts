import * as vscode from 'vscode';
import { ApiLinterProvider } from './linterProvider';
import { CONFIG_TEMPLATE, CONFIG_FILE_NAME } from './constants';
import { getActiveProtoEditor, findProtoFiles } from './utils/fileUtils';

/**
 * Creates the command to lint the currently active proto file.
 * @param linterProvider - The linter provider instance
 * @returns Disposable command registration
 */
export const createLintCurrentFileCommand = (linterProvider: ApiLinterProvider) => {
  return vscode.commands.registerCommand(
    'googleApiLinter.lintCurrentFile',
    async () => {
      const editor = getActiveProtoEditor();
      if (editor) {
        console.log('Linting:', editor.document.fileName, 'Language:', editor.document.languageId);
        await linterProvider.lintDocument(editor.document);
      } else {
        vscode.window.showWarningMessage('Please open a .proto file to lint.');
      }
    }
  );
};

/**
 * Creates the command to lint all proto files in the workspace.
 * @param linterProvider - The linter provider instance
 * @returns Disposable command registration
 */
export const createLintWorkspaceCommand = (linterProvider: ApiLinterProvider) => {
  return vscode.commands.registerCommand(
    'googleApiLinter.lintWorkspace',
    async () => {
      await linterProvider.lintWorkspace();
    }
  );
};

/**
 * Creates the command to generate a .api-linter.yaml configuration file.
 * @returns Disposable command registration
 */
export const createConfigCommand = () => {
  return vscode.commands.registerCommand(
    'googleApiLinter.createConfig',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, CONFIG_FILE_NAME);
      await vscode.workspace.fs.writeFile(configPath, Buffer.from(CONFIG_TEMPLATE, 'utf8'));
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`Created ${CONFIG_FILE_NAME} config file`);
    }
  );
};

/**
 * Creates the command to restart the linter and re-lint all open proto files.
 * @param diagnosticCollection - The diagnostic collection to clear
 * @param linterProvider - The linter provider instance
 * @returns Disposable command registration
 */
export const createRestartCommand = (
  diagnosticCollection: vscode.DiagnosticCollection,
  linterProvider: ApiLinterProvider
) => {
  return vscode.commands.registerCommand(
    'googleApiLinter.restart',
    async () => {
      diagnosticCollection.clear();
      vscode.window.showInformationMessage('Google API Linter restarted. Re-linting all open proto files...');
      
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.fileName.endsWith('.proto')) {
          await linterProvider.lintDocument(editor.document);
        }
      }
      
      vscode.window.showInformationMessage('Google API Linter restart complete!');
    }
  );
};
