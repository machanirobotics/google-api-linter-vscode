import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

type FormatterKind = "buf" | "clang-format" | "simple";

/**
 * DocumentFormattingEditProvider for .proto files.
 * Uses gapi.formatter: buf format, clang-format, or simple built-in.
 */
export class ProtoFormatProvider
	implements vscode.DocumentFormattingEditProvider
{
	provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.TextEdit[]> {
		const formatter = this.getFormatterKind();
		return this.runFormatter(document, formatter, options).then((formatted) => {
			if (formatted !== null) {
				const fullRange = new vscode.Range(
					document.positionAt(0),
					document.positionAt(document.getText().length),
				);
				return [vscode.TextEdit.replace(fullRange, formatted)];
			}
			return this.simpleFormat(document, options);
		});
	}

	private getFormatterKind(): FormatterKind {
		const config = vscode.workspace.getConfiguration("gapi");
		const raw = config.get<string>("formatter", "buf");
		return raw === "clang-format" || raw === "simple" ? raw : "buf";
	}

	private async runFormatter(
		document: vscode.TextDocument,
		kind: FormatterKind,
		_options: vscode.FormattingOptions,
	): Promise<string | null> {
		if (kind === "simple") return null;
		if (kind === "clang-format") return this.formatWithClangFormat(document);
		return this.formatWithBuf(document);
	}

	/** Use clang-format with --assume-filename for Protobuf. */
	private async formatWithClangFormat(
		document: vscode.TextDocument,
	): Promise<string | null> {
		const config = vscode.workspace.getConfiguration("gapi");
		const bin = config.get<string>("clangFormatPath", "clang-format");
		const text = document.getText();
		const assumeName = path.basename(document.uri.fsPath) || "file.proto";
		return new Promise<string | null>((resolve) => {
			const child = cp.spawn(bin, [`--assume-filename=${assumeName}`], {
				stdio: ["pipe", "pipe", "pipe"],
			});
			let out = "";
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				out += chunk;
			});
			child.on("error", () => resolve(null));
			child.on("close", (code) => {
				resolve(code === 0 && out ? out : null);
			});
			child.stdin.end(text, "utf8");
		});
	}

	private async formatWithBuf(
		document: vscode.TextDocument,
	): Promise<string | null> {
		const text = document.getText();
		let tempPath: string | null = null;
		try {
			const ext = document.uri.fsPath.endsWith(".proto") ? "" : ".proto";
			const tmpFile = path.join(
				os.tmpdir(),
				`proto-format-${Date.now()}${ext}`,
			);
			fs.writeFileSync(tmpFile, text, "utf8");
			tempPath = tmpFile;
			const result = await new Promise<string>((resolve, reject) => {
				cp.execFile(
					"buf",
					["format", tmpFile],
					{ maxBuffer: 10 * 1024 * 1024 },
					(err, stdout, _stderr) => {
						if (err) {
							reject(err);
							return;
						}
						resolve(stdout);
					},
				);
			});
			return result;
		} catch {
			return null;
		} finally {
			if (tempPath && fs.existsSync(tempPath)) {
				try {
					fs.unlinkSync(tempPath);
				} catch {}
			}
		}
	}

	/** Simple formatter: indent per brace level, trim trailing whitespace, single newline at EOF. */
	private simpleFormat(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
	): vscode.TextEdit[] {
		const lines = document.getText().split(/\r?\n/);
		const indent = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
		let depth = 0;
		const out: string[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === "") {
				out.push("");
				continue;
			}
			const openCount = (line.match(/\{/g) ?? []).length;
			const closeCount = (line.match(/\}/g) ?? []).length;
			out.push(indent.repeat(depth) + trimmed);
			depth = Math.max(0, depth + openCount - closeCount);
		}
		let result = out.join("\n").trimEnd();
		if (result && !result.endsWith("\n")) {
			result += "\n";
		}
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(document.getText().length),
		);
		return [vscode.TextEdit.replace(fullRange, result)];
	}
}

const sharedFormatProvider = new ProtoFormatProvider();

export function registerFormatProvider(
	selector: vscode.DocumentSelector,
): vscode.Disposable {
	return vscode.languages.registerDocumentFormattingEditProvider(
		selector,
		sharedFormatProvider,
	);
}

/**
 * Returns formatting edits for a proto document (used for format-on-save).
 * Uses the same logic as the document formatter: buf format if available, else simple indent.
 */
export async function getFormatEdits(
	document: vscode.TextDocument,
	options?: vscode.FormattingOptions,
): Promise<vscode.TextEdit[]> {
	const opts = options ?? {
		tabSize: 2,
		insertSpaces: true,
	};
	const result = await sharedFormatProvider.provideDocumentFormattingEdits(
		document,
		opts,
		new vscode.CancellationTokenSource().token,
	);
	return result ?? [];
}
