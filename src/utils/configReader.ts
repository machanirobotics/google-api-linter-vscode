import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Configuration from workspace.protobuf.yaml
 */
export interface GapiConfig {
  protoPath: string;
  protoPaths: string[];
}

/**
 * Finds workspace.protobuf.yaml file in workspace
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
 * Gets proto paths from workspace.protobuf.yaml or falls back to workspace root
 */
export async function getProtoPaths(): Promise<string[]> {
  const configUri = await findGapiConfigFile();

  if (configUri) {
    const config = await readGapiConfig(configUri);
    if (config) {
      return config.protoPaths;
    }
  }

  // Fallback to workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return workspaceRoot ? [workspaceRoot] : [];
}
