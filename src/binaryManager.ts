import type * as vscode from "vscode";
import { DownloadManager } from "./download/downloadManager";

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

	public async ensureBinary(force = false): Promise<string> {
		return this.downloadManager.ensureBinary(force);
	}

	public async ensureGoogleapis(force = false): Promise<void> {
		return this.downloadManager.ensureGoogleapis(force);
	}

	public async ensureProtobuf(force = false): Promise<void> {
		return this.downloadManager.ensureProtobuf(force);
	}

	public async checkAndUpdate(): Promise<void> {
		return this.downloadManager.checkAndUpdate();
	}

	public getGoogleapisDir(): string {
		return this.downloadManager.getGoogleapisDir();
	}

	public getProtobufDir(): string {
		return this.downloadManager.getProtobufDir();
	}
}
