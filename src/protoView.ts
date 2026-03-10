import * as vscode from "vscode";
import { DIAGNOSTIC_SOURCE } from "./constants";
import { type LocationItem, scanWorkspaceProto } from "./protoScanner";
import {
	findGapiConfigFile,
	findGapiConfigFileInFolder,
} from "./utils/configReader";
import { findProtoFiles, findProtoFilesInFolder } from "./utils/fileUtils";

export type ProtoTreeNode =
	| {
			kind: "status";
			label: string;
			version?: string;
			detail?: string;
			icon: string;
	  }
	| {
			kind: "init";
			label: string;
			detail: string;
			icon: string;
			folderUri?: vscode.Uri;
	  }
	| {
			kind: "file";
			uri: vscode.Uri;
			errorCount: number;
			warningCount: number;
			folderName?: string;
	  }
	| {
			kind: "diagnostic";
			uri: vscode.Uri;
			range: vscode.Range;
			message: string;
			severity: vscode.DiagnosticSeverity;
			code?: string | number;
	  }
	| {
			kind: "section";
			id: "rpcs" | "resources" | "messages" | "mcp" | "others";
			label: string;
			count: number;
			icon: string;
	  }
	| { kind: "location"; item: LocationItem }
	| { kind: "folder"; name: string; uri: vscode.Uri }
	| { kind: "action"; command: string; label: string; icon: string };

export class ProtoTreeDataProvider
	implements vscode.TreeDataProvider<ProtoTreeNode>
{
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<
		ProtoTreeNode | undefined | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private scanCache: {
		rpcs: LocationItem[];
		resources: LocationItem[];
		messages: LocationItem[];
		mcp: LocationItem[];
		others: LocationItem[];
	} | null = null;

	constructor(
		private readonly diagnosticCollection: vscode.DiagnosticCollection,
		private getBinaryVersion: () => Promise<string>,
		private getGoogleapisCommit: () => Promise<string>,
	) {}

	refresh(): void {
		this.scanCache = null;
		this._onDidChangeTreeData.fire(undefined);
	}

	private async getScan(): Promise<{
		rpcs: LocationItem[];
		resources: LocationItem[];
		messages: LocationItem[];
		mcp: LocationItem[];
		others: LocationItem[];
	}> {
		if (this.scanCache) return this.scanCache;
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		this.scanCache = root
			? await scanWorkspaceProto(root)
			: { rpcs: [], resources: [], messages: [], mcp: [], others: [] };
		return this.scanCache;
	}

	getTreeItem(element: ProtoTreeNode): vscode.TreeItem {
		if (element.kind === "status") {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = element.detail ?? element.version;
			item.iconPath = new vscode.ThemeIcon(element.icon);
			return item;
		}
		if (element.kind === "init") {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = element.detail;
			item.iconPath = new vscode.ThemeIcon(element.icon);
			item.command = {
				command: "googleApiLinter.initWorkspace",
				title: "Initialize",
				arguments: element.folderUri ? [element.folderUri] : undefined,
			};
			return item;
		}
		if (element.kind === "file") {
			const { uri, errorCount, warningCount, folderName } = element;
			const label =
				folderName != null
					? vscode.workspace.asRelativePath(uri, false).replace(/^[^/]+?\//, "")
					: vscode.workspace.asRelativePath(uri);
			const hasDiag = errorCount > 0 || warningCount > 0;
			const item = new vscode.TreeItem(
				label,
				hasDiag
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None,
			);
			item.resourceUri = uri;
			item.description = hasDiag
				? `${errorCount} error(s), ${warningCount} warning(s)`
				: "OK";
			item.iconPath = new vscode.ThemeIcon(
				errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "symbol-file",
			);
			item.command = {
				command: "vscode.open",
				title: "Open",
				arguments: [uri],
			};
			return item;
		}
		if (element.kind === "diagnostic") {
			const item = new vscode.TreeItem(
				element.message.slice(0, 60) + (element.message.length > 60 ? "…" : ""),
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = `L${element.range.start.line + 1}`;
			item.iconPath = new vscode.ThemeIcon(
				element.severity === vscode.DiagnosticSeverity.Error
					? "error"
					: "warning",
			);
			item.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to",
				arguments: [element.uri, element.range],
			};
			return item;
		}
		if (element.kind === "folder") {
			const item = new vscode.TreeItem(
				element.name,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.iconPath = vscode.ThemeIcon.Folder;
			return item;
		}
		if (element.kind === "section") {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.description = `${element.count}`;
			item.iconPath = new vscode.ThemeIcon(element.icon);
			const sectionDescriptions: Record<string, string> = {
				rpcs: "RPC methods in services",
				resources: "Messages with google.api.resource",
				messages: "Proto messages",
				mcp: "MCP options (service, tool, prompt, elicitation)",
				others: "Enums and other definitions",
			};
			item.tooltip = sectionDescriptions[element.id] ?? element.label;
			return item;
		}
		if (element.kind === "location") {
			const { item: loc } = element;
			const treeItem = new vscode.TreeItem(
				loc.label,
				vscode.TreeItemCollapsibleState.None,
			);
			treeItem.description = loc.detail;
			treeItem.iconPath = new vscode.ThemeIcon(loc.icon);
			treeItem.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to",
				arguments: [loc.uri, loc.range],
			};
			if (loc.documentation || loc.detail) {
				treeItem.tooltip = new vscode.MarkdownString(
					loc.documentation
						? `${loc.documentation}\n\n\`${loc.detail ?? ""}\``
						: (loc.detail ?? loc.label),
				);
			}
			return treeItem;
		}
		const item = new vscode.TreeItem(
			element.label,
			vscode.TreeItemCollapsibleState.None,
		);
		item.iconPath = new vscode.ThemeIcon(element.icon);
		item.command = { command: element.command, title: element.label };
		return item;
	}

	async getChildren(element?: ProtoTreeNode): Promise<ProtoTreeNode[]> {
		const hasWorkspaceConfig = (await findGapiConfigFile()) !== null;

		if (element?.kind === "section") {
			const scan = await this.getScan();
			if (element.id === "rpcs")
				return scan.rpcs.map((item) => ({ kind: "location" as const, item }));
			if (element.id === "resources")
				return scan.resources.map((item) => ({
					kind: "location" as const,
					item,
				}));
			if (element.id === "messages")
				return scan.messages.map((item) => ({
					kind: "location" as const,
					item,
				}));
			if (element.id === "mcp")
				return scan.mcp.map((item) => ({ kind: "location" as const, item }));
			if (element.id === "others")
				return scan.others.map((item) => ({ kind: "location" as const, item }));
			return [];
		}

		if (element?.kind === "file") {
			const diags = this.diagnosticCollection.get(element.uri) ?? [];
			const fromUs = diags.filter((d) => d.source === DIAGNOSTIC_SOURCE);
			return fromUs.map((d) => ({
				kind: "diagnostic" as const,
				uri: element.uri,
				range: d.range,
				message: d.message,
				severity: d.severity,
				code: d.code as string | number | undefined,
			}));
		}

		if (element?.kind === "folder") {
			const folderUri = element.uri;
			const hasConfig = (await findGapiConfigFileInFolder(folderUri)) !== null;
			const children: ProtoTreeNode[] = [];
			if (!hasConfig) {
				children.push({
					kind: "init",
					label: "Proto workspace not initialized",
					detail: "Create workspace.protobuf.yaml",
					icon: "folder-opened",
					folderUri,
				});
			}
			const protoUris = await findProtoFilesInFolder(folderUri);
			const fileNodes: ProtoTreeNode[] = [];
			for (const uri of protoUris) {
				const diagnostics = this.diagnosticCollection.get(uri) ?? [];
				const fromUs = diagnostics.filter(
					(d) => d.source === DIAGNOSTIC_SOURCE,
				);
				const errorCount = fromUs.filter(
					(d) => d.severity === vscode.DiagnosticSeverity.Error,
				).length;
				const warningCount = fromUs.filter(
					(d) => d.severity === vscode.DiagnosticSeverity.Warning,
				).length;
				fileNodes.push({
					kind: "file",
					uri,
					errorCount,
					warningCount,
					folderName: element.name,
				});
			}
			fileNodes.sort((a, b) => {
				if (a.kind !== "file" || b.kind !== "file") return 0;
				return vscode.workspace
					.asRelativePath(a.uri)
					.localeCompare(vscode.workspace.asRelativePath(b.uri));
			});
			children.push(...fileNodes);
			return children;
		}

		if (element !== undefined) return [];

		const roots: ProtoTreeNode[] = [];

		if (!hasWorkspaceConfig) {
			roots.push({
				kind: "init",
				label: "Proto workspace not initialized",
				detail: "Create workspace.protobuf.yaml",
				icon: "folder-opened",
			});
		} else {
			// Top: action buttons (Run and Debug style)
			roots.push(
				{
					kind: "action",
					command: "googleApiLinter.lintWorkspace",
					label: "Lint All Proto Files",
					icon: "play",
				},
				{
					kind: "action",
					command: "googleApiLinter.lintCurrentFile",
					label: "Lint Current File",
					icon: "go-to-file",
				},
				{
					kind: "action",
					command: "googleApiLinter.createConfig",
					label: "Create Config File",
					icon: "settings-gear",
				},
				{
					kind: "action",
					command: "googleApiLinter.initWorkspace",
					label: "Initialize Proto Workspace",
					icon: "folder-opened",
				},
				{
					kind: "action",
					command: "googleApiLinter.restart",
					label: "Restart",
					icon: "debug-restart",
				},
			);

			const scan = await this.getScan();

			if (scan.rpcs.length > 0) {
				roots.push({
					kind: "section",
					id: "rpcs",
					label: "RPCs",
					count: scan.rpcs.length,
					icon: "symbol-method",
				});
			}
			if (scan.resources.length > 0) {
				roots.push({
					kind: "section",
					id: "resources",
					label: "Resources",
					count: scan.resources.length,
					icon: "symbol-class",
				});
			}
			if (scan.messages.length > 0) {
				roots.push({
					kind: "section",
					id: "messages",
					label: "Messages",
					count: scan.messages.length,
					icon: "symbol-class",
				});
			}
			if (scan.mcp.length > 0) {
				roots.push({
					kind: "section",
					id: "mcp",
					label: "MCP",
					count: scan.mcp.length,
					icon: "symbol-interface",
				});
			}
			if (scan.others.length > 0) {
				roots.push({
					kind: "section",
					id: "others",
					label: "Others",
					count: scan.others.length,
					icon: "symbol-enum",
				});
			}

			try {
				const version = await this.getBinaryVersion();
				const googleapisCommit = await this.getGoogleapisCommit();
				const versionStr = version.startsWith("v") ? version : `v${version}`;
				roots.push({
					kind: "status",
					label: "API Linter",
					version: versionStr,
					detail: `googleapis: ${googleapisCommit.slice(0, 7)}`,
					icon: "check-all",
				});
			} catch {
				roots.push({
					kind: "status",
					label: "API Linter",
					detail: "Not installed or error",
					icon: "warning",
				});
			}
		}

		const folders = vscode.workspace.workspaceFolders ?? [];
		const multiRoot = folders.length > 1;

		if (multiRoot) {
			for (const folder of folders) {
				roots.push({ kind: "folder", name: folder.name, uri: folder.uri });
			}
		} else {
			const protoUris = await findProtoFiles();
			const fileNodes: ProtoTreeNode[] = [];
			for (const uri of protoUris) {
				const diagnostics = this.diagnosticCollection.get(uri) ?? [];
				const fromUs = diagnostics.filter(
					(d) => d.source === DIAGNOSTIC_SOURCE,
				);
				const errorCount = fromUs.filter(
					(d) => d.severity === vscode.DiagnosticSeverity.Error,
				).length;
				const warningCount = fromUs.filter(
					(d) => d.severity === vscode.DiagnosticSeverity.Warning,
				).length;
				fileNodes.push({ kind: "file", uri, errorCount, warningCount });
			}
			fileNodes.sort((a, b) => {
				if (a.kind !== "file" || b.kind !== "file") return 0;
				return vscode.workspace
					.asRelativePath(a.uri)
					.localeCompare(vscode.workspace.asRelativePath(b.uri));
			});
			roots.push(...fileNodes);
		}

		// Avoid duplicating actions when we already added them above
		if (!hasWorkspaceConfig)
			roots.push(
				{
					kind: "action",
					command: "googleApiLinter.lintWorkspace",
					label: "Lint All Proto Files",
					icon: "play",
				},
				{
					kind: "action",
					command: "googleApiLinter.lintCurrentFile",
					label: "Lint Current File",
					icon: "go-to-file",
				},
				{
					kind: "action",
					command: "googleApiLinter.createConfig",
					label: "Create Config File",
					icon: "settings-gear",
				},
				{
					kind: "action",
					command: "googleApiLinter.initWorkspace",
					label: "Initialize Proto Workspace",
					icon: "folder-opened",
				},
				{
					kind: "action",
					command: "googleApiLinter.restart",
					label: "Restart",
					icon: "debug-restart",
				},
			);

		return roots;
	}
}

export function registerProtoView(
	context: vscode.ExtensionContext,
	diagnosticCollection: vscode.DiagnosticCollection,
	getBinaryVersion: () => Promise<string>,
	getGoogleapisCommit: () => Promise<string>,
): void {
	const treeDataProvider = new ProtoTreeDataProvider(
		diagnosticCollection,
		getBinaryVersion,
		getGoogleapisCommit,
	);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			"googleApiLinter.views.proto",
			treeDataProvider,
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("googleApiLinter.refreshProtoView", () => {
			treeDataProvider.refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"googleApiLinter.revealLocation",
			async (uri: vscode.Uri, range: vscode.Range) => {
				const doc = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(doc, {
					selection: range,
					preview: false,
				});
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
			},
		),
	);

	vscode.languages.onDidChangeDiagnostics(() => treeDataProvider.refresh());
	const watcher = vscode.workspace.createFileSystemWatcher(
		"**/workspace.protobuf.yaml",
	);
	watcher.onDidCreate(() => treeDataProvider.refresh());
	watcher.onDidChange(() => treeDataProvider.refresh());
	watcher.onDidDelete(() => treeDataProvider.refresh());
	context.subscriptions.push(watcher);
}
