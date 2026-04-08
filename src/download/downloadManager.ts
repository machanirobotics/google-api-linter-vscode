import type * as vscode from "vscode";
import { ApiLinterDownloader } from "./apiLinterDownloader";
import { GoogleapisDownloader } from "./googleapisDownloader";
import { ProtobufDownloader } from "./protobufDownloader";

/**
 * Manages all downloads for the extension
 */
export class DownloadManager {
	private apiLinterDownloader: ApiLinterDownloader;
	private googleapisDownloader: GoogleapisDownloader;
	private protobufDownloader: ProtobufDownloader;

	constructor(outputChannel: vscode.OutputChannel) {
		this.apiLinterDownloader = new ApiLinterDownloader(outputChannel);
		this.googleapisDownloader = new GoogleapisDownloader(outputChannel);
		this.protobufDownloader = new ProtobufDownloader(outputChannel);
	}

	/**
	 * Ensures the api-linter binary is available
	 */
	public async ensureBinary(): Promise<string> {
		return this.apiLinterDownloader.ensureBinary();
	}

	/**
	 * Ensures googleapis protos are downloaded
	 */
	public async ensureGoogleapis(): Promise<void> {
		return this.googleapisDownloader.ensureGoogleapis();
	}

	/**
	 * Ensures protobuf protos are downloaded
	 */
	public async ensureProtobuf(): Promise<void> {
		return this.protobufDownloader.ensureProtobuf();
	}

	/**
	 * Gets the api-linter version
	 */
	public async getBinaryVersion(): Promise<string> {
		return this.apiLinterDownloader.getBinaryVersion();
	}

	/**
	 * Gets the googleapis commit
	 */
	public async getGoogleapisCommit(): Promise<string> {
		return this.googleapisDownloader.getGoogleapisCommit();
	}

	/**
	 * Gets the protobuf commit
	 */
	public async getProtobufCommit(): Promise<string> {
		return this.protobufDownloader.getProtobufCommit();
	}

	/**
	 * Gets the googleapis directory path
	 */
	public getGoogleapisDir(): string {
		return this.googleapisDownloader.getGoogleapisDir();
	}

	/**
	 * Gets the protobuf directory path
	 */
	public getProtobufDir(): string {
		return this.protobufDownloader.getProtobufDir();
	}

	/**
	 * Checks for api-linter updates
	 */
	public async checkAndUpdate(): Promise<void> {
		return this.apiLinterDownloader.checkAndUpdate();
	}
}
