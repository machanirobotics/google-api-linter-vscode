import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { invalidateBufProtoPathsCache } from "./bufConfigReader";
import { getProtoPaths } from "./configReader";

/**
 * Call when buf.yaml, buf.lock, or workspace protobuf config changes so buf export and editor roots refresh.
 */
export function invalidateProtoImportRootsCache(): void {
	invalidateBufProtoPathsCache();
}

/**
 * Directories used to resolve `import "…/file.proto"` for navigation (definition, links, references scan).
 * Merges workspace folders, `getProtoPaths` (workspace.protobuf.yaml + buf export), and ~/.gapi well-known dirs.
 */
export async function getProtoImportSearchRoots(
	outputChannel?: vscode.OutputChannel,
): Promise<string[]> {
	const seen = new Set<string>();
	const roots: string[] = [];
	const add = (p: string | undefined | null) => {
		if (!p) {
			return;
		}
		const n = path.resolve(p);
		if (seen.has(n)) {
			return;
		}
		try {
			if (fs.existsSync(n)) {
				seen.add(n);
				roots.push(n);
			}
		} catch {
			// skip
		}
	};

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		add(folder.uri.fsPath);
	}

	try {
		for (const p of await getProtoPaths(outputChannel)) {
			add(p);
		}
	} catch {
		// ignore
	}

	const home = os.homedir();
	add(path.join(home, ".gapi", "googleapis"));
	add(path.join(home, ".gapi", "protobuf", "src"));
	add(path.join(home, ".gapi", "protobuf"));

	return roots;
}
