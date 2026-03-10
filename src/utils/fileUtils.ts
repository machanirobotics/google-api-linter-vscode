import * as vscode from 'vscode';

/**
 * Checks if a file is a Protocol Buffer file based on its extension.
 * @param fileName - The file name or path to check
 * @returns True if the file has a .proto extension
 */
export const isProtoFile = (fileName: string): boolean => fileName.endsWith('.proto');

/**
 * Gets the active text editor if it contains a .proto file.
 * @returns The active editor if it's editing a proto file, undefined otherwise
 */
export const getActiveProtoEditor = (): vscode.TextEditor | undefined => {
  const editor = vscode.window.activeTextEditor;
  return editor && isProtoFile(editor.document.fileName) ? editor : undefined;
};

/**
 * Finds all .proto files in the workspace.
 * @returns Promise resolving to an array of URIs for proto files
 */
export const findProtoFiles = async (): Promise<vscode.Uri[]> => {
  return vscode.workspace.findFiles('**/*.proto', '**/node_modules/**');
};

/**
 * Finds .proto files under a specific workspace folder.
 */
export const findProtoFilesInFolder = async (folderUri: vscode.Uri): Promise<vscode.Uri[]> => {
  const all = await findProtoFiles();
  const prefix = folderUri.fsPath.replace(/\/?$/, '/');
  return all.filter((u) => u.fsPath.startsWith(prefix));
};
