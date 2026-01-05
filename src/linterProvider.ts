import * as vscode from 'vscode';
import * as cp from 'child_process';
import { BinaryManager } from './binaryManager';
import { LinterOptions } from './types';
import { buildLinterArgs, parseLinterOutput } from './utils/linterUtils';
import { findProtoFiles } from './utils/fileUtils';

/**
 * Manages linting of Protocol Buffer files using the api-linter binary.
 * Handles running the linter, parsing output, and updating diagnostics.
 */
export class ApiLinterProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private outputChannel: vscode.OutputChannel;
  private binaryManager: BinaryManager;

  /**
   * Creates a new linter provider.
   * @param diagnosticCollection - Collection for storing diagnostics
   * @param outputChannel - Output channel for logging
   */
  constructor(diagnosticCollection: vscode.DiagnosticCollection, outputChannel: vscode.OutputChannel) {
    this.diagnosticCollection = diagnosticCollection;
    this.outputChannel = outputChannel;
    this.binaryManager = new BinaryManager(outputChannel);
  }

  /**
   * Lints a single document and updates diagnostics.
   * @param document - The document to lint
   * @param saveFirst - Whether to save the document before linting (for unsaved changes)
   */
  public async lintDocument(document: vscode.TextDocument, saveFirst: boolean = false): Promise<void> {
    if (!document.fileName.endsWith('.proto')) {
      return;
    }

    if (saveFirst && document.isDirty) {
      await document.save();
    }

    const filePath = document.uri.fsPath;
    this.outputChannel.appendLine(`Starting lint for: ${filePath}`);

    try {
      const binaryPath = await this.binaryManager.ensureBinary();
      this.outputChannel.appendLine(`Using binary: ${binaryPath}`);
      
      const options = this.getLinterOptions();
      const diagnostics = await this.runLinter(binaryPath, filePath, options);
      
      this.outputChannel.appendLine(`Found ${diagnostics.length} diagnostic(s)`);
      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      this.outputChannel.appendLine(`Error linting ${filePath}: ${error}`);
      vscode.window.showErrorMessage(`Google API Linter error: ${error}`);
    }
  }

  /**
   * Gets linter options from workspace configuration.
   * @returns Linter options object
   */
  private getLinterOptions(): LinterOptions {
    const config = vscode.workspace.getConfiguration('gapi');
    return {
      configPath: config.get<string>('configPath', ''),
      protoPath: config.get<string[]>('protoPath', []),
      disableRules: config.get<string[]>('disableRules', []),
      enableRules: config.get<string[]>('enableRules', []),
      descriptorSetIn: config.get<string[]>('descriptorSetIn', []),
      ignoreCommentDisables: config.get<boolean>('ignoreCommentDisables', false),
      setExitStatus: config.get<boolean>('setExitStatus', false)
    };
  }

  /**
   * Lints all proto files in the workspace.
   */
  public async lintWorkspace(): Promise<void> {
    const protoFiles = await findProtoFiles();
    
    if (protoFiles.length === 0) {
      vscode.window.showInformationMessage('No .proto files found in workspace.');
      return;
    }

    vscode.window.showInformationMessage(`Linting ${protoFiles.length} proto file(s)...`);

    for (const fileUri of protoFiles) {
      const document = await vscode.workspace.openTextDocument(fileUri);
      await this.lintDocument(document);
    }

    vscode.window.showInformationMessage('Workspace linting completed.');
  }

  /**
   * Runs the linter binary on a file.
   * @param binaryPath - Path to the api-linter binary
   * @param filePath - Path to the file to lint
   * @param options - Linter configuration options
   * @returns Array of diagnostics found
   */
  private async runLinter(
    binaryPath: string,
    filePath: string,
    options: LinterOptions
  ): Promise<vscode.Diagnostic[]> {
    return new Promise((resolve, reject) => {
      const { args, workingDir } = buildLinterArgs(filePath, options);

      this.outputChannel.appendLine(`Running: ${binaryPath} ${args.join(' ')}`);
      this.outputChannel.appendLine(`Working directory: ${workingDir}`);

      const process = cp.spawn(binaryPath, args, { cwd: workingDir });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`api-linter binary not found at: ${binaryPath}. Please install it or configure the correct path in settings.`));
        } else {
          reject(error);
        }
      });

      process.on('close', (code) => {
        if (stderr) {
          this.outputChannel.appendLine(`stderr: ${stderr}`);
        }

        if (code !== 0 && code !== 1) {
          this.outputChannel.appendLine(`api-linter exited with code ${code}`);
          this.outputChannel.appendLine(`stdout: ${stdout}`);
          reject(new Error(`api-linter exited with code ${code}`));
          return;
        }

        try {
          const diagnostics = parseLinterOutput(stdout);
          resolve(diagnostics);
        } catch (error) {
          this.outputChannel.appendLine(`Failed to parse linter output: ${error}`);
          this.outputChannel.appendLine(`stdout: ${stdout}`);
          resolve([]);
        }
      });
    });
  }

}
