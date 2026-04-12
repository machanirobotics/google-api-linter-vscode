import * as path from "node:path";
import * as vscode from "vscode";
import { getBufProtoPaths } from "./bufConfigReader";

/**
 * Configuration from workspace.protobuf.yaml
 */
export interface GapiConfig {
	protoPath: string;
	protoPaths: string[];
}

/**
 * Finds workspace.protobuf.yaml file in workspace (first match across all roots).
 */
export async function findGapiConfigFile(): Promise<vscode.Uri | null> {
	const files = await vscode.workspace.findFiles(
		"**/workspace.protobuf.yaml",
		"**/node_modules/**",
		1,
	);
	return files.length > 0 ? files[0] : null;
}

/**
 * Finds workspace.protobuf.yaml in a specific workspace folder (root of that folder).
 */
export async function findGapiConfigFileInFolder(
	folderUri: vscode.Uri,
): Promise<vscode.Uri | null> {
	const configPath = vscode.Uri.joinPath(folderUri, "workspace.protobuf.yaml");
	try {
		await vscode.workspace.fs.stat(configPath);
		return configPath;
	} catch {
		return null;
	}
}

/**
 * Reads and parses workspace.protobuf.yaml configuration
 */
export async function readGapiConfig(
	configUri: vscode.Uri,
): Promise<GapiConfig | null> {
	try {
		const content = await vscode.workspace.fs.readFile(configUri);
		const text = Buffer.from(content).toString("utf8");

		// Simple YAML parsing for proto_path / proto_paths
		const lines = text.split("\n");
		const protoPaths: string[] = [];
		const configDir = path.dirname(configUri.fsPath);
		let inProtoPathsList = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Detect start of a proto_paths list block
			if (/^proto_paths\s*:/.test(trimmed)) {
				inProtoPathsList = true;
				// Check for inline value: proto_paths: some/path
				const inlineMatch = trimmed.match(
					/^proto_paths\s*:\s*["']?([^"'\n#]+)["']?/,
				);
				const inlinePath = inlineMatch?.[1]?.trim();
				if (inlinePath) {
					const p = inlinePath;
					protoPaths.push(path.resolve(configDir, p));
				}
				continue;
			}

			// Scalar form: proto_path: some/path
			const scalarMatch = trimmed.match(
				/^proto_path\s*:\s*["']?([^"'\n#]+)["']?/,
			);
			if (scalarMatch) {
				inProtoPathsList = false;
				const p = scalarMatch[1].trim();
				protoPaths.push(path.resolve(configDir, p));
				continue;
			}

			// List item inside proto_paths block: - some/path
			if (inProtoPathsList && trimmed.startsWith("-")) {
				const listItem = trimmed
					.replace(/^-\s*/, "")
					.replace(/["']/g, "")
					.trim();
				if (listItem) {
					protoPaths.push(path.resolve(configDir, listItem));
				}
				continue;
			}

			// Any non-indented, non-list-item line that has a key resets list mode
			if (
				inProtoPathsList &&
				line.length > 0 &&
				line[0] !== " " &&
				line[0] !== "\t" &&
				!trimmed.startsWith("-") &&
				!trimmed.startsWith("#")
			) {
				inProtoPathsList = false;
			}
		}

		if (protoPaths.length === 0) {
			// If no proto_path specified, use config directory
			protoPaths.push(configDir);
		}

		return {
			protoPath: protoPaths[0],
			protoPaths,
		};
	} catch (error) {
		console.error("Error reading workspace.protobuf.yaml:", error);
		return null;
	}
}

/**
 * Gets proto paths from workspace.protobuf.yaml, buf.yaml (modules + deps), or falls back to workspace root.
 * When buf.yaml exists, runs buf mod download and buf export so deps (e.g. googleapis, grpc-mcp-gateway) are included for linting.
 */
export async function getProtoPaths(outputChannel?: {
	appendLine: (s: string) => void;
}): Promise<string[]> {
	const allPaths: string[] = [];
	const seen = new Set<string>();

	const configUri = await findGapiConfigFile();
	if (configUri) {
		const config = await readGapiConfig(configUri);
		if (config) {
			for (const p of config.protoPaths) {
				if (!seen.has(p)) {
					seen.add(p);
					allPaths.push(p);
				}
			}
		}
	}

	const bufPaths = await getBufProtoPaths(outputChannel);
	for (const p of bufPaths) {
		const normalized = path.resolve(p);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			allPaths.push(normalized);
		}
	}

	if (allPaths.length === 0) {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspaceRoot) {
			allPaths.push(workspaceRoot);
		}
	}

	return allPaths;
}
