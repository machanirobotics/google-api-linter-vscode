import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LinterOptions, LinterOutput, LinterProblem } from '../types';

/**
 * Resolves workspace variables in a path string.
 * @param pathStr - Path string potentially containing variables like ${workspaceFolder}
 * @param filePath - Current file path for context
 * @returns Resolved absolute path
 */
const resolveWorkspaceVariables = (pathStr: string, filePath: string): string => {
  let resolved = pathStr;

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    const workspacePath = workspaceFolder?.uri.fsPath || workspaceFolders[0].uri.fsPath;
    
    resolved = resolved.replace(/\$\{workspaceFolder\}/g, workspacePath);
    resolved = resolved.replace(/\$\{workspaceRoot\}/g, workspacePath);
  }

  return path.resolve(resolved);
};

/**
 * Builds command-line arguments for the api-linter binary.
 * @param filePath - Path to the proto file to lint
 * @param options - Linter configuration options
 * @returns Object containing args array, working directory, and file name
 */
export const buildLinterArgs = (
  filePath: string,
  options: LinterOptions
): { args: string[]; workingDir: string; fileName: string } => {
  const args: string[] = [];

  if (options.configPath) {
    const resolvedConfigPath = resolveWorkspaceVariables(options.configPath, filePath);
    if (fs.existsSync(resolvedConfigPath)) {
      args.push('--config', resolvedConfigPath);
    }
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const workingDir = path.dirname(absolutePath);
  const fileName = path.basename(absolutePath);
  
  args.push('--proto-path', workingDir);
  
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    const workspaceRoot = workspaceFolder?.uri.fsPath || workspaceFolders[0].uri.fsPath;
    
    if (workspaceRoot !== workingDir && fs.existsSync(workspaceRoot)) {
      args.push('--proto-path', workspaceRoot);
    }
    
    const workspaceGapiDir = path.join(workspaceRoot, '.gapi', 'googleapis');
    if (fs.existsSync(workspaceGapiDir)) {
      args.push('--proto-path', workspaceGapiDir);
    }
  }
  
  const homeGapiDir = path.join(require('os').homedir(), '.gapi', 'googleapis');
  if (fs.existsSync(homeGapiDir)) {
    args.push('--proto-path', homeGapiDir);
  }
  
  options.protoPath.forEach(protoPath => {
    const resolvedPath = resolveWorkspaceVariables(protoPath, filePath);
    if (fs.existsSync(resolvedPath)) {
      args.push('--proto-path', resolvedPath);
    }
  });
  
  options.disableRules.forEach(rule => {
    args.push('--disable-rule', rule);
  });
  
  options.enableRules.forEach(rule => {
    args.push('--enable-rule', rule);
  });
  
  options.descriptorSetIn.forEach(descriptorSet => {
    args.push('--descriptor-set-in', descriptorSet);
  });
  
  if (options.ignoreCommentDisables) {
    args.push('--ignore-comment-disables');
  }
  
  if (options.setExitStatus) {
    args.push('--set-exit-status');
  }
  
  args.push('--output-format', 'json');
  args.push(fileName);

  return { args, workingDir, fileName };
};

/**
 * Parses JSON output from the api-linter into VS Code diagnostics.
 * @param output - Raw JSON output from the linter
 * @returns Array of VS Code Diagnostic objects
 */
export const parseLinterOutput = (output: string): vscode.Diagnostic[] => {
  const diagnostics: vscode.Diagnostic[] = [];

  if (!output || output.trim() === '') {
    return diagnostics;
  }

  try {
    const results: LinterOutput[] = JSON.parse(output);
    
    results.forEach(result => {
      if (!result.problems || result.problems.length === 0) {
        return;
      }

      result.problems.forEach(problem => {
        const diagnostic = createDiagnosticFromProblem(problem);
        diagnostics.push(diagnostic);
      });
    });
  } catch (error) {
    console.error('Error parsing linter output:', error);
  }

  return diagnostics;
};

/**
 * Converts a linter problem to a VS Code diagnostic.
 * @param problem - Problem object from linter output
 * @returns VS Code Diagnostic object
 */
const createDiagnosticFromProblem = (problem: LinterProblem): vscode.Diagnostic => {
  const startLine = Math.max(0, problem.location.start_position.line_number - 1);
  const startChar = Math.max(0, problem.location.start_position.column_number - 1);
  const endLine = Math.max(0, problem.location.end_position.line_number - 1);
  const endChar = Math.max(0, problem.location.end_position.column_number - 1);

  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(startLine, startChar, endLine, endChar),
    problem.message,
    vscode.DiagnosticSeverity.Error
  );
  
  diagnostic.source = 'google-api-linter';
  diagnostic.code = {
    value: problem.rule_id,
    target: vscode.Uri.parse(problem.rule_doc_uri)
  };

  return diagnostic;
};
