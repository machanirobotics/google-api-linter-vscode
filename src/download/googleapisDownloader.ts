import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import https from 'https';
import { createWriteStream } from 'fs';

const exec = promisify(cp.exec);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

/**
 * Handles downloading and managing googleapis protos
 */
export class GoogleapisDownloader {
  private readonly GAPI_DIR: string;
  private readonly GOOGLEAPIS_DIR: string;
  private readonly GOOGLEAPIS_METADATA_PATH: string;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    const homeDir = os.homedir();
    this.GAPI_DIR = path.join(homeDir, '.gapi');
    this.GOOGLEAPIS_DIR = path.join(this.GAPI_DIR, 'googleapis');
    this.GOOGLEAPIS_METADATA_PATH = path.join(this.GAPI_DIR, 'googleapis-metadata.json');
  }

  /**
   * Gets the googleapis commit hash
   */
  public async getGoogleapisCommit(): Promise<string> {
    try {
      const metadata = await readFile(this.GOOGLEAPIS_METADATA_PATH, 'utf-8');
      const data = JSON.parse(metadata);
      return data.commit || 'not downloaded';
    } catch {
      return 'not downloaded';
    }
  }

  /**
   * Ensures googleapis protos are downloaded
   */
  public async ensureGoogleapis(): Promise<void> {
    try {
      this.outputChannel.appendLine('Checking googleapis...');
      const shouldDownload = await this.shouldDownloadGoogleapis();
      this.outputChannel.appendLine(`Should download googleapis: ${shouldDownload}`);
      
      if (!shouldDownload) {
        this.outputChannel.appendLine('googleapis already up to date');
        return;
      }

      this.outputChannel.appendLine('Downloading googleapis from GitHub...');
      
      const zipPath = path.join(this.GAPI_DIR, 'googleapis.zip');
      const extractPath = path.join(this.GAPI_DIR, 'googleapis-temp');
      
      await this.downloadGoogleapisZip(zipPath);
      this.outputChannel.appendLine('Download complete, extracting...');
      
      await this.extractGoogleapis(zipPath, extractPath);
      this.outputChannel.appendLine('Extraction complete');
      
      try {
        fs.unlinkSync(zipPath);
      } catch {}

      await this.updateGoogleapisMetadata();
      this.outputChannel.appendLine('googleapis downloaded successfully');
    } catch (error) {
      this.outputChannel.appendLine(`Failed to download googleapis: ${error}`);
      throw error;
    }
  }

  private async shouldDownloadGoogleapis(): Promise<boolean> {
    if (!fs.existsSync(this.GOOGLEAPIS_DIR)) {
      return true;
    }

    try {
      const metadataContent = await readFile(this.GOOGLEAPIS_METADATA_PATH, 'utf-8');
      const metadata = JSON.parse(metadataContent);
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      return (now - metadata.lastChecked) > thirtyDays;
    } catch {
      return true;
    }
  }

  private async downloadGoogleapisZip(zipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = 'https://github.com/googleapis/googleapis/archive/refs/heads/master.zip';
      const file = createWriteStream(zipPath);
      
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          https.get(response.headers.location!, (redirectResponse) => {
            redirectResponse.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          }).on('error', reject);
        } else {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }
      }).on('error', (error) => {
        fs.unlinkSync(zipPath);
        reject(error);
      });
    });
  }

  private async extractGoogleapis(zipPath: string, extractPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (fs.existsSync(extractPath)) {
          fs.rmSync(extractPath, { recursive: true, force: true });
        }
        
        fs.mkdirSync(extractPath, { recursive: true });
        
        exec(`unzip -q "${zipPath}" -d "${extractPath}"`)
          .then(() => {
            try {
              const extractedDir = path.join(extractPath, 'googleapis-master');
              
              if (fs.existsSync(this.GOOGLEAPIS_DIR)) {
                fs.rmSync(this.GOOGLEAPIS_DIR, { recursive: true, force: true });
              }
              
              fs.renameSync(extractedDir, this.GOOGLEAPIS_DIR);
              fs.rmSync(extractPath, { recursive: true, force: true });
              
              resolve();
            } catch (error) {
              reject(new Error(`Failed to move extracted files: ${error}`));
            }
          })
          .catch((error: Error) => {
            reject(new Error(`Failed to extract zip: ${error}`));
          });
      } catch (error) {
        reject(new Error(`Failed to extract googleapis: ${error}`));
      }
    });
  }

  private async updateGoogleapisMetadata(): Promise<void> {
    const metadata = {
      lastChecked: Date.now(),
      commit: 'master',
      source: 'https://github.com/googleapis/googleapis',
      path: this.GOOGLEAPIS_DIR
    };
    await writeFile(this.GOOGLEAPIS_METADATA_PATH, JSON.stringify(metadata, null, 2));
  }
}
