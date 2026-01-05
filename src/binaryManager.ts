import * as vscode from 'vscode';
import { DownloadManager } from './download/downloadManager';

/**
 * Manages downloads for the extension.
 * Delegates to DownloadManager for actual download logic.
 */
export class BinaryManager {
  private downloadManager: DownloadManager;

  constructor(outputChannel: vscode.OutputChannel) {
    this.downloadManager = new DownloadManager(outputChannel);
  }

  public async getBinaryVersion(): Promise<string> {
    return this.downloadManager.getBinaryVersion();
  }

  public async getGoogleapisCommit(): Promise<string> {
    return this.downloadManager.getGoogleapisCommit();
  }

  public async getProtobufCommit(): Promise<string> {
    return this.downloadManager.getProtobufCommit();
  }

  public async ensureBinary(): Promise<string> {
    return this.downloadManager.ensureBinary();
  }

  public async ensureGoogleapis(): Promise<void> {
    return this.downloadManager.ensureGoogleapis();
  }

  public async ensureProtobuf(): Promise<void> {
    return this.downloadManager.ensureProtobuf();
  }

  public async checkAndUpdate(): Promise<void> {
    return this.downloadManager.checkAndUpdate();
  }
}
