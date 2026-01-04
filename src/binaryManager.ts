import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import { fetchJson, downloadFile } from './utils/httpClient';
import { getPlatform, getArch } from './utils/platformUtils';
import { BinaryMetadata } from './types';

/** Promisified fs and child_process functions */

const exec = promisify(cp.exec);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const chmod = promisify(fs.chmod);
const stat = promisify(fs.stat);

/**
 * GitHub release API response structure.
 */
interface GitHubRelease {
  /** Version tag (e.g., 'v1.2.3') */
  tag_name: string;
}

/** Interval between update checks (10 days in milliseconds) */
const CHECK_INTERVAL_MS = 10 * 24 * 60 * 60 * 1000;

/** GitHub API endpoint for latest release */
const GITHUB_API = 'https://api.github.com/repos/googleapis/api-linter/releases/latest';

/**
 * Manages the api-linter binary installation and updates.
 * Handles downloading, extracting, and version management.
 */
export class BinaryManager {
  private readonly GAPI_DIR: string;
  private readonly BINARY_PATH: string;
  private readonly METADATA_PATH: string;
  private outputChannel: vscode.OutputChannel;

  /**
   * Creates a new binary manager.
   * @param outputChannel - Output channel for logging
   */
  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    const homeDir = os.homedir();
    this.GAPI_DIR = path.join(homeDir, '.gapi');
    this.BINARY_PATH = path.join(this.GAPI_DIR, 'api-linter');
    this.METADATA_PATH = path.join(this.GAPI_DIR, 'metadata.json');
  }

  /**
   * Ensures the api-linter binary is available and up-to-date.
   * Downloads the binary if missing, checks for updates periodically.
   * @returns Path to the binary executable
   */
  public async ensureBinary(): Promise<string> {
    await this.ensureDirectory();

    const customBinaryPath = this.getCustomBinaryPath();
    if (customBinaryPath) {
      this.outputChannel.appendLine(`Using custom binary path: ${customBinaryPath}`);
      return customBinaryPath;
    }

    if (await this.binaryExists()) {
      if (await this.shouldCheckForUpdate()) {
        this.outputChannel.appendLine('Checking for updates...');
        await this.checkAndUpdate();
      }
      return this.BINARY_PATH;
    }

    this.outputChannel.appendLine('Binary not found. Downloading...');
    await this.downloadBinary();
    return this.BINARY_PATH;
  }

  /**
   * Gets custom binary path from configuration if set.
   * @returns Custom binary path or null if using default
   */
  private getCustomBinaryPath(): string | null {
    const config = vscode.workspace.getConfiguration('googleApiLinter');
    const customBinaryPath = config.get<string>('binaryPath', '');
    return customBinaryPath && customBinaryPath !== 'api-linter' ? customBinaryPath : null;
  }

  /**
   * Ensures the .gapi directory exists.
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await mkdir(this.GAPI_DIR, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Checks if the binary file exists.
   * @returns True if binary exists
   */
  private async binaryExists(): Promise<boolean> {
    try {
      await stat(this.BINARY_PATH);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determines if it's time to check for updates.
   * @returns True if update check is needed
   */
  private async shouldCheckForUpdate(): Promise<boolean> {
    try {
      const metadataContent = await readFile(this.METADATA_PATH, 'utf-8');
      const metadata: BinaryMetadata = JSON.parse(metadataContent);
      const now = Date.now();
      return (now - metadata.lastChecked) > CHECK_INTERVAL_MS;
    } catch {
      return true;
    }
  }

  /**
   * Checks for updates and downloads new version if available.
   */
  private async checkAndUpdate(): Promise<void> {
    try {
      const latestVersion = await this.getLatestVersion();
      const currentMetadata = await this.getMetadata();

      if (!currentMetadata || currentMetadata.version !== latestVersion) {
        this.outputChannel.appendLine(`New version available: ${latestVersion}`);
        vscode.window.showInformationMessage(`Updating Google API Linter to version ${latestVersion}...`);
        await this.downloadBinary(latestVersion);
        vscode.window.showInformationMessage('Google API Linter updated successfully!');
      } else {
        this.outputChannel.appendLine('Binary is up to date');
        await this.updateMetadata(latestVersion);
      }
    } catch (error) {
      this.outputChannel.appendLine(`Update check failed: ${error}`);
    }
  }

  /**
   * Fetches the latest version tag from GitHub.
   * @returns Version tag string
   */
  private async getLatestVersion(): Promise<string> {
    const release = await fetchJson<GitHubRelease>(GITHUB_API, {
      'User-Agent': 'vscode-google-api-linter'
    });
    return release.tag_name;
  }

  /**
   * Downloads and installs the api-linter binary.
   * @param version - Optional version to download (defaults to latest)
   */
  private async downloadBinary(version?: string): Promise<void> {
    if (!version) {
      version = await this.getLatestVersion();
    }

    const platform = getPlatform();
    const arch = getArch();
    const versionWithoutV = version.replace(/^v/, '');
    const downloadUrl = `https://github.com/googleapis/api-linter/releases/download/${version}/api-linter-${versionWithoutV}-${platform}-${arch}.tar.gz`;

    this.outputChannel.appendLine(`Downloading from: ${downloadUrl}`);

    const tarGzPath = path.join(this.GAPI_DIR, 'api-linter.tar.gz');

    await downloadFile(downloadUrl, tarGzPath, fs);
    await this.extractBinary(tarGzPath);
    await chmod(this.BINARY_PATH, 0o755);

    try {
      fs.unlinkSync(tarGzPath);
    } catch {}

    await this.updateMetadata(version);
    this.outputChannel.appendLine('Binary downloaded and installed successfully');
  }


  /**
   * Extracts the binary from a tar.gz archive.
   * @param tarGzPath - Path to the tar.gz file
   */
  private async extractBinary(tarGzPath: string): Promise<void> {
    try {
      const command = `tar -xzf "${tarGzPath}" -C "${this.GAPI_DIR}"`;
      await exec(command);
      
      const extractedPath = path.join(this.GAPI_DIR, 'api-linter');
      if (!fs.existsSync(extractedPath)) {
        const binPath = path.join(this.GAPI_DIR, 'bin', 'api-linter');
        if (fs.existsSync(binPath)) {
          fs.renameSync(binPath, extractedPath);
          try {
            fs.rmdirSync(path.join(this.GAPI_DIR, 'bin'));
          } catch {}
        }
      }
    } catch (error) {
      throw new Error(`Failed to extract binary: ${error}`);
    }
  }

  /**
   * Reads binary metadata from disk.
   * @returns Metadata object or null if not found
   */
  private async getMetadata(): Promise<BinaryMetadata | null> {
    try {
      const content = await readFile(this.METADATA_PATH, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Updates binary metadata on disk.
   * @param version - Version tag to save
   */
  private async updateMetadata(version: string): Promise<void> {
    const metadata: BinaryMetadata = {
      version,
      lastChecked: Date.now(),
      path: this.BINARY_PATH
    };
    await writeFile(this.METADATA_PATH, JSON.stringify(metadata, null, 2));
  }
}
