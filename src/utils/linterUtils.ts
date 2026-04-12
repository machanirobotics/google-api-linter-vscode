import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import YAML from "yaml";
import { CONFIG_FILE_NAME } from "../constants";
import type { LinterOptions, LinterOutput, LinterProblem } from "../types";

export type ResolvedApiLinterConfig = {
	/** Path passed to api-linter --config */
	path: string;
	/** Temp file to delete after the run, if any */
	tempFile: string | null;
};

/**
 * api-linter expects config to be an array of config objects (lint.Configs).
 * If the file is a single map (e.g. disabled_rules at top level), wrap it in an array
 * and write to a temp file so the binary can parse it.
 */
function resolveConfigToArrayFormat(configPath: string): ResolvedApiLinterConfig {
	try {
		const raw = fs.readFileSync(configPath, "utf8");
		const parsed = YAML.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return { path: configPath, tempFile: null };
		}
		if (Array.isArray(parsed)) {
			return { path: configPath, tempFile: null };
		}
		// Single map: wrap in array and write to temp file
		const arrayConfig = [parsed];
		const tempPath = path.join(
			os.tmpdir(),
			`api-linter-config-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`,
		);
		fs.writeFileSync(tempPath, YAML.stringify(arrayConfig), "utf8");
		return { path: tempPath, tempFile: tempPath };
	} catch {
		return { path: configPath, tempFile: null };
	}
}

/**
 * Resolves workspace variables in a path string.
 * @param pathStr - Path string potentially containing variables like ${workspaceFolder}
 * @param filePath - Current file path for context
 * @returns Resolved absolute path
 */
const resolveWorkspaceVariables = (
	pathStr: string,
	filePath: string,
): string => {
	let resolved = pathStr;

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(
			vscode.Uri.file(filePath),
		);
		const workspacePath =
			workspaceFolder?.uri.fsPath || workspaceFolders[0].uri.fsPath;

		resolved = resolved.replace(/\$\{workspaceFolder\}/g, workspacePath);
		resolved = resolved.replace(/\$\{workspaceRoot\}/g, workspacePath);
	}

	return path.resolve(resolved);
};

/**
 * Find .api-linter.yaml in workspace root or walking up from the file's directory.
 * So linting works from inside any folder and the config is still used.
 */
function findApiLinterConfig(filePath: string): string | null {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const workspaceRoot = workspaceFolders?.length
		? (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri
				.fsPath ?? workspaceFolders[0].uri.fsPath)
		: path.dirname(filePath);
	const rootAt = path.resolve(workspaceRoot);
	let dir = path.resolve(path.dirname(filePath));
	while (dir && (dir === rootAt || dir.startsWith(rootAt + path.sep))) {
		const candidate = path.join(dir, CONFIG_FILE_NAME);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
		if (dir === rootAt) {
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	const atRoot = path.join(rootAt, CONFIG_FILE_NAME);
	return fs.existsSync(atRoot) ? atRoot : null;
}

/**
 * If the file is under a directory named "protobuf", return that directory so
 * imports like "store/info/v1/category.proto" resolve (root = protobuf).
 */
function getProtobufRootProtoPath(filePath: string): string | null {
	const absolute = path.resolve(filePath);
	const parts = absolute.split(path.sep);
	for (let i = parts.length - 2; i >= 0; i--) {
		if (parts[i] === "protobuf") {
			const protoRoot = parts.slice(0, i + 1).join(path.sep);
			if (fs.existsSync(protoRoot)) {
				return protoRoot;
			}
			return null;
		}
	}
	return null;
}

/**
 * Builds command-line arguments for the api-linter binary.
 * @param filePath - Path to the proto file to lint
 * @param options - Linter configuration options
 * @returns Object containing args array, working directory, and file name
 */
export const buildLinterArgs = (
	filePath: string,
	options: LinterOptions,
): {
	args: string[];
	workingDir: string;
	fileName: string;
	/** Temp config from resolveConfigToArrayFormat — unlink after spawn completes */
	tempConfigPath: string | null;
} => {
	const args: string[] = [];
	let tempConfigPath: string | null = null;

	const configToUse = options.configPath
		? resolveWorkspaceVariables(options.configPath, filePath)
		: findApiLinterConfig(filePath);
	if (configToUse && fs.existsSync(configToUse)) {
		const resolved = resolveConfigToArrayFormat(configToUse);
		args.push("--config", resolved.path);
		tempConfigPath = resolved.tempFile;
	}

	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(filePath);
	const workingDir = path.dirname(absolutePath);
	const fileName = path.basename(absolutePath);

	args.push("--proto-path", workingDir);

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(
			vscode.Uri.file(filePath),
		);
		const workspaceRoot =
			workspaceFolder?.uri.fsPath || workspaceFolders[0].uri.fsPath;

		if (workspaceRoot !== workingDir && fs.existsSync(workspaceRoot)) {
			args.push("--proto-path", workspaceRoot);
		}

		const workspaceGapiDir = path.join(workspaceRoot, ".gapi", "googleapis");
		if (fs.existsSync(workspaceGapiDir)) {
			args.push("--proto-path", workspaceGapiDir);
		}
	}

	const protobufRoot = getProtobufRootProtoPath(filePath);
	if (protobufRoot) {
		args.push("--proto-path", protobufRoot);
	}

	const homeGapiDir = path.join(
		require("node:os").homedir(),
		".gapi",
		"googleapis",
	);
	if (fs.existsSync(homeGapiDir)) {
		args.push("--proto-path", homeGapiDir);
	}

	options.protoPath.forEach((protoPath) => {
		const resolvedPath = resolveWorkspaceVariables(protoPath, filePath);
		if (fs.existsSync(resolvedPath)) {
			args.push("--proto-path", resolvedPath);
		}
	});

	options.disableRules.forEach((rule) => {
		args.push("--disable-rule", rule);
	});

	options.enableRules.forEach((rule) => {
		args.push("--enable-rule", rule);
	});

	if (options.setExitStatus) {
		args.push("--set-exit-status");
	}

	args.push("--output-format", "json");
	args.push(fileName);

	return { args, workingDir, fileName, tempConfigPath };
};

/**
 * Parses JSON output from the api-linter into VS Code diagnostics.
 * @param output - Raw JSON output from the linter
 * @param outputChannel - Optional output channel for logging
 * @returns Array of VS Code Diagnostic objects
 */
export const parseLinterOutput = (
	output: string,
	outputChannel?: vscode.OutputChannel,
): vscode.Diagnostic[] => {
	const diagnostics: vscode.Diagnostic[] = [];

	if (!output || output.trim() === "") {
		return diagnostics;
	}

	try {
		// Extract JSON array from output - linter might output non-JSON text before/after
		let jsonOutput = output.trim();

		// Find the first '[' which starts the JSON array
		const jsonStart = jsonOutput.indexOf("[");
		if (jsonStart === -1) {
			if (outputChannel) {
				outputChannel.appendLine(
					`No JSON array found, trying generic output parser`,
				);
			}
			return parseGenericOutput(output, outputChannel);
		}

		// Find the last ']' which ends the JSON array
		const jsonEnd = jsonOutput.lastIndexOf("]");
		if (jsonEnd === -1 || jsonEnd < jsonStart) {
			if (outputChannel) {
				outputChannel.appendLine(
					`Invalid JSON array, trying generic output parser`,
				);
			}
			return parseGenericOutput(output, outputChannel);
		}

		// Extract only the JSON part
		jsonOutput = jsonOutput.substring(jsonStart, jsonEnd + 1);

		if (outputChannel) {
			outputChannel.appendLine(
				`Extracted JSON (first 200 chars): ${jsonOutput.substring(0, 200)}`,
			);
		}

		const results: LinterOutput[] = JSON.parse(jsonOutput);

		results.forEach((result) => {
			if (!result.problems || result.problems.length === 0) {
				return;
			}

			result.problems.forEach((problem) => {
				const diagnostic = createDiagnosticFromProblem(problem);
				diagnostics.push(diagnostic);
			});
		});
	} catch (error) {
		// If JSON parsing fails, try to parse as generic text output (e.g. syntax errors)
		if (outputChannel) {
			outputChannel.appendLine(
				`JSON parsing failed, trying generic output parser: ${error}`,
			);
		}
		return parseGenericOutput(output, outputChannel);
	}

	return diagnostics;
};

/**
 * Parses generic text output (e.g., syntax errors) from the linter.
 * Format: file_path:line:col: message
 */
export const parseGenericOutput = (
	output: string,
	outputChannel?: vscode.OutputChannel,
): vscode.Diagnostic[] => {
	const diagnostics: vscode.Diagnostic[] = [];
	const lines = output.split("\n");

	// Regex for "file:line:col: message", with optional Go log timestamp prefix
	// Example: "proto/library.proto:12:4: syntax error: unexpected identifier"
	// Example: "2026/02/20 14:49:31 proto/library.proto:12:4: syntax error: ..."
	const errorRegex =
		/^(?:\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} )?([^:]+):(\d+):(\d+):\s*(.*)$/;

	for (const line of lines) {
		const match = line.match(errorRegex);
		if (match) {
			const [, , lineStr, colStr, message] = match;

			const lineNum = parseInt(lineStr, 10) - 1; // 1-based to 0-based
			const colNum = parseInt(colStr, 10) - 1; // 1-based to 0-based

			if (lineNum >= 0 && colNum >= 0) {
				const range = new vscode.Range(lineNum, colNum, lineNum, 200); // 200 is arbitrary end char
				const diagnostic = new vscode.Diagnostic(
					range,
					message.trim(),
					vscode.DiagnosticSeverity.Error,
				);
				diagnostic.source = "google-api-linter (syntax)";
				diagnostics.push(diagnostic);
			}
		}
	}

	if (outputChannel && diagnostics.length > 0) {
		outputChannel.appendLine(
			`Parsed ${diagnostics.length} syntax error(s) from text output`,
		);
	}

	return diagnostics;
};

/**
 * Parses buf/protoc-style stderr (file:line:col: message) and returns diagnostics
 * only for the given file. Paths in the output are resolved relative to cwd.
 */
export function parseSyntaxErrorsForFile(
	output: string,
	currentFileAbsolutePath: string,
	cwd: string,
): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];
	const lines = output.split("\n");
	const errorRegex =
		/^(?:\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} )?([^:]+):(\d+):(\d+):\s*(.*)$/;
	const normalizedCurrent = path.normalize(currentFileAbsolutePath);

	for (const line of lines) {
		const match = line.match(errorRegex);
		if (!match) {
			continue;
		}
		const filePathFromError = match[1].trim();
		const lineStr = match[2];
		const colStr = match[3];
		const message = match[4].trim();
		const resolvedPath = path.normalize(
			path.isAbsolute(filePathFromError)
				? filePathFromError
				: path.join(cwd, filePathFromError),
		);
		if (resolvedPath !== normalizedCurrent) {
			continue;
		}

		const lineNum = parseInt(lineStr, 10) - 1;
		const colNum = Math.max(0, parseInt(colStr, 10) - 1);
		const range = new vscode.Range(
			lineNum,
			colNum,
			lineNum,
			Math.max(colNum + 1, 200),
		);
		const diagnostic = new vscode.Diagnostic(
			range,
			message,
			vscode.DiagnosticSeverity.Error,
		);
		diagnostic.source = "google-api-linter (syntax)";
		diagnostics.push(diagnostic);
	}
	return diagnostics;
}

/**
 * Runs `buf build` to detect proto syntax errors and returns diagnostics for the given file.
 * Uses gapi.bufPath for the buf binary. No-op if buf is not available.
 */
export async function runBufSyntaxCheck(
	fileAbsolutePath: string,
	outputChannel?: vscode.OutputChannel,
): Promise<vscode.Diagnostic[]> {
	const bufPath = vscode.workspace
		.getConfiguration("gapi")
		.get<string>("bufPath", "buf");
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const cwd =
		workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(fileAbsolutePath);

	return new Promise((resolve) => {
		const child = cp.spawn(bufPath, ["build"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString();
		});
		child.on("error", () => resolve([]));
		child.on("close", (code) => {
			if (code === 0) {
				resolve([]);
				return;
			}
			const diagnostics = parseSyntaxErrorsForFile(
				stderr,
				fileAbsolutePath,
				cwd,
			);
			if (outputChannel && diagnostics.length > 0) {
				outputChannel.appendLine(
					`Buf syntax check: ${diagnostics.length} error(s) in ${path.basename(fileAbsolutePath)}`,
				);
			}
			resolve(diagnostics);
		});
	});
}

/**
 * Creates a VS Code Diagnostic from a linter problem.
 * @param problem - The linter problem to convert
 * @returns A VS Code Diagnostic object
 */
const createDiagnosticFromProblem = (
	problem: LinterProblem,
): vscode.Diagnostic => {
	const startLine = Math.max(
		0,
		problem.location.start_position.line_number - 1,
	);
	const startChar = Math.max(
		0,
		problem.location.start_position.column_number - 1,
	);
	const endLine = Math.max(0, problem.location.end_position.line_number - 1);
	const endChar = Math.max(0, problem.location.end_position.column_number - 1);

	const diagnostic = new vscode.Diagnostic(
		new vscode.Range(startLine, startChar, endLine, endChar),
		problem.message,
		vscode.DiagnosticSeverity.Error,
	);

	diagnostic.source = "google-api-linter";

	// Use configurable documentation endpoint
	const config = vscode.workspace.getConfiguration("gapi");
	const baseUrl =
		config.get<string>("rulesDocumentationEndpoint") ||
		"https://linter.aip.dev";
	const ruleDocUri = problem.rule_doc_uri.replace(
		"https://linter.aip.dev",
		baseUrl,
	);

	diagnostic.code = {
		value: problem.rule_id,
		target: vscode.Uri.parse(ruleDocUri),
	};

	return diagnostic;
};
