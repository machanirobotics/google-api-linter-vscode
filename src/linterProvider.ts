import * as cp from "node:child_process";
import * as vscode from "vscode";
import { BinaryManager } from "./binaryManager";
import type { LinterOptions } from "./types";
import { getProtoPaths } from "./utils/configReader";
import { findProtoFiles } from "./utils/fileUtils";
import { buildLinterArgs, parseLinterOutput } from "./utils/linterUtils";

/**
 * Manages linting of Protocol Buffer files using the api-linter binary.
 * Handles running the linter, parsing output, and updating diagnostics.
 */
export class ApiLinterProvider {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private outputChannel: vscode.OutputChannel;
	private binaryManager: BinaryManager;
	private workspaceLintInProgress = false;

	/**
	 * Creates a new linter provider.
	 * @param diagnosticCollection - Collection for storing diagnostics
	 * @param outputChannel - Output channel for logging
	 */
	constructor(
		diagnosticCollection: vscode.DiagnosticCollection,
		outputChannel: vscode.OutputChannel,
	) {
		this.diagnosticCollection = diagnosticCollection;
		this.outputChannel = outputChannel;
		this.binaryManager = new BinaryManager(outputChannel);
	}

	/**
	 * Lints a single document and updates diagnostics.
	 * @param document - The document to lint
	 * @param saveFirst - Whether to save the document before linting (for unsaved changes)
	 */
	public async lintDocument(
		document: vscode.TextDocument,
		saveFirst: boolean = false,
	): Promise<void> {
		if (!document.fileName.endsWith(".proto")) {
			return;
		}

		if (saveFirst && document.isDirty) {
			await document.save();
		}

		const filePath = document.uri.fsPath;
		this.outputChannel.appendLine(`Starting lint for: ${filePath}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Google API Linter",
				cancellable: false,
			},
			async (progress) => {
				progress.report({ message: "Linting current file…" });
				try {
					const binaryPath = await this.binaryManager.ensureBinary();
					this.outputChannel.appendLine(`Using binary: ${binaryPath}`);

					if (!require("node:fs").existsSync(binaryPath)) {
						throw new Error(`Binary not found at ${binaryPath} after download`);
					}

					await this.binaryManager.ensureGoogleapis();
					await this.binaryManager.ensureProtobuf();

					const options = await this.getLinterOptions();
					const diagnostics = await this.runLinter(
						binaryPath,
						filePath,
						options,
					);

					this.outputChannel.appendLine(
						`Found ${diagnostics.length} diagnostic(s)`,
					);
					this.diagnosticCollection.set(document.uri, diagnostics);
				} catch (error) {
					this.outputChannel.appendLine(`Error linting ${filePath}: ${error}`);
					if (error instanceof Error) {
						this.outputChannel.appendLine(`Error stack: ${error.stack}`);
					}
					vscode.window.showErrorMessage(`Google API Linter error: ${error}`);
					this.diagnosticCollection.set(document.uri, []);
				}
			},
		);
	}

	/**
	 * Gets linter options from VS Code configuration.
	 * @returns Linter configuration options
	 */
	private async getLinterOptions(): Promise<LinterOptions> {
		const config = vscode.workspace.getConfiguration("gapi");

		// Get proto paths from workspace.protobuf.yaml and buf.yaml (modules + deps)
		const configProtoPaths = await getProtoPaths(this.outputChannel);
		const userProtoPaths = config.get<string[]>("protoPath") || [];

		// Merge config file paths with user settings
		const allProtoPaths = [...configProtoPaths, ...userProtoPaths];

		const options = {
			configPath: config.get<string>("configPath"),
			protoPath: allProtoPaths,
			disableRules: config.get<string[]>("disableRules") || [],
			enableRules: config.get<string[]>("enableRules") || [],
			outputFormat: config.get<string>("outputFormat") || "json",
			setExitStatus: config.get<boolean>("setExitStatus") || false,
		};

		// Log applied settings
		this.outputChannel.appendLine("=".repeat(60));
		this.outputChannel.appendLine("Applied Linter Settings:");
		this.outputChannel.appendLine(
			`  Config Path: ${options.configPath || "(not set)"}`,
		);
		this.outputChannel.appendLine(`  Proto Paths (${allProtoPaths.length}):`);
		if (configProtoPaths.length > 0) {
			this.outputChannel.appendLine(
				`    From workspace.protobuf.yaml and/or buf.yaml (modules + deps): ${configProtoPaths.length} path(s)`,
			);
			configProtoPaths.forEach((p: string) =>
				this.outputChannel.appendLine(`      - ${p}`),
			);
		}
		if (userProtoPaths.length > 0) {
			this.outputChannel.appendLine(
				`    From settings.json: ${userProtoPaths.length} path(s)`,
			);
			userProtoPaths.forEach((p) =>
				this.outputChannel.appendLine(`      - ${p}`),
			);
		}
		if (options.disableRules.length > 0) {
			this.outputChannel.appendLine(
				`  Disabled Rules: ${options.disableRules.join(", ")}`,
			);
		}
		if (options.enableRules.length > 0) {
			this.outputChannel.appendLine(
				`  Enabled Rules: ${options.enableRules.join(", ")}`,
			);
		}
		this.outputChannel.appendLine(
			`  Set Exit Status: ${options.setExitStatus}`,
		);
		this.outputChannel.appendLine(
			`  Enable on Save: ${config.get<boolean>("enableOnSave")}`,
		);
		this.outputChannel.appendLine(
			`  Enable on Type: ${config.get<boolean>("enableOnType")}`,
		);
		this.outputChannel.appendLine("=".repeat(60));

		return options;
	}

	/**
	 * Lints a single file by URI (does not require the document to be open).
	 */
	public async lintUri(uri: vscode.Uri): Promise<void> {
		const filePath = uri.fsPath;
		if (!filePath.endsWith(".proto")) return;

		this.outputChannel.appendLine(`Starting lint for: ${filePath}`);
		try {
			const binaryPath = await this.binaryManager.ensureBinary();
			if (!require("node:fs").existsSync(binaryPath)) {
				throw new Error(`Binary not found at ${binaryPath} after download`);
			}
			await this.binaryManager.ensureGoogleapis();
			await this.binaryManager.ensureProtobuf();
			const options = await this.getLinterOptions();
			const diagnostics = await this.runLinter(binaryPath, filePath, options);
			this.outputChannel.appendLine(
				`Found ${diagnostics.length} diagnostic(s)`,
			);
			this.diagnosticCollection.set(uri, diagnostics);
		} catch (error) {
			this.outputChannel.appendLine(`Error linting ${filePath}: ${error}`);
			this.diagnosticCollection.set(uri, []);
		}
	}

	/**
	 * Lints all proto files in the workspace (by path; does not open documents).
	 */
	public async lintWorkspace(): Promise<void> {
		if (this.workspaceLintInProgress) {
			vscode.window.showInformationMessage(
				"Workspace lint is already running.",
			);
			return;
		}
		const protoFiles = await findProtoFiles();
		if (protoFiles.length === 0) {
			vscode.window.showInformationMessage(
				"No .proto files found in workspace.",
			);
			return;
		}

		this.workspaceLintInProgress = true;
		const total = protoFiles.length;
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Google API Linter",
					cancellable: false,
				},
				async (progress) => {
					for (let i = 0; i < protoFiles.length; i++) {
						progress.report({
							message: `Linting ${i + 1}/${total}…`,
							increment: (100 / total) * (i === 0 ? 0 : 1),
						});
						await this.lintUri(protoFiles[i]);
					}
					progress.report({ message: "Done", increment: 100 });
				},
			);
			vscode.window.showInformationMessage(
				`Google API Linter: workspace linting completed (${total} file(s)).`,
			);
		} finally {
			this.workspaceLintInProgress = false;
		}
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
		options: LinterOptions,
	): Promise<vscode.Diagnostic[]> {
		return new Promise((resolve, reject) => {
			const { args, workingDir } = buildLinterArgs(filePath, options);

			this.outputChannel.appendLine(`Running: ${binaryPath} ${args.join(" ")}`);
			this.outputChannel.appendLine(`Working directory: ${workingDir}`);

			const process = cp.spawn(binaryPath, args, { cwd: workingDir });

			let stdout = "";
			let stderr = "";

			process.stdout.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			process.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			process.on("error", (error: Error) => {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					reject(
						new Error(
							`api-linter binary not found at: ${binaryPath}. Please install it or configure the correct path in settings.`,
						),
					);
				} else {
					reject(error);
				}
			});

			process.on("close", (code: number) => {
				if (stderr) {
					this.outputChannel.appendLine(`stderr: ${stderr}`);
				}

				// Log raw output for debugging
				this.outputChannel.appendLine(
					`Raw linter output (first 500 chars): ${stdout.substring(0, 500)}`,
				);

				// Try to parse diagnostics from stdout first (standard JSON output)
				let diagnostics = parseLinterOutput(stdout, this.outputChannel);

				// If no diagnostics found from stdout, check stderr (syntax errors often go here)
				if (diagnostics.length === 0 && stderr.trim().length > 0) {
					const stderrDiagnostics = parseLinterOutput(
						stderr,
						this.outputChannel,
					);
					if (stderrDiagnostics.length > 0) {
						diagnostics = stderrDiagnostics;
						this.outputChannel.appendLine(
							`Found ${diagnostics.length} diagnostic(s) in stderr`,
						);
					}
				}

				// Only reject if we failed and found no diagnostics
				// We allow other exit codes if we successfully parsed syntax errors
				if (diagnostics.length === 0 && code !== 0 && code !== 1) {
					this.outputChannel.appendLine(`api-linter exited with code ${code}`);
					this.outputChannel.appendLine(`stdout: ${stdout}`);
					reject(new Error(`api-linter exited with code ${code}`));
					return;
				}

				if (
					diagnostics.length === 0 &&
					stdout.trim() !== "" &&
					stdout.trim() !== "[]" &&
					stderr.trim() === ""
				) {
					this.outputChannel.appendLine(
						`Warning: No diagnostics parsed from output`,
					);
				}
				resolve(diagnostics);
			});
		});
	}
}
