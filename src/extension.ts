import * as vscode from "vscode";
import { ProtoCodeActionProvider } from "./codeActionProvider";
import {
	createConfigCommand,
	createFormatAllProtosCommand,
	createFormatFileFromTreeCommand,
	createInitWorkspaceCommand,
	createLintCurrentFileCommand,
	createLintFileFromTreeCommand,
	createLintWorkspaceCommand,
	createReinstallCommand,
	createRestartCommand,
	createUpdateGoogleapisCommitCommand,
} from "./commands";
import { ProtoCompletionProvider } from "./completionProvider";
import { registerConfigValidation } from "./configValidator";
import {
	DIAGNOSTIC_SOURCE,
	EXTENSION_NAME,
	OUTPUT_CHANNEL_NAME,
} from "./constants";
import { ProtoDefinitionProvider } from "./definitionProvider";
import { ProtoDocumentLinkProvider } from "./documentLinkProvider";
import { ProtoDocumentSymbolProvider } from "./documentSymbolProvider";
import { ProtoFoldingRangeProvider } from "./foldingProvider";
import { getFormatEdits, registerFormatProvider } from "./formatProvider";
import { ApiLinterHoverProvider } from "./hoverProvider";
import { ApiLinterProvider } from "./linterProvider";
import { registerProtoView } from "./protoView";
import { ProtoReferenceProvider } from "./referenceProvider";
import { ProtoRenameProvider } from "./renameProvider";
import { ProtoSignatureHelpProvider } from "./signatureHelpProvider";
import { registerStatusBar } from "./statusBar";
import { ProtoSymbolHoverProvider } from "./symbolHoverProvider";
import { getActiveProtoEditor, isProtoFile } from "./utils/fileUtils";
import { ProtoWorkspaceSymbolProvider } from "./workspaceSymbolProvider";

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

		diagnosticCollection =
			vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
		const outputChannel =
			vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

		linterProvider = new ApiLinterProvider(diagnosticCollection, outputChannel);
		const binaryManager = linterProvider.getBinaryManager();

		const protoDocSelector = [
			{ scheme: "file", language: "proto3" },
			{ scheme: "file", language: "protobuf" },
		];
		const definitionProvider = new ProtoDefinitionProvider();
		context.subscriptions.push(
			diagnosticCollection,
			outputChannel,
			registerHoverProvider(diagnosticCollection),
			registerSymbolHoverProvider(protoDocSelector),
			registerDefinitionProvider(definitionProvider),
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
		context.subscriptions.push(createFormatAllProtosCommand());
		context.subscriptions.push(createLintFileFromTreeCommand(linterProvider));
		context.subscriptions.push(createFormatFileFromTreeCommand());
		context.subscriptions.push(createConfigCommand());
		context.subscriptions.push(
			createRestartCommand(diagnosticCollection, linterProvider),
		);
		context.subscriptions.push(createUpdateGoogleapisCommitCommand());
		context.subscriptions.push(createReinstallCommand(binaryManager));
		context.subscriptions.push(createInitWorkspaceCommand());

		registerProtoView(
			context,
			diagnosticCollection,
			() => binaryManager.getBinaryVersion(),
			() => binaryManager.getGoogleapisCommit(),
			() => binaryManager.getProtobufCommit(),
			(typeName: string, contextUri: vscode.Uri) =>
				definitionProvider.resolveTypeToLocation(typeName, contextUri),
		);

		registerStatusBar(context, diagnosticCollection);

		const configDiagnosticCollection =
			vscode.languages.createDiagnosticCollection(
				`${DIAGNOSTIC_SOURCE}-config`,
			);
		registerConfigValidation(context, configDiagnosticCollection);

		registerDocumentListeners(context, linterProvider);
	} catch (error) {
		console.error("Failed to activate extension:", error);
		vscode.window.showErrorMessage(
			`${EXTENSION_NAME} failed to activate: ${error}`,
		);
	}
}

/**
 * Registers the hover provider for displaying rule documentation.
 * @param diagnosticCollection - The diagnostic collection to read from
 * @returns Disposable for the hover provider registration
 */
function registerHoverProvider(
	diagnosticCollection: vscode.DiagnosticCollection,
): vscode.Disposable {
	const hoverProvider = new ApiLinterHoverProvider(diagnosticCollection);
	return vscode.languages.registerHoverProvider(
		[
			{ scheme: "file", language: "proto3" },
			{ scheme: "file", language: "protobuf" },
		],
		hoverProvider,
	);
}

/**
 * Registers hover for proto symbols (message, service, enum, rpc) when no linter diagnostic at position.
 */
function registerSymbolHoverProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerHoverProvider(
		selector,
		new ProtoSymbolHoverProvider(),
	);
}

/**
 * Registers the definition provider for go-to-definition on proto types.
 * @returns Disposable for the definition provider registration
 */
function registerDefinitionProvider(
	definitionProvider: ProtoDefinitionProvider,
): vscode.Disposable {
	return vscode.languages.registerDefinitionProvider(
		[
			{ scheme: "file", language: "proto3" },
			{ scheme: "file", language: "protobuf" },
		],
		definitionProvider,
	);
}

/**
 * Registers find references for message/enum/service types.
 */
function registerReferenceProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerReferenceProvider(
		selector,
		new ProtoReferenceProvider(),
	);
}

/**
 * Registers rename for message/service/enum/rpc; updates all references.
 */
function registerRenameProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerRenameProvider(
		selector,
		new ProtoRenameProvider(),
	);
}

/**
 * Registers code actions: Add (google.api.http), Add (google.api.resource), Add UNSPECIFIED enum value.
 */
function registerCodeActionProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerCodeActionsProvider(
		selector,
		new ProtoCodeActionProvider(),
		{
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
		},
	);
}

/**
 * Registers document links for import "path/to/file.proto" (click to open).
 */
function registerDocumentLinkProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerDocumentLinkProvider(
		selector,
		new ProtoDocumentLinkProvider(),
	);
}

/**
 * Registers document outline (Outline view) for message, service, enum, rpc.
 */
function registerDocumentSymbolProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerDocumentSymbolProvider(
		selector,
		new ProtoDocumentSymbolProvider(),
	);
}

/**
 * Registers workspace symbol search (Go to Symbol in Workspace).
 */
function registerWorkspaceSymbolProvider(): vscode.Disposable {
	return vscode.languages.registerWorkspaceSymbolProvider(
		new ProtoWorkspaceSymbolProvider(),
	);
}

/**
 * Registers folding for message, service, enum, oneof blocks.
 */
function registerFoldingProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerFoldingRangeProvider(
		selector,
		new ProtoFoldingRangeProvider(),
	);
}

/**
 * Registers the completion provider for type hints (messages, services, RPC, options).
 * @param selector - Document selector for proto files
 * @returns Disposable for the completion provider registration
 */
function registerCompletionProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	const completionProvider = new ProtoCompletionProvider();
	return vscode.languages.registerCompletionItemProvider(
		selector,
		completionProvider,
	);
}

/**
 * Registers the signature help provider for RPC and option(...) parameter hints.
 * @param selector - Document selector for proto files
 * @returns Disposable for the signature help provider registration
 */
function registerSignatureHelpProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	const signatureHelpProvider = new ProtoSignatureHelpProvider();
	return vscode.languages.registerSignatureHelpProvider(
		selector,
		signatureHelpProvider,
		"(",
		",",
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
	linterProvider: ApiLinterProvider,
): void {
	const config = vscode.workspace.getConfiguration("gapi");
	const enableOnSave = config.get<boolean>("enableOnSave", true);
	const enableOnType = config.get<boolean>("enableOnType", false);
	const formatOnSave = config.get<boolean>("formatOnSave", true);

	// Format proto files on save when gapi.formatOnSave is true
	if (formatOnSave) {
		context.subscriptions.push(
			vscode.workspace.onWillSaveTextDocument((event) => {
				if (!isProtoFile(event.document.fileName)) {
					return;
				}
				event.waitUntil(
					(async () => {
						const doc = event.document;
						const editorConfig = vscode.workspace.getConfiguration(
							"editor",
							doc.uri,
						);
						const options: vscode.FormattingOptions = {
							tabSize: editorConfig.get<number>("tabSize", 2),
							insertSpaces: editorConfig.get<boolean>("insertSpaces", true),
						};
						const edits = await getFormatEdits(doc, options);
						if (edits.length === 0) {
							return;
						}
						const edit = new vscode.WorkspaceEdit();
						for (const te of edits) {
							edit.replace(doc.uri, te.range, te.newText);
						}
						await vscode.workspace.applyEdit(edit);
					})(),
				);
			}),
		);
	}

	if (enableOnSave) {
		context.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(async (document) => {
				if (isProtoFile(document.fileName)) {
					await linterProvider.lintDocument(document);
				}
			}),
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
			}),
		);
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("gapi")) {
				vscode.window.showInformationMessage(
					`${EXTENSION_NAME} configuration changed. Reload window for changes to take effect.`,
				);
			}
		}),
	);
}

/**
 * Lints the currently active proto file if one is open.
 */
function lintActiveProtoFile(): void {
	try {
		const editor = getActiveProtoEditor();
		if (editor) {
			console.log("Active editor is proto file, linting immediately");
			linterProvider.lintDocument(editor.document);
		}
	} catch (error) {
		console.error("Error in lintActiveProtoFile:", error);
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
