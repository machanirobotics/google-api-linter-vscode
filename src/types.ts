/**
 * Metadata about the installed api-linter binary.
 */
export interface BinaryMetadata {
  /** Version tag of the installed binary (e.g., 'v1.2.3') */
  version: string;
  /** Timestamp of the last update check in milliseconds */
  lastChecked: number;
  /** Absolute path to the binary executable */
  path: string;
}

/**
 * Location information for a linter diagnostic.
 * Coordinates are 1-indexed as returned by the api-linter binary.
 */
export interface LinterLocation {
  /** Starting position of the diagnostic */
  start_position: {
    /** Line number (1-indexed) */
    line_number: number;
    /** Column number (1-indexed) */
    column_number: number;
  };
  /** Ending position of the diagnostic */
  end_position: {
    /** Line number (1-indexed) */
    line_number: number;
    /** Column number (1-indexed) */
    column_number: number;
  };
  /** File path where the issue was found */
  path: string;
}

/**
 * A single problem reported by the api-linter.
 */
export interface LinterProblem {
  /** Human-readable description of the issue */
  message: string;
  /** Location information for the problem */
  location: LinterLocation;
  /** Unique identifier for the violated rule (e.g., 'core::0131::http-uri-suffix') */
  rule_id: string;
  /** URL to the rule's documentation */
  rule_doc_uri: string;
}

/**
 * Output structure from the api-linter JSON format.
 */
export interface LinterOutput {
  /** Path to the file that was linted */
  file_path: string;
  /** Array of problems found in the file */
  problems: LinterProblem[];
}

/**
 * Configuration options for running the api-linter.
 */
export interface LinterOptions {
  /** Path to the .api-linter.yaml configuration file */
  configPath: string;
  /** Additional proto import paths */
  protoPath: string[];
  /** Rules to disable */
  disableRules: string[];
  /** Rules to enable */
  enableRules: string[];
  /** Paths to descriptor set files */
  descriptorSetIn: string[];
  /** Whether to ignore comment-based rule disables */
  ignoreCommentDisables: boolean;
  /** Whether to set exit status based on findings */
  setExitStatus: boolean;
}
