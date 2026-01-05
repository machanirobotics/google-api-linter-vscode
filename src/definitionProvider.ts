import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fg = require('fast-glob');

/**
 * Provides go-to-definition for proto types like google.protobuf.Timestamp
 */
export class ProtoDefinitionProvider implements vscode.DefinitionProvider {
  
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | null> {
    // First try google.* types (e.g., google.protobuf.Timestamp)
    let wordRange = document.getWordRangeAtPosition(position, /google\.[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/);
    if (wordRange) {
      const word = document.getText(wordRange);
      const protoFile = await this.findProtoFile(word);
      if (protoFile) {
        return await this.findDefinitionInFile(protoFile, word);
      }
    }

    // Try local proto types (e.g., Todo, Priority, CreateTodoRequest)
    wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);
    
    // Search in current file first
    let location = await this.findDefinitionInCurrentFile(document, word);
    if (location) {
      return location;
    }

    // Search in imported files
    location = await this.findDefinitionInImports(document, word);
    if (location) {
      return location;
    }

    return null;
  }

  /**
   * Finds the proto file for a google.* type
   */
  private async findProtoFile(typeName: string): Promise<string | null> {
    // Convert google.protobuf.FieldMask -> google/protobuf/field_mask.proto
    const parts = typeName.split('.');
    const typeNamePart = parts[parts.length - 1];
    // Convert CamelCase to snake_case
    const fileName = typeNamePart.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    const dirPath = parts.slice(0, -1).join('/');
    
    const homeDir = require('os').homedir();
    
    // For google.protobuf types, the path is src/google/protobuf/...
    const isProtobufType = typeName.startsWith('google.protobuf.');
    
    if (isProtobufType) {
      const protoPath = `src/${dirPath}/${fileName}.proto`;
      const protobufPath = path.join(homeDir, '.gapi', 'protobuf', protoPath);
      
      if (fs.existsSync(protobufPath)) {
        return protobufPath;
      }
      
      // Also check without src/ prefix
      const altProtoPath = `${dirPath}/${fileName}.proto`;
      const altProtobufPath = path.join(homeDir, '.gapi', 'protobuf', altProtoPath);
      
      if (fs.existsSync(altProtobufPath)) {
        return altProtobufPath;
      }
      
      return null;
    }

    // For google.api types, check googleapis
    const protoPath = `${dirPath}/${fileName}.proto`;
    const googleapisPath = path.join(homeDir, '.gapi', 'googleapis', protoPath);
    
    if (fs.existsSync(googleapisPath)) {
      return googleapisPath;
    }

    // Check in workspace .gapi/googleapis
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const workspacePath = path.join(folder.uri.fsPath, '.gapi', 'googleapis', protoPath);
        if (fs.existsSync(workspacePath)) {
          return workspacePath;
        }
      }
    }

    return null;
  }

  /**
   * Finds the definition of a type within a proto file
   */
  private async findDefinitionInFile(filePath: string, typeName: string): Promise<vscode.Location | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // Extract the type name (last part after the last dot)
      const typeNameParts = typeName.split('.');
      const simpleTypeName = typeNameParts[typeNameParts.length - 1];
      
      // Search for message, enum, or service definition
      const definitionRegex = new RegExp(`^\\s*(message|enum|service)\\s+${simpleTypeName}\\s*\\{`, 'm');
      
      for (let i = 0; i < lines.length; i++) {
        if (definitionRegex.test(lines[i])) {
          const uri = vscode.Uri.file(filePath);
          const position = new vscode.Position(i, 0);
          const range = new vscode.Range(position, position);
          return new vscode.Location(uri, range);
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error reading proto file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Finds definition in the current file
   */
  private async findDefinitionInCurrentFile(document: vscode.TextDocument, typeName: string): Promise<vscode.Location | null> {
    const content = document.getText();
    const lines = content.split('\n');
    
    const definitionRegex = new RegExp(`^\\s*(message|enum|service)\\s+${typeName}\\s*\\{`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      if (definitionRegex.test(lines[i])) {
        const position = new vscode.Position(i, 0);
        const range = new vscode.Range(position, position);
        return new vscode.Location(document.uri, range);
      }
    }
    
    return null;
  }

  /**
   * Finds definition in imported files using workspace-wide search
   */
  private async findDefinitionInImports(document: vscode.TextDocument, typeName: string): Promise<vscode.Location | null> {
    const content = document.getText();
    const importRegex = /^\s*import\s+('|")(.+\.proto)('|")\s*;\s*$/gim;
    const imports: string[] = [];
    let match;
    
    while ((match = importRegex.exec(content))) {
      imports.push(match[2]);
    }
    
    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return null;
    }
    
    // Build search paths for all imported files
    const searchPaths: string[] = [];
    for (const importPath of imports) {
      const searchPath = path.join(workspaceRoot, '**', path.basename(importPath));
      searchPaths.push(searchPath);
    }
    
    // Use fast-glob to find all matching files
    const files = await fg(searchPaths);
    
    // Search in each imported file
    for (const file of files) {
      const location = await this.findDefinitionInFile(file, typeName);
      if (location) {
        return location;
      }
    }
    
    return null;
  }

}
