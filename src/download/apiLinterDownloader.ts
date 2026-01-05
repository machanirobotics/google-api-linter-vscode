import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import { fetchJson, downloadFile } from '../utils/httpClient';
import { getPlatform, getArch } from '../utils/platformUtils';
import { BinaryMetadata } from '../types';

const exec = promisify(cp.exec);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const chmod = promisify(fs.chmod);

const GITHUB_API = 'https://api.github.com/repos/googleapis/api-linter/releases/latest';

/**
 * Handles downloading and managing the api-linter binary
 */
export class ApiLinterDownloader {
  private readonly GAPI_DIR: string;
  private readonly BINARY_PATH: string;
  private readonly METADATA_PATH: string;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    const homeDir = os.homedir();
    this.GAPI_DIR = path.join(homeDir, '.gapi');
    this.BINARY_PATH = path.join(this.GAPI_DIR, 'api-linter');
    this.METADATA_PATH = path.join(this.GAPI_DIR, 'metadata.json');
  }

  /**
   * Gets the installed api-linter version
   */
  public async getBinaryVersion(): Promise<string> {
    try {
      const metadata = await readFile(this.METADATA_PATH, 'utf-8');
      const data = JSON.parse(metadata);
      return data.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Ensures the api-linter binary is available and up-to-date
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

  private getCustomBinaryPath(): string | null {
    const config = vscode.workspace.getConfiguration('gapi');
    const customPath = config.get<string>('binaryPath');
    return customPath && customPath !== 'api-linter' ? customPath : null;
  }

  private async ensureDirectory(): Promise<void> {
    if (!fs.existsSync(this.GAPI_DIR)) {
      await mkdir(this.GAPI_DIR, { recursive: true });
    }
  }

  private async binaryExists(): Promise<boolean> {
    return fs.existsSync(this.BINARY_PATH);
  }

  private async shouldCheckForUpdate(): Promise<boolean> {
    try {
      const metadata = await readFile(this.METADATA_PATH, 'utf-8');
      const data: BinaryMetadata = JSON.parse(metadata);
      const now = Date.now();
      const oneDayInMs = 24 * 60 * 60 * 1000;
      return (now - data.lastChecked) > oneDayInMs;
    } catch {
      return true;
    }
  }

  public async checkAndUpdate(): Promise<void> {
    try {
      const latestVersion = await this.getLatestVersion();
      const currentVersion = await this.getCurrentVersion();

      if (latestVersion !== currentVersion) {
        const selection = await vscode.window.showInformationMessage(
          `New version of api-linter available: ${latestVersion} (current: ${currentVersion})`,
          'Update Now',
          'Later'
        );

        if (selection === 'Update Now') {
          await this.downloadBinary();
          vscode.window.showInformationMessage(`api-linter updated to ${latestVersion}`);
        }
      }

      await this.updateMetadata(currentVersion);
    } catch (error) {
      this.outputChannel.appendLine(`Failed to check for updates: ${error}`);
    }
  }

  private async getLatestVersion(): Promise<string> {
    const release: any = await fetchJson(GITHUB_API);
    return release.tag_name;
  }

  private async getCurrentVersion(): Promise<string> {
    try {
      const metadata = await readFile(this.METADATA_PATH, 'utf-8');
      const data: BinaryMetadata = JSON.parse(metadata);
      return data.version;
    } catch {
      return 'unknown';
    }
  }

  public async downloadBinary(): Promise<void> {
    this.outputChannel.appendLine('Downloading api-linter binary...');

    const release: any = await fetchJson(GITHUB_API);
    const version = release.tag_name;
    const asset = this.findAssetForPlatform(release.assets);

    if (!asset) {
      throw new Error(`No compatible binary found for ${getPlatform()}-${getArch()}`);
    }

    const downloadUrl = asset.browser_download_url;
    const tarPath = path.join(this.GAPI_DIR, 'api-linter.tar.gz');

    await downloadFile(downloadUrl, tarPath, fs);
    this.outputChannel.appendLine('Download complete. Extracting...');

    await this.extractBinary(tarPath);
    await this.updateMetadata(version);
    this.outputChannel.appendLine('Binary downloaded and installed successfully');
  }

  private findAssetForPlatform(assets: any[]): any {
    const platform = getPlatform();
    const arch = getArch();
    const assetName = `api-linter-${platform}-${arch}.tar.gz`;
    return assets.find((asset: any) => asset.name === assetName);
  }

  private async extractBinary(tarPath: string): Promise<void> {
    const extractDir = this.GAPI_DIR;
    await exec(`tar -xzf "${tarPath}" -C "${extractDir}"`);
    await chmod(this.BINARY_PATH, '755');
    fs.unlinkSync(tarPath);
  }

  private async updateMetadata(version: string): Promise<void> {
    const metadata: BinaryMetadata = {
      version,
      lastChecked: Date.now(),
      path: this.BINARY_PATH
    };
    await writeFile(this.METADATA_PATH, JSON.stringify(metadata, null, 2));
  }
}
