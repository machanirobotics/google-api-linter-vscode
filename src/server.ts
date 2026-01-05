import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as cp from 'child_process';
import { BinaryManager } from './binaryManager';
import { buildLinterArgs, parseLinterOutput } from './utils/linterUtils';
import { LinterOptions } from './types';

/**
 * Extension settings structure for the language server.
 */
interface ExtensionSettings {
  binaryPath: string;
  additionalArgs: string[];
  configPath: string;
}

const defaultSettings: ExtensionSettings = {
  binaryPath: 'api-linter',
  additionalArgs: [],
  configPath: ''
};

/** Language server connection */
const connection = createConnection(ProposedFeatures.all);

/** Document manager for tracking open documents */
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/** Cache of document-specific settings */
const documentSettings: Map<string, Thenable<ExtensionSettings>> = new Map();

/** Whether the client supports configuration requests */
let hasConfigurationCapability = false;

/** Whether the client supports workspace folders */
let hasWorkspaceFolderCapability = false;

/** Global settings fallback */
let globalSettings: ExtensionSettings = defaultSettings;

connection.onInitialize((params: InitializeParams) => {
  connection.console.log('Language Server initializing...');
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  
  connection.console.log(`Configuration capability: ${hasConfigurationCapability}`);

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
});

connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  } else {
    globalSettings = <ExtensionSettings>(
      (change.settings.googleApiLinter || defaultSettings)
    );
  }

  documents.all().forEach(validateTextDocument);
});

/**
 * Gets settings for a specific document.
 * @param resource - The document URI
 * @returns Promise resolving to the settings
 */
function getDocumentSettings(resource: string): Thenable<ExtensionSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'gapi'
    });
    documentSettings.set(resource, result);
  }
  return result;
}

documents.onDidClose(e => {
  documentSettings.delete(e.document.uri);
});

documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

/**
 * Validates a text document by running the linter.
 * @param textDocument - The document to validate
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);
  
  const filePath = textDocument.uri.replace('file://', '');
  
  if (!filePath.endsWith('.proto')) {
    return;
  }

  connection.console.log(`Validating document: ${filePath}`);

  try {
    const binaryManager = new BinaryManager({
      appendLine: (msg: string) => connection.console.log(msg)
    } as any);
    
    const binaryPath = await binaryManager.ensureBinary();
    connection.console.log(`Using binary: ${binaryPath}`);
    
    const diagnostics = await runLinter(binaryPath, filePath, settings);
    connection.console.log(`Found ${diagnostics.length} diagnostic(s) for ${filePath}`);
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (error) {
    connection.console.error(`Error linting ${filePath}: ${error}`);
  }
}

/**
 * Runs the linter on a file and returns diagnostics.
 * @param binaryPath - Path to the api-linter binary
 * @param filePath - Path to the file to lint
 * @param settings - Extension settings
 * @returns Array of diagnostics
 */
async function runLinter(
  binaryPath: string,
  filePath: string,
  settings: ExtensionSettings
): Promise<Diagnostic[]> {
  return new Promise((resolve, reject) => {
    const options: LinterOptions = {
      configPath: settings.configPath,
      protoPath: [],
      disableRules: [],
      enableRules: [],
      descriptorSetIn: [],
      ignoreCommentDisables: false,
      setExitStatus: false
    };

    const { args, workingDir } = buildLinterArgs(filePath, options);
    args.push(...settings.additionalArgs);

    const process = cp.spawn(binaryPath, args, { cwd: workingDir });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    process.on('error', (error: Error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`api-linter binary not found at: ${binaryPath}`));
      } else {
        reject(error);
      }
    });

    process.on('close', (code: number) => {
      if (stderr) {
        connection.console.log(`stderr: ${stderr}`);
      }

      if (code !== 0 && code !== 1) {
        connection.console.log(`api-linter exited with code ${code}`);
        reject(new Error(`api-linter exited with code ${code}`));
        return;
      }

      try {
        const vscDiagnostics = parseLinterOutput(stdout);
        const diagnostics = vscDiagnostics.map(d => ({
          severity: DiagnosticSeverity.Error,
          range: d.range,
          message: d.message,
          source: d.source,
          code: typeof d.code === 'object' ? d.code.value : d.code
        }));
        resolve(diagnostics);
      } catch (error) {
        connection.console.error(`Failed to parse linter output: ${error}`);
        resolve([]);
      }
    });
  });
}

documents.listen(connection);
connection.listen();
