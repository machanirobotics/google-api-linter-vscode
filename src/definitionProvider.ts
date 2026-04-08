import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import fg = require("fast-glob");

/**
 * Provides go-to-definition for proto types like google.protobuf.Timestamp
 */
export class ProtoDefinitionProvider implements vscode.DefinitionProvider {
	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): Promise<vscode.Definition | null> {
		// First try google.* types (e.g., google.protobuf.Timestamp)
		let wordRange = document.getWordRangeAtPosition(
			position,
			/google\.[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/,
		);
		if (wordRange) {
			const word = document.getText(wordRange);
			const protoFile = await this.findProtoFile(word);
			if (protoFile) {
				return await this.findDefinitionInFile(protoFile, word);
			}
		}

		// Try local proto types (e.g., Todo, Priority, CreateTodoRequest)
		wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}

		const word = document.getText(wordRange);

		// Search in current file first
		let location = await this.findDefinitionInCurrentFile(document, word);
		if (location) {
			return location;
		}

		// Search in imported files
		location = await this.findDefinitionInImports(document, word);
		if (location) {
			return location;
		}

		return null;
	}

	/**
	 * Finds the proto file for a google.* type
	 */
	private async findProtoFile(typeName: string): Promise<string | null> {
		// Convert google.protobuf.FieldMask -> google/protobuf/field_mask.proto
		const parts = typeName.split(".");
		const typeNamePart = parts[parts.length - 1];
		// Convert CamelCase to snake_case
		const fileName = typeNamePart
			.replace(/([A-Z])/g, "_$1")
			.toLowerCase()
			.replace(/^_/, "");
		const dirPath = parts.slice(0, -1).join("/");

		const homeDir = require("node:os").homedir();

		// For google.protobuf types, the path is src/google/protobuf/...
		const isProtobufType = typeName.startsWith("google.protobuf.");

		if (isProtobufType) {
			const protoPath = `src/${dirPath}/${fileName}.proto`;
			const protobufPath = path.join(homeDir, ".gapi", "protobuf", protoPath);

			if (fs.existsSync(protobufPath)) {
				return protobufPath;
			}

			// Also check without src/ prefix
			const altProtoPath = `${dirPath}/${fileName}.proto`;
			const altProtobufPath = path.join(
				homeDir,
				".gapi",
				"protobuf",
				altProtoPath,
			);

			if (fs.existsSync(altProtobufPath)) {
				return altProtobufPath;
			}

			return null;
		}

		// For google.api types, check googleapis
		const protoPath = `${dirPath}/${fileName}.proto`;
		const googleapisPath = path.join(homeDir, ".gapi", "googleapis", protoPath);

		if (fs.existsSync(googleapisPath)) {
			return googleapisPath;
		}

		// Check in workspace .gapi/googleapis
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders) {
			for (const folder of workspaceFolders) {
				const workspacePath = path.join(
					folder.uri.fsPath,
					".gapi",
					"googleapis",
					protoPath,
				);
				if (fs.existsSync(workspacePath)) {
					return workspacePath;
				}
			}
		}

		return null;
	}

	/**
	 * Finds the definition of a type within a proto file
	 */
	private async findDefinitionInFile(
		filePath: string,
		typeName: string,
	): Promise<vscode.Location | null> {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const lines = content.split("\n");

			// Extract the type name (last part after the last dot)
			const typeNameParts = typeName.split(".");
			const simpleTypeName = typeNameParts[typeNameParts.length - 1];

			// Search for message, enum, or service definition
			const definitionRegex = new RegExp(
				`^\\s*(message|enum|service)\\s+${simpleTypeName}\\s*\\{`,
				"m",
			);

			for (let i = 0; i < lines.length; i++) {
				if (definitionRegex.test(lines[i])) {
					const uri = vscode.Uri.file(filePath);
					const position = new vscode.Position(i, 0);
					const range = new vscode.Range(position, position);
					return new vscode.Location(uri, range);
				}
			}

			return null;
		} catch (error) {
			console.error(`Error reading proto file ${filePath}:`, error);
			return null;
		}
	}

	/**
	 * Finds definition in the current file
	 */
	private async findDefinitionInCurrentFile(
		document: vscode.TextDocument,
		typeName: string,
	): Promise<vscode.Location | null> {
		const content = document.getText();
		const lines = content.split("\n");

		const definitionRegex = new RegExp(
			`^\\s*(message|enum|service)\\s+${typeName}\\s*\\{`,
			"m",
		);

		for (let i = 0; i < lines.length; i++) {
			if (definitionRegex.test(lines[i])) {
				const position = new vscode.Position(i, 0);
				const range = new vscode.Range(position, position);
				return new vscode.Location(document.uri, range);
			}
		}

		return null;
	}

	/**
	 * Resolves a type name (e.g. "CreateTodoRequest" or "google.protobuf.Timestamp")
	 * to its definition location, using the given context file for imports.
	 */
	public async resolveTypeToLocation(
		typeName: string,
		contextUri: vscode.Uri,
	): Promise<vscode.Location | null> {
		const simpleName = typeName.split(".").pop() ?? typeName;
		if (typeName.startsWith("google.")) {
			const protoFile = await this.findProtoFile(typeName);
			if (protoFile) {
				return await this.findDefinitionInFile(protoFile, typeName);
			}
			return null;
		}
		try {
			const document = await vscode.workspace.openTextDocument(contextUri);
			let loc = await this.findDefinitionInCurrentFile(document, typeName);
			if (loc) {
				return loc;
			}
			loc = await this.findDefinitionInCurrentFile(document, simpleName);
			if (loc) {
				return loc;
			}
			loc = await this.findDefinitionInImports(document, typeName);
			if (loc) {
				return loc;
			}
			loc = await this.findDefinitionInImports(document, simpleName);
			return loc;
		} catch {
			return null;
		}
	}

	/**
	 * Finds definition in imported files using workspace-wide search
	 */
	private async findDefinitionInImports(
		document: vscode.TextDocument,
		typeName: string,
	): Promise<vscode.Location | null> {
		const content = document.getText();
		const importRegex = /^\s*import\s+('|")(.+\.proto)('|")\s*;\s*$/gim;
		const imports: string[] = [];
		let match;

		while ((match = importRegex.exec(content))) {
			imports.push(match[2]);
		}

		// Get workspace root and all proto search roots
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			return null;
		}
		const docDir = path.dirname(document.uri.fsPath);
		const homeDir = require("node:os").homedir();
		const searchRoots = [
			workspaceRoot,
			docDir,
			path.join(homeDir, ".gapi", "googleapis"),
			path.join(homeDir, ".gapi", "protobuf", "src"),
			path.join(homeDir, ".gapi", "protobuf"),
		].filter((r) => {
			try {
				return require("node:fs").existsSync(r);
			} catch {
				return false;
			}
		});

		for (const importPath of imports) {
			// Search using the full import path relative to each known root
			// (preserves directory structure so store/v1/foo.proto ≠ payment/v1/foo.proto)
			for (const root of searchRoots) {
				const candidate = path.join(root, importPath);
				try {
					if (require("node:fs").existsSync(candidate)) {
						const location = await this.findDefinitionInFile(
							candidate,
							typeName,
						);
						if (location) {
							return location;
						}
					}
				} catch {
					// skip
				}
			}

			// Fallback: basename-only glob inside workspace (last resort)
			const globPattern = path.join(
				workspaceRoot,
				"**",
				path.basename(importPath),
			);
			const files = await fg([globPattern]);
			for (const file of files) {
				const location = await this.findDefinitionInFile(file, typeName);
				if (location) {
					return location;
				}
			}
		}

		return null;
	}
}
