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
 * @param outputChannel - Optional output channel for logging
 * @returns Array of VS Code Diagnostic objects
 */
export const parseLinterOutput = (output: string, outputChannel?: vscode.OutputChannel): vscode.Diagnostic[] => {
  const diagnostics: vscode.Diagnostic[] = [];

  if (!output || output.trim() === '') {
    return diagnostics;
  }

  try {
    // Extract JSON array from output - linter might output non-JSON text before/after
    let jsonOutput = output.trim();
    
    // Find the first '[' which starts the JSON array
    const jsonStart = jsonOutput.indexOf('[');
    if (jsonStart === -1) {
      const msg = `No JSON array found in linter output. First 200 chars: ${output.substring(0, 200)}`;
      console.error(msg);
      if (outputChannel) {
        outputChannel.appendLine(`ERROR: ${msg}`);
      }
      return diagnostics;
    }
    
    // Find the last ']' which ends the JSON array
    const jsonEnd = jsonOutput.lastIndexOf(']');
    if (jsonEnd === -1 || jsonEnd < jsonStart) {
      const msg = `Invalid JSON array in linter output. First 200 chars: ${output.substring(0, 200)}`;
      console.error(msg);
      if (outputChannel) {
        outputChannel.appendLine(`ERROR: ${msg}`);
      }
      return diagnostics;
    }
    
    // Extract only the JSON part
    jsonOutput = jsonOutput.substring(jsonStart, jsonEnd + 1);
    
    if (outputChannel) {
      outputChannel.appendLine(`Extracted JSON (first 200 chars): ${jsonOutput.substring(0, 200)}`);
    }
    
    const results: LinterOutput[] = JSON.parse(jsonOutput);
    
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
    const msg = `Error parsing linter output: ${error}. First 200 chars: ${output.substring(0, 200)}`;
    console.error(msg);
    if (outputChannel) {
      outputChannel.appendLine(`ERROR: ${msg}`);
    }
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
