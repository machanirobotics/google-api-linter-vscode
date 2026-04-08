import * as vscode from "vscode";
import { DIAGNOSTIC_SOURCE } from "./constants";
import {
	type LocationItem,
	type RpcItem,
	type ServiceItem,
	scanWorkspaceProto,
} from "./protoScanner";
import { parseMessageBody } from "./utils/protoParser";
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
			id:
				| "services"
				| "resources"
				| "mcp"
				| "messages"
				| "enums"
				| "files"
				| "deps"
				| "rpcs"
				| "others";
			label: string;
			count: number;
			icon: string;
	  }
	| { kind: "dep"; name: string; commit: string }
	| { kind: "service"; service: ServiceItem }
	| { kind: "rpc"; rpc: RpcItem; serviceName: string }
	| {
			kind: "rpcDetail";
			type: "request" | "response";
			typeName: string;
			uri?: vscode.Uri;
			range?: vscode.Range;
			/** Fallback when type not resolved: go to RPC line */
			rpcUri?: vscode.Uri;
			rpcRange?: vscode.Range;
	  }
	| {
			kind: "mcpSubsection";
			id: "tools" | "elicitation" | "prompts";
			label: string;
			count: number;
	  }
	| { kind: "location"; item: LocationItem }
	| {
			kind: "messageField";
			label: string;
			type: string;
			uri: vscode.Uri;
			range: vscode.Range;
	  }
	| { kind: "messageEnum"; label: string; uri: vscode.Uri; range: vscode.Range }
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
		services: ServiceItem[];
		rpcs: LocationItem[];
		resources: LocationItem[];
		messages: LocationItem[];
		mcp: LocationItem[];
		mcpTools: LocationItem[];
		mcpElicitation: LocationItem[];
		mcpPrompts: LocationItem[];
		others: LocationItem[];
	} | null = null;

	constructor(
		private readonly diagnosticCollection: vscode.DiagnosticCollection,
		private getBinaryVersion: () => Promise<string>,
		private getGoogleapisCommit: () => Promise<string>,
		private getProtobufCommit: () => Promise<string>,
		private readonly resolveTypeToLocation?: (
			typeName: string,
			contextUri: vscode.Uri,
		) => Promise<vscode.Location | null>,
	) {}

	refresh(): void {
		this.scanCache = null;
		this._onDidChangeTreeData.fire(undefined);
	}

	private async getScan(): Promise<{
		services: ServiceItem[];
		rpcs: LocationItem[];
		resources: LocationItem[];
		messages: LocationItem[];
		mcp: LocationItem[];
		mcpTools: LocationItem[];
		mcpElicitation: LocationItem[];
		mcpPrompts: LocationItem[];
		others: LocationItem[];
	}> {
		if (this.scanCache) {return this.scanCache;}
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		this.scanCache = root
			? await scanWorkspaceProto(root)
			: {
					services: [],
					rpcs: [],
					resources: [],
					messages: [],
					mcp: [],
					mcpTools: [],
					mcpElicitation: [],
					mcpPrompts: [],
					others: [],
				};
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
		if (element.kind === "dep") {
			const item = new vscode.TreeItem(
				element.name,
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = element.commit.slice(0, 7);
			item.iconPath = new vscode.ThemeIcon(
				"circle-filled",
				new vscode.ThemeColor("terminal.ansiCyan"),
			);
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
			// Pastel colors: cyan = OK, magenta = warning, blue = error
			if (errorCount > 0) {
				item.iconPath = new vscode.ThemeIcon(
					"circle-filled",
					new vscode.ThemeColor("terminal.ansiBlue"),
				);
			} else if (warningCount > 0) {
				item.iconPath = new vscode.ThemeIcon(
					"circle-filled",
					new vscode.ThemeColor("terminal.ansiMagenta"),
				);
			} else {
				item.iconPath = new vscode.ThemeIcon(
					"circle-filled",
					new vscode.ThemeColor("terminal.ansiCyan"),
				);
			}
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
			const isError = element.severity === vscode.DiagnosticSeverity.Error;
			item.iconPath = new vscode.ThemeIcon(
				isError ? "error" : "warning",
				new vscode.ThemeColor(
					isError ? "terminal.ansiBlue" : "terminal.ansiMagenta",
				),
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
				vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.description = `${element.count}`;
			const sectionColors: Record<string, string> = {
				services: "symbolIcon.interfaceForeground",
				resources: "symbolIcon.classForeground",
				mcp: "symbolIcon.keywordForeground",
				messages: "symbolIcon.classForeground",
				enums: "symbolIcon.enumForeground",
				deps: "terminal.ansiCyan",
				files: "symbolIcon.fileForeground",
				rpcs: "terminal.ansiMagenta",
				others: "symbolIcon.variableForeground",
			};
			const color = sectionColors[element.id];
			item.iconPath = new vscode.ThemeIcon(
				element.icon,
				color ? new vscode.ThemeColor(color) : undefined,
			);
			const sectionDescriptions: Record<string, string> = {
				services: "Services with RPCs (expand to see Request/Response)",
				resources: "Messages with google.api.resource",
				mcp: "MCP: Tools, Elicitation, Prompts (by RPC)",
				files: "Proto files (cyan=OK, magenta=warning, blue=error)",
				enums: "Enum definitions",
				deps: "Dependencies (googleapis, protobuf); cyan when downloaded",
				rpcs: "RPC methods in services",
				messages: "Proto messages (expand for fields and enums)",
				others: "Other definitions",
			};
			item.tooltip = sectionDescriptions[element.id] ?? element.label;
			return item;
		}
		if (element.kind === "service") {
			const item = new vscode.TreeItem(
				element.service.name,
				vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.description = `${element.service.rpcs.length} RPC(s)`;
			item.iconPath = new vscode.ThemeIcon(
				"symbol-interface",
				new vscode.ThemeColor("symbolIcon.interfaceForeground"),
			);
			item.tooltip = new vscode.MarkdownString(
				`Service **${element.service.name}**\n\nClick to go to definition in file.`,
			);
			item.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to definition",
				arguments: [element.service.uri, element.service.range],
			};
			return item;
		}
		if (element.kind === "rpc") {
			const item = new vscode.TreeItem(
				element.rpc.name,
				vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.description = element.rpc.detail;
			item.iconPath = new vscode.ThemeIcon(
				"symbol-method",
				new vscode.ThemeColor("terminal.ansiMagenta"),
			);
			item.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to",
				arguments: [element.rpc.uri, element.rpc.range],
			};
			item.tooltip = new vscode.MarkdownString(
				element.rpc.documentation
					? `${element.rpc.documentation}\n\n\`${element.rpc.detail}\`\n\nClick to go to RPC in file.`
					: `RPC **${element.rpc.name}**\n\n\`${element.rpc.detail}\`\n\nClick to go to definition in file.`,
			);
			return item;
		}
		if (element.kind === "rpcDetail") {
			const label =
				element.type === "request"
					? `Request: ${element.typeName}`
					: `Response: ${element.typeName}`;
			const item = new vscode.TreeItem(
				label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = element.typeName;
			const hasTypeLoc = element.uri && element.range;
			item.tooltip = new vscode.MarkdownString(
				hasTypeLoc
					? `${element.type === "request" ? "Request" : "Response"} message type: **${element.typeName}**\n\nClick to go to definition in file.`
					: `**${element.typeName}**\n\nType definition not found; click to go to RPC in file.`,
			);
			item.iconPath = new vscode.ThemeIcon(
				"symbol-class",
				new vscode.ThemeColor(
					element.type === "request"
						? "symbolIcon.functionForeground"
						: "symbolIcon.methodForeground",
				),
			);
			if (hasTypeLoc) {
				item.command = {
					command: "googleApiLinter.revealLocation",
					title: "Go to type definition",
					arguments: [element.uri, element.range],
				};
			} else if (element.rpcUri && element.rpcRange) {
				item.command = {
					command: "googleApiLinter.revealLocation",
					title: "Go to RPC",
					arguments: [element.rpcUri, element.rpcRange],
				};
			}
			return item;
		}
		if (element.kind === "mcpSubsection") {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.description = `${element.count}`;
			item.iconPath = new vscode.ThemeIcon(
				element.id === "tools"
					? "tools"
					: element.id === "elicitation"
						? "question"
						: "comment-discussion",
			);
			return item;
		}
		if (element.kind === "location") {
			const { item: loc } = element;
			const isMessage = loc.detail === "message";
			const treeItem = new vscode.TreeItem(
				loc.label,
				isMessage
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None,
			);
			treeItem.description = loc.detail;
			treeItem.iconPath = new vscode.ThemeIcon(
				loc.icon,
				isMessage
					? new vscode.ThemeColor("symbolIcon.classForeground")
					: undefined,
			);
			treeItem.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to",
				arguments: [loc.uri, loc.range],
			};
			if (loc.documentation || loc.detail) {
				treeItem.tooltip = new vscode.MarkdownString(
					(loc.documentation
						? `${loc.documentation}\n\n\`${loc.detail ?? ""}\``
						: (loc.detail ?? loc.label)) +
						"\n\nClick to go to definition in file.",
				);
			} else {
				treeItem.tooltip = new vscode.MarkdownString(
					`**${loc.label}**\n\nClick to go to definition in file.`,
				);
			}
			return treeItem;
		}
		if (element.kind === "messageField") {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = element.type;
			item.tooltip = new vscode.MarkdownString(
				`Field **${element.label}**: \`${element.type}\`\n\nClick to go to definition in file.`,
			);
			item.iconPath = new vscode.ThemeIcon(
				"symbol-field",
				new vscode.ThemeColor("symbolIcon.fieldForeground"),
			);
			item.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to field",
				arguments: [element.uri, element.range],
			};
			return item;
		}
		if (element.kind === "messageEnum") {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = "enum";
			item.tooltip = new vscode.MarkdownString(
				`Enum **${element.label}**\n\nClick to go to definition in file.`,
			);
			item.iconPath = new vscode.ThemeIcon(
				"symbol-enum",
				new vscode.ThemeColor("symbolIcon.enumForeground"),
			);
			item.command = {
				command: "googleApiLinter.revealLocation",
				title: "Go to enum",
				arguments: [element.uri, element.range],
			};
			return item;
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
			if (element.id === "services")
				{return scan.services.map((service) => ({
					kind: "service" as const,
					service,
				}));}
			if (element.id === "resources")
				{return scan.resources.map((item) => ({
					kind: "location" as const,
					item,
				}));}
			if (element.id === "mcp") {
				return [
					{
						kind: "mcpSubsection",
						id: "tools",
						label: "Tools",
						count: scan.mcpTools.length,
					},
					{
						kind: "mcpSubsection",
						id: "elicitation",
						label: "Elicitation",
						count: scan.mcpElicitation.length,
					},
					{
						kind: "mcpSubsection",
						id: "prompts",
						label: "Prompts",
						count: scan.mcpPrompts.length,
					},
				];
			}
			if (element.id === "files") {
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
					if (a.kind !== "file" || b.kind !== "file") {return 0;}
					return vscode.workspace
						.asRelativePath(a.uri)
						.localeCompare(vscode.workspace.asRelativePath(b.uri));
				});
				return fileNodes;
			}
			if (element.id === "deps") {
				const [googleapisCommit, protobufCommit] = await Promise.all([
					this.getGoogleapisCommit(),
					this.getProtobufCommit(),
				]);
				return [
					{ kind: "dep", name: "googleapis", commit: googleapisCommit },
					{ kind: "dep", name: "protobuf", commit: protobufCommit },
				];
			}
			if (element.id === "enums")
				{return scan.others
					.filter((o) => o.detail === "enum")
					.map((item) => ({ kind: "location" as const, item }));}
			if (element.id === "rpcs")
				{return scan.rpcs.map((item) => ({ kind: "location" as const, item }));}
			if (element.id === "messages")
				{return scan.messages.map((item) => ({
					kind: "location" as const,
					item,
				}));}
			if (element.id === "others")
				{return scan.others.map((item) => ({ kind: "location" as const, item }));}
			return [];
		}

		if (element?.kind === "service") {
			return element.service.rpcs.map((rpc) => ({
				kind: "rpc" as const,
				rpc,
				serviceName: element.service.name,
			}));
		}

		if (element?.kind === "rpc") {
			const reqType = element.rpc.requestType;
			const resType = element.rpc.responseType;
			const contextUri = element.rpc.uri;
			let reqLoc: vscode.Location | null = null;
			let resLoc: vscode.Location | null = null;
			if (this.resolveTypeToLocation) {
				[reqLoc, resLoc] = await Promise.all([
					this.resolveTypeToLocation(reqType, contextUri),
					this.resolveTypeToLocation(resType, contextUri),
				]);
			}
			const rpcUri = element.rpc.uri;
			const rpcRange = element.rpc.range;
			return [
				{
					kind: "rpcDetail" as const,
					type: "request" as const,
					typeName: reqType,
					uri: reqLoc?.uri,
					range: reqLoc?.range,
					rpcUri,
					rpcRange,
				},
				{
					kind: "rpcDetail" as const,
					type: "response" as const,
					typeName: resType,
					uri: resLoc?.uri,
					range: resLoc?.range,
					rpcUri,
					rpcRange,
				},
			];
		}

		if (element?.kind === "location" && element.item.detail === "message") {
			try {
				const doc = await vscode.workspace.openTextDocument(element.item.uri);
				const { fields, enums } = parseMessageBody(
					doc,
					element.item.range.start.line,
				);
				const nodes: ProtoTreeNode[] = [];
				for (const f of fields) {
					nodes.push({
						kind: "messageField",
						label: f.name,
						type: f.type,
						uri: element.item.uri,
						range: f.range,
					});
				}
				for (const e of enums) {
					nodes.push({
						kind: "messageEnum",
						label: e.name,
						uri: element.item.uri,
						range: e.range,
					});
				}
				return nodes;
			} catch {
				return [];
			}
		}

		if (element?.kind === "mcpSubsection") {
			const scan = await this.getScan();
			if (element.id === "tools")
				{return scan.mcpTools.map((item) => ({
					kind: "location" as const,
					item,
				}));}
			if (element.id === "elicitation")
				{return scan.mcpElicitation.map((item) => ({
					kind: "location" as const,
					item,
				}));}
			if (element.id === "prompts")
				{return scan.mcpPrompts.map((item) => ({
					kind: "location" as const,
					item,
				}));}
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
				if (a.kind !== "file" || b.kind !== "file") {return 0;}
				return vscode.workspace
					.asRelativePath(a.uri)
					.localeCompare(vscode.workspace.asRelativePath(b.uri));
			});
			children.push(...fileNodes);
			return children;
		}

		if (element !== undefined) {return [];}

		const roots: ProtoTreeNode[] = [];

		if (!hasWorkspaceConfig) {
			roots.push({
				kind: "init",
				label: "Proto workspace not initialized",
				detail: "Create workspace.protobuf.yaml",
				icon: "folder-opened",
			});
		} else {
			// Top-level button bar (debugger style): Lint, Format, Reload
			roots.push(
				{
					kind: "action",
					command: "googleApiLinter.lintWorkspace",
					label: "Lint",
					icon: "play",
				},
				{
					kind: "action",
					command: "googleApiLinter.formatAllProtos",
					label: "Format",
					icon: "prettier",
				},
				{
					kind: "action",
					command: "googleApiLinter.restart",
					label: "Reload",
					icon: "debug-restart",
				},
			);

			const scan = await this.getScan();

			if (scan.services.length > 0) {
				roots.push({
					kind: "section",
					id: "services",
					label: "Services",
					count: scan.services.length,
					icon: "symbol-interface",
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
			if (scan.mcp.length > 0) {
				roots.push({
					kind: "section",
					id: "mcp",
					label: "MCP",
					count: scan.mcp.length,
					icon: "symbol-interface",
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
			const enumsCount = scan.others.filter((o) => o.detail === "enum").length;
			if (enumsCount > 0) {
				roots.push({
					kind: "section",
					id: "enums",
					label: "Enums",
					count: enumsCount,
					icon: "symbol-enum",
				});
			}
			roots.push({
				kind: "section",
				id: "deps",
				label: "Deps",
				count: 2,
				icon: "package",
			});
			const protoUrisForFiles = await findProtoFiles();
			roots.push({
				kind: "section",
				id: "files",
				label: "Files",
				count: protoUrisForFiles.length,
				icon: "symbol-file",
			});

			try {
				const version = await this.getBinaryVersion();
				const versionStr = version.startsWith("v") ? version : `v${version}`;
				roots.push({
					kind: "status",
					label: "API Linter",
					version: versionStr,
					detail: undefined,
					icon: "symbol-misc",
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

		return roots;
	}
}

export function registerProtoView(
	context: vscode.ExtensionContext,
	diagnosticCollection: vscode.DiagnosticCollection,
	getBinaryVersion: () => Promise<string>,
	getGoogleapisCommit: () => Promise<string>,
	getProtobufCommit: () => Promise<string>,
	resolveTypeToLocation?: (
		typeName: string,
		contextUri: vscode.Uri,
	) => Promise<vscode.Location | null>,
): void {
	const treeDataProvider = new ProtoTreeDataProvider(
		diagnosticCollection,
		getBinaryVersion,
		getGoogleapisCommit,
		getProtobufCommit,
		resolveTypeToLocation,
	);

	// createTreeView registers the built-in collapseAll command (workbench.actions.treeView.<id>.collapseAll)
	context.subscriptions.push(
		vscode.window.createTreeView("googleApiLinter.views.proto", {
			treeDataProvider,
			showCollapseAll: false, // we contribute our own icon button
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("googleApiLinter.refreshProtoView", () => {
			treeDataProvider.refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("googleApiLinter.collapseAll", async () => {
			try {
				await vscode.commands.executeCommand(
					"workbench.actions.treeView.googleApiLinter.views.proto.collapseAll",
				);
			} catch {
				// Built-in command only exists when view is created with createTreeView; fallback refresh
				treeDataProvider.refresh();
			}
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
