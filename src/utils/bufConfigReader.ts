import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import * as os from "os";

export interface BufModule {
  path: string;
  name: string;
}

export interface BufConfig {
  version?: string;
  modules: BufModule[];
  deps: string[];
  breaking?: { use?: string[] };
}

/**
 * Finds buf.yaml in the workspace (prefer root).
 */
export async function findBufConfig(): Promise<vscode.Uri | null> {
  const files = await vscode.workspace.findFiles(
    "**/buf.yaml",
    "**/node_modules/**",
    10
  );
  if (files.length === 0) return null;
  // Prefer workspace root, then shortest path
  const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const atRoot = files.find((u) => roots.some((r) => u.fsPath === path.join(r, "buf.yaml")));
  if (atRoot) return atRoot;
  const sorted = files.sort((a, b) => a.fsPath.length - b.fsPath.length);
  return sorted[0];
}

/**
 * Simple YAML-like parse for buf.yaml: version, modules (path, name), deps, breaking.
 */
export function readBufConfig(content: string): BufConfig {
  const config: BufConfig = { modules: [], deps: [] };
  const lines = content.split("\n");
  let inModules = false;
  let inDeps = false;
  let currentModule: Partial<BufModule> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;

    const versionMatch = trimmed.match(/^version:\s*["']?([^"'\s]+)["']?/);
    if (versionMatch) {
      config.version = versionMatch[1];
      inModules = false;
      inDeps = false;
      continue;
    }

    if (trimmed === "modules:" || trimmed.startsWith("modules:")) {
      inModules = true;
      inDeps = false;
      continue;
    }
    if (trimmed === "deps:" || trimmed.startsWith("deps:")) {
      inDeps = true;
      inModules = false;
      continue;
    }
    if (trimmed.startsWith("breaking:") || /^\w+:\s*$/.test(trimmed)) {
      inModules = false;
      inDeps = false;
      continue;
    }

    if (inModules) {
      const pathMatch = trimmed.match(/^-\s*path:\s*["']?([^"'\n]+)["']?/);
      const nameMatch = trimmed.match(/\bname:\s*["']?([^"'\n]+)["']?/);
      if (pathMatch) {
        if (currentModule.path !== undefined) {
          config.modules.push({ path: currentModule.path, name: currentModule.name ?? "" });
        }
        currentModule = { path: pathMatch[1].trim() };
      }
      if (nameMatch) currentModule.name = nameMatch[1].trim();
      if (currentModule.path !== undefined && currentModule.name !== undefined) {
        config.modules.push({ path: currentModule.path, name: currentModule.name });
        currentModule = {};
      }
    }
    if (inDeps) {
      const depMatch = trimmed.match(/^-\s*["']?([^"'\n]+)["']?/);
      if (depMatch) config.deps.push(depMatch[1].trim());
    }
  }
  if (currentModule.path !== undefined) {
    config.modules.push({ path: currentModule.path, name: currentModule.name ?? "" });
  }
  return config;
}

/**
 * Run buf mod download and buf export in dir, return export directory path.
 * Returns null if buf is not installed or export fails.
 */
function runBufExport(bufYamlDir: string, outputChannel?: { appendLine: (s: string) => void }): string | null {
  const log = (msg: string) => outputChannel?.appendLine?.(`[buf] ${msg}`);
  const tmpDir = path.join(os.tmpdir(), `buf-export-${Date.now()}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const spawnOpts = { cwd: bufYamlDir, timeout: 60000 };
    try {
      const dm = cp.spawnSync("buf", ["mod", "download"], { ...spawnOpts, encoding: "utf8" });
      if (dm.status !== 0 && dm.stderr) log("buf mod download: " + dm.stderr.trim());
    } catch (e) {
      log("buf mod download failed (non-fatal): " + (e instanceof Error ? e.message : String(e)));
    }
    const ex = cp.spawnSync("buf", ["export", ".", "-o", tmpDir], { ...spawnOpts, encoding: "utf8" });
    if (ex.status !== 0) {
      if (ex.stderr) log("buf export: " + ex.stderr.trim());
      throw new Error(ex.stderr || "buf export failed");
    }
    if (!fs.existsSync(tmpDir)) return null;
    return tmpDir;
  } catch (e) {
    log("buf export failed: " + (e instanceof Error ? e.message : String(e)));
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    } catch {}
    return null;
  }
}

const BUF_CACHE_MS = 5 * 60 * 1000; // 5 minutes
let bufPathsCache: { key: string; paths: string[]; at: number } | null = null;

function getBufCacheKey(bufYamlPath: string): string {
  try {
    const stat = fs.statSync(bufYamlPath);
    const lockPath = path.join(path.dirname(bufYamlPath), "buf.lock");
    const lockStat = fs.existsSync(lockPath) ? fs.statSync(lockPath) : null;
    return `${bufYamlPath}:${stat.mtimeMs}:${lockStat?.mtimeMs ?? 0}`;
  } catch {
    return bufYamlPath;
  }
}

/**
 * Resolve proto paths from buf.yaml: run buf mod download + buf export,
 * then return [exportDir, ...resolved module paths] so api-linter can resolve all deps.
 * Result is cached for 5 minutes or until buf.yaml/buf.lock change.
 */
export async function getBufProtoPaths(
  outputChannel?: { appendLine: (s: string) => void }
): Promise<string[]> {
  const bufUri = await findBufConfig();
  if (!bufUri) return [];
  const bufYamlDir = path.dirname(bufUri.fsPath);
  const cacheKey = getBufCacheKey(bufUri.fsPath);
  if (bufPathsCache && bufPathsCache.key === cacheKey && Date.now() - bufPathsCache.at < BUF_CACHE_MS) {
    return bufPathsCache.paths;
  }
  let content: string;
  try {
    content = Buffer.from(await vscode.workspace.fs.readFile(bufUri)).toString("utf8");
  } catch {
    return [];
  }
  const config = readBufConfig(content);
  const paths: string[] = [];

  // Buf export pulls in the module and all deps into one tree (so imports resolve)
  const exportDir = runBufExport(bufYamlDir, outputChannel);
  if (exportDir) paths.push(exportDir);

  // Local module paths (e.g. path: protobuf) relative to buf.yaml
  for (const mod of config.modules) {
    const resolved = path.resolve(bufYamlDir, mod.path);
    if (fs.existsSync(resolved) && !paths.includes(resolved)) paths.push(resolved);
  }

  if (!paths.includes(bufYamlDir)) paths.push(bufYamlDir);

  bufPathsCache = { key: cacheKey, paths, at: Date.now() };
  return paths;
}
