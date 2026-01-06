import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';
import { ApiLinterProvider } from './linterProvider';
import { CONFIG_TEMPLATE, CONFIG_FILE_NAME } from './constants';
import { getActiveProtoEditor, findProtoFiles } from './utils/fileUtils';

const exec = promisify(cp.exec);

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

/**
 * Creates the command to update googleapis commit in workspace .gapi directory.
 * @returns Disposable command registration
 */
export const createUpdateGoogleapisCommitCommand = () => {
  return vscode.commands.registerCommand(
    'googleApiLinter.updateGoogleapisCommit',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const commitHash = await vscode.window.showInputBox({
        prompt: 'Enter googleapis commit hash (leave empty for latest)',
        placeHolder: 'e.g., abc123def456 or leave empty',
        validateInput: (value) => {
          if (value && !/^[a-f0-9]{7,40}$/i.test(value)) {
            return 'Invalid commit hash format. Must be 7-40 hexadecimal characters.';
          }
          return null;
        }
      });

      if (commitHash === undefined) {
        return;
      }

      const gapiDir = path.join(workspaceFolders[0].uri.fsPath, '.gapi');
      const googleapisDir = path.join(gapiDir, 'googleapis');

      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading googleapis',
          cancellable: false
        }, async (progress) => {
          progress.report({ message: 'Checking buf CLI...' });
          
          try {
            await exec('buf --version');
          } catch {
            vscode.window.showErrorMessage(
              'buf CLI not found. Please install it first: https://buf.build/docs/installation'
            );
            return;
          }

          progress.report({ message: 'Creating .gapi directory...' });
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(gapiDir));

          progress.report({ message: 'Exporting googleapis protos...' });
          const bufRef = commitHash 
            ? `buf.build/googleapis/googleapis:${commitHash}`
            : 'buf.build/googleapis/googleapis';
          const command = `buf export ${bufRef} --output "${googleapisDir}"`;
          
          try {
            await exec(command);
          } catch (error) {
            throw new Error(`Failed to export googleapis: ${error}. Check if commit hash is valid.`);
          }

          const commitInfo = commitHash ? ` (commit: ${commitHash})` : ' (latest)';
          vscode.window.showInformationMessage(
            `googleapis${commitInfo} downloaded to ${path.relative(workspaceFolders[0].uri.fsPath, googleapisDir)}`
          );

          const updateConfig = await vscode.window.showInformationMessage(
            'Update workspace settings to use downloaded googleapis?',
            'Yes', 'No'
          );

          if (updateConfig === 'Yes') {
            const config = vscode.workspace.getConfiguration('gapi');
            const currentProtoPaths = config.get<string[]>('protoPath', []);
            const newPath = '${workspaceFolder}/.gapi/googleapis';
            
            if (!currentProtoPaths.includes(newPath)) {
              await config.update(
                'protoPath',
                [...currentProtoPaths, newPath],
                vscode.ConfigurationTarget.Workspace
              );
              vscode.window.showInformationMessage('Workspace settings updated!');
            }
          }
        });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to download googleapis: ${error}`);
      }
    }
  );
};

/**
 * Creates the command to reinstall all Google API Linter dependencies.
 * Deletes the .gapi directory and reinstalls api-linter, googleapis, and protobuf.
 * @param binaryManager - The binary manager instance
 * @returns Disposable command registration
 */
export const createReinstallCommand = (binaryManager: any) => {
  return vscode.commands.registerCommand(
    'googleApiLinter.reinstallAll',
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        'This will delete the .gapi directory and reinstall all dependencies (api-linter, googleapis, protobuf). Continue?',
        { modal: true },
        'Yes',
        'No'
      );

      if (confirm !== 'Yes') {
        return;
      }

      try {
        const gapiDir = path.join(os.homedir(), '.gapi');
        
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Reinstalling Google API Linter dependencies',
            cancellable: false
          },
          async (progress) => {
            // Delete .gapi directory
            progress.report({ message: 'Deleting .gapi directory...' });
            if (fs.existsSync(gapiDir)) {
              await fs.promises.rm(gapiDir, { recursive: true, force: true });
            }

            // Reinstall api-linter
            progress.report({ message: 'Downloading api-linter binary...' });
            await binaryManager.ensureBinary();

            // Reinstall googleapis
            progress.report({ message: 'Downloading googleapis...' });
            await binaryManager.ensureGoogleapis();

            // Reinstall protobuf
            progress.report({ message: 'Downloading protobuf...' });
            await binaryManager.ensureProtobuf();

            vscode.window.showInformationMessage('Successfully reinstalled all Google API Linter dependencies!');
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to reinstall dependencies: ${error}`);
      }
    }
  );
};
