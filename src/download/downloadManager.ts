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

	// Session-level cache flags to avoid repeated disk checks
	private binaryEnsured = false;
	private googleapisEnsured = false;
	private protobufEnsured = false;

	constructor(outputChannel: vscode.OutputChannel) {
		this.apiLinterDownloader = new ApiLinterDownloader(outputChannel);
		this.googleapisDownloader = new GoogleapisDownloader(outputChannel);
		this.protobufDownloader = new ProtobufDownloader(outputChannel);
	}

	/**
	 * Ensures the api-linter binary is available
	 */
	public async ensureBinary(force = false): Promise<string> {
		if (!force && this.binaryEnsured) {
			return this.apiLinterDownloader.ensureBinary(); // Still call it, but it should be fast
		}
		const path = await this.apiLinterDownloader.ensureBinary();
		this.binaryEnsured = true;
		return path;
	}

	/**
	 * Ensures googleapis protos are downloaded
	 */
	public async ensureGoogleapis(force = false): Promise<void> {
		if (!force && this.googleapisEnsured) {
			return;
		}
		await this.googleapisDownloader.ensureGoogleapis();
		this.googleapisEnsured = true;
	}

	/**
	 * Ensures protobuf protos are downloaded
	 */
	public async ensureProtobuf(force = false): Promise<void> {
		if (!force && this.protobufEnsured) {
			return;
		}
		await this.protobufDownloader.ensureProtobuf();
		this.protobufEnsured = true;
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
