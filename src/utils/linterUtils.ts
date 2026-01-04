import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LinterOptions, LinterOutput, LinterProblem } from '../types';

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

  if (options.configPath && fs.existsSync(options.configPath)) {
    args.push('--config', options.configPath);
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const workingDir = path.dirname(absolutePath);
  const fileName = path.basename(absolutePath);
  
  args.push('--proto-path', workingDir);
  
  options.protoPath.forEach(protoPath => {
    args.push('--proto-path', protoPath);
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
    vscode.DiagnosticSeverity.Warning
  );
  
  diagnostic.source = 'google-api-linter';
  diagnostic.code = {
    value: problem.rule_id,
    target: vscode.Uri.parse(problem.rule_doc_uri)
  };

  return diagnostic;
};
