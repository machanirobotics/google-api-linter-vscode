/**
 * Default configuration template for .api-linter.yaml files.
 * Contains commented examples of common configuration options.
 */
export const CONFIG_TEMPLATE = `# Google API Linter Configuration
# See: https://linter.aip.dev/configuration

# Disable specific rules
# disabled_rules:
#   - core::0192::has-comments

# Enable specific rules
# enabled_rules:
#   - custom::rule::name

# Additional proto import paths
# proto_paths:
#   - ./protos
#   - ./third_party

# Ignore disable comments in proto files
# ignore_comment_disables: false
`;

/** Glob pattern for matching Protocol Buffer files */
export const PROTO_FILE_PATTERN = '**/*.proto';

/** File extension for Protocol Buffer files */
export const PROTO_FILE_EXTENSION = '.proto';

/** Default configuration file name */
export const CONFIG_FILE_NAME = '.api-linter.yaml';

/** Display name of the extension */
export const EXTENSION_NAME = 'Google API Linter';

/** Source identifier for diagnostics */
export const DIAGNOSTIC_SOURCE = 'google-api-linter';

/** Name of the output channel for logging */
export const OUTPUT_CHANNEL_NAME = 'Google API Linter';
