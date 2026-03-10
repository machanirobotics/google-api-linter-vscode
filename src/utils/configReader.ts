import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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
    1
  );
  return files.length > 0 ? files[0] : null;
}

/**
 * Finds workspace.protobuf.yaml in a specific workspace folder (root of that folder).
 */
export async function findGapiConfigFileInFolder(folderUri: vscode.Uri): Promise<vscode.Uri | null> {
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
  configUri: vscode.Uri
): Promise<GapiConfig | null> {
  try {
    const content = await vscode.workspace.fs.readFile(configUri);
    const text = Buffer.from(content).toString("utf8");

    // Simple YAML parsing for proto_path
    const lines = text.split("\n");
    const protoPaths: string[] = [];
    const configDir = path.dirname(configUri.fsPath);

    for (const line of lines) {
      const trimmed = line.trim();

      // Match proto_path: "path" or proto_path: path
      const match = trimmed.match(/^proto_path:\s*["']?([^"'\n]+)["']?/);
      if (match) {
        const protoPath = match[1].trim();
        // Resolve relative to config file location
        const absolutePath = path.resolve(configDir, protoPath);
        protoPaths.push(absolutePath);
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
export async function getProtoPaths(
  outputChannel?: { appendLine: (s: string) => void }
): Promise<string[]> {
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
    if (workspaceRoot) allPaths.push(workspaceRoot);
  }

  return allPaths;
}
