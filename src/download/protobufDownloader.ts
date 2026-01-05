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
 * Handles downloading and managing protobuf protos
 */
export class ProtobufDownloader {
  private readonly GAPI_DIR: string;
  private readonly PROTOBUF_DIR: string;
  private readonly PROTOBUF_METADATA_PATH: string;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    const homeDir = os.homedir();
    this.GAPI_DIR = path.join(homeDir, '.gapi');
    this.PROTOBUF_DIR = path.join(this.GAPI_DIR, 'protobuf');
    this.PROTOBUF_METADATA_PATH = path.join(this.GAPI_DIR, 'protobuf-metadata.json');
  }

  /**
   * Gets the protobuf commit hash
   */
  public async getProtobufCommit(): Promise<string> {
    try {
      const metadata = await readFile(this.PROTOBUF_METADATA_PATH, 'utf-8');
      const data = JSON.parse(metadata);
      return data.commit || 'not downloaded';
    } catch {
      return 'not downloaded';
    }
  }

  /**
   * Ensures protobuf protos are downloaded
   */
  public async ensureProtobuf(): Promise<void> {
    try {
      this.outputChannel.appendLine('Checking protobuf...');
      const shouldDownload = await this.shouldDownloadProtobuf();
      this.outputChannel.appendLine(`Should download protobuf: ${shouldDownload}`);
      
      if (!shouldDownload) {
        this.outputChannel.appendLine('protobuf already up to date');
        return;
      }

      this.outputChannel.appendLine('Downloading protobuf from GitHub...');
      
      const zipPath = path.join(this.GAPI_DIR, 'protobuf.zip');
      const extractPath = path.join(this.GAPI_DIR, 'protobuf-temp');
      
      await this.downloadProtobufZip(zipPath);
      this.outputChannel.appendLine('Download complete, extracting...');
      
      await this.extractProtobuf(zipPath, extractPath);
      this.outputChannel.appendLine('Extraction complete');
      
      try {
        fs.unlinkSync(zipPath);
      } catch {}

      await this.updateProtobufMetadata();
      this.outputChannel.appendLine('protobuf downloaded successfully');
    } catch (error) {
      this.outputChannel.appendLine(`Failed to download protobuf: ${error}`);
      throw error;
    }
  }

  private async shouldDownloadProtobuf(): Promise<boolean> {
    if (!fs.existsSync(this.PROTOBUF_DIR)) {
      return true;
    }

    try {
      const metadataContent = await readFile(this.PROTOBUF_METADATA_PATH, 'utf-8');
      const metadata = JSON.parse(metadataContent);
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      return (now - metadata.lastChecked) > thirtyDays;
    } catch {
      return true;
    }
  }

  private async downloadProtobufZip(zipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = 'https://github.com/protocolbuffers/protobuf/archive/refs/heads/main.zip';
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

  private async extractProtobuf(zipPath: string, extractPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (fs.existsSync(extractPath)) {
          fs.rmSync(extractPath, { recursive: true, force: true });
        }
        
        fs.mkdirSync(extractPath, { recursive: true });
        
        exec(`unzip -q "${zipPath}" -d "${extractPath}"`)
          .then(() => {
            try {
              const extractedDir = path.join(extractPath, 'protobuf-main');
              
              if (fs.existsSync(this.PROTOBUF_DIR)) {
                fs.rmSync(this.PROTOBUF_DIR, { recursive: true, force: true });
              }
              
              fs.renameSync(extractedDir, this.PROTOBUF_DIR);
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
        reject(new Error(`Failed to extract protobuf: ${error}`));
      }
    });
  }

  private async updateProtobufMetadata(): Promise<void> {
    const metadata = {
      lastChecked: Date.now(),
      commit: 'main',
      source: 'https://github.com/protocolbuffers/protobuf',
      path: this.PROTOBUF_DIR
    };
    await writeFile(this.PROTOBUF_METADATA_PATH, JSON.stringify(metadata, null, 2));
  }
}
