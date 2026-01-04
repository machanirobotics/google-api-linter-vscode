# Google API Linter for VS Code

A Visual Studio Code extension that integrates the [Google API Linter](https://github.com/googleapis/api-linter) to validate Protocol Buffer files against the [Google API Design Guidelines](https://cloud.google.com/apis/design). This extension provides real-time linting, diagnostics, and inline documentation for API design rules.

## Features

- **Real-time Linting**: Automatically validates `.proto` files as you type or save
- **Inline Diagnostics**: Displays linting errors and warnings directly in the editor
- **Hover Documentation**: Shows detailed rule information when hovering over diagnostics
- **Workspace Linting**: Lint all proto files in your workspace with a single command
- **Configurable Rules**: Enable or disable specific linting rules via configuration
- **Custom Proto Paths**: Support for custom import paths and descriptor sets

## Architecture

The extension operates through a multi-layered architecture that integrates the `api-linter` binary with VS Code's diagnostic system.

```mermaid
graph TB
    A[VS Code Editor] -->|Document Events| B[Extension Activation]
    B --> C[Linter Provider]
    B --> D[Hover Provider]
    B --> E[Command Registry]
    
    C -->|Executes| F[Binary Manager]
    F -->|Spawns Process| G[api-linter Binary]
    G -->|JSON Output| F
    F -->|Parsed Results| C
    
    C -->|Creates| H[Diagnostic Collection]
    H -->|Displays| A
    
    D -->|Reads| H
    D -->|Shows Documentation| A
    
    E -->|Triggers| C
    
    style G fill:#e1f5ff
    style H fill:#fff4e1
    style A fill:#f0f0f0
```

## How It Works

### Workflow Overview

```mermaid
sequenceDiagram
    participant User
    participant VSCode
    participant Extension
    participant BinaryManager
    participant ApiLinter
    
    User->>VSCode: Opens/Edits .proto file
    VSCode->>Extension: Document event triggered
    Extension->>Extension: Check if linting enabled
    Extension->>BinaryManager: Request lint execution
    BinaryManager->>BinaryManager: Resolve binary path
    BinaryManager->>BinaryManager: Build command arguments
    BinaryManager->>ApiLinter: Execute with proto file
    ApiLinter->>ApiLinter: Parse & validate proto
    ApiLinter-->>BinaryManager: Return JSON diagnostics
    BinaryManager->>Extension: Parse JSON output
    Extension->>Extension: Convert to VS Code diagnostics
    Extension->>VSCode: Update diagnostic collection
    VSCode->>User: Display inline errors/warnings
    
    User->>VSCode: Hover over diagnostic
    VSCode->>Extension: Request hover information
    Extension->>Extension: Lookup rule documentation
    Extension-->>VSCode: Return formatted hover content
    VSCode->>User: Display rule details
```

### Component Breakdown

#### 1. Extension Activation
When a `.proto` file is opened or the extension starts:
- Registers diagnostic collection for displaying linting results
- Creates output channel for logging
- Initializes linter and hover providers
- Registers commands and document event listeners

#### 2. Binary Manager
Manages the `api-linter` binary execution:
- Locates the binary (custom path or system PATH)
- Constructs command-line arguments from configuration
- Handles process spawning and output streaming
- Parses JSON output into structured diagnostics

#### 3. Linter Provider
Core linting logic:
- Receives document change events
- Invokes binary manager with current file
- Transforms linter output to VS Code diagnostics
- Updates diagnostic collection with results

#### 4. Hover Provider
Provides contextual information:
- Detects when user hovers over a diagnostic
- Retrieves rule documentation from diagnostic metadata
- Formats and displays rule details in hover tooltip

## Installation

### Prerequisites

Install the `api-linter` binary on your system:

**macOS (Homebrew)**
```bash
brew install api-linter
```

**Linux/macOS (Go)**
```bash
go install github.com/googleapis/api-linter/cmd/api-linter@latest
```

**Manual Installation**
Download the binary from [GitHub Releases](https://github.com/googleapis/api-linter/releases) and add it to your PATH.

### Extension Installation

1. **From VS Code Marketplace**
   - Open VS Code
   - Go to Extensions (Cmd+Shift+X / Ctrl+Shift+X)
   - Search for "Google API Linter"
   - Click Install

2. **From VSIX File**
   ```bash
   code --install-extension google-api-linter-1.0.0.vsix
   ```

## Configuration

Configure the extension through VS Code settings (File > Preferences > Settings or `Cmd+,`):

### Available Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `googleApiLinter.binaryPath` | string | `"api-linter"` | Path to the api-linter binary |
| `googleApiLinter.enableOnSave` | boolean | `true` | Run linter when saving proto files |
| `googleApiLinter.enableOnType` | boolean | `false` | Run linter while typing (may impact performance) |
| `googleApiLinter.configPath` | string | `""` | Path to `.api-linter.yaml` configuration file |
| `googleApiLinter.protoPath` | array | `[]` | Additional proto import paths |
| `googleApiLinter.disableRules` | array | `[]` | Rules to disable (e.g., `["core::0192::has-comments"]`) |
| `googleApiLinter.enableRules` | array | `[]` | Rules to explicitly enable |
| `googleApiLinter.descriptorSetIn` | array | `[]` | FileDescriptorSet files for imports |
| `googleApiLinter.ignoreCommentDisables` | boolean | `false` | Ignore disable comments in proto files |
| `googleApiLinter.setExitStatus` | boolean | `false` | Return exit status 1 on lint errors |

### Example Configuration

```json
{
  "googleApiLinter.binaryPath": "/usr/local/bin/api-linter",
  "googleApiLinter.enableOnSave": true,
  "googleApiLinter.enableOnType": false,
  "googleApiLinter.protoPath": [
    "${workspaceFolder}/proto",
    "${workspaceFolder}/third_party/googleapis"
  ],
  "googleApiLinter.disableRules": [
    "core::0192::has-comments"
  ]
}
```

### Workspace Configuration

For project-specific settings, create `.vscode/settings.json`:

```json
{
  "googleApiLinter.configPath": "${workspaceFolder}/.api-linter.yaml",
  "googleApiLinter.protoPath": [
    "${workspaceFolder}/proto",
    "${workspaceFolder}/third_party"
  ]
}
```

## Usage

### Commands

Access commands via Command Palette (Cmd+Shift+P / Ctrl+Shift+P):

- **Google API Linter: Lint Current File** - Lint the currently open proto file
- **Google API Linter: Lint All Proto Files in Workspace** - Lint all `.proto` files in workspace
- **Google API Linter: Create Config File** - Generate a `.api-linter.yaml` template
- **Google API Linter: Restart** - Restart the linter (useful after config changes)

### Automatic Linting

By default, the extension lints proto files:
- When opening a proto file
- When saving a proto file (if `enableOnSave` is true)
- When typing (if `enableOnType` is true)

### Viewing Diagnostics

Linting results appear:
- **Inline**: Squiggly underlines in the editor
- **Problems Panel**: View > Problems (Cmd+Shift+M / Ctrl+Shift+M)
- **Hover**: Hover over underlined code to see rule details

## API Linter Configuration

Create a `.api-linter.yaml` file in your project root to configure linting rules:

```yaml
# Disable specific rules
disabled_rules:
  - core::0192::has-comments
  - core::0203::optional

# Enable specific rules
enabled_rules:
  - core::0140::prepositions

# Rule-specific configuration
rule_configs:
  core::0192::
    allow_missing_comments: true
```

Refer to the [api-linter documentation](https://linter.aip.dev/) for available rules and configuration options.

## Troubleshooting

### Binary Not Found

**Error**: `api-linter binary not found`

**Solution**:
1. Verify `api-linter` is installed: `which api-linter`
2. Set `googleApiLinter.binaryPath` to the full path
3. Ensure the binary has execute permissions: `chmod +x /path/to/api-linter`

### Import Errors

**Error**: `Import "google/api/annotations.proto" was not found`

**Solution**:
1. Export Google API protos locally:
   ```bash
   buf export buf.build/googleapis/googleapis --output third_party/googleapis
   ```
2. Configure proto path:
   ```json
   {
     "googleApiLinter.protoPath": ["${workspaceFolder}/third_party/googleapis"]
   }
   ```

### Performance Issues

If linting is slow or causes lag:
1. Disable `enableOnType` (keep `enableOnSave` enabled)
2. Use `.api-linter.yaml` to disable expensive rules
3. Exclude large proto files or directories

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/machanirobotics/google-api-linter-vscode.git
cd google-api-linter-vscode

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package extension
npm run package

# Install locally
code --install-extension google-api-linter-1.0.0.vsix
```

### Project Structure

```
vscode-googleapi-linter/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── linterProvider.ts     # Core linting logic
│   ├── binaryManager.ts      # Binary execution handler
│   ├── hoverProvider.ts      # Hover documentation
│   ├── commands.ts           # Command implementations
│   ├── constants.ts          # Shared constants
│   ├── types.ts              # TypeScript type definitions
│   └── utils/                # Utility functions
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
└── .github/
    └── workflows/
        └── release.yaml      # CI/CD pipeline
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with clear commit messages
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the Apache License 2.0. See [LICENSE.md](LICENSE.md) for details.

## Resources

- [Google API Linter](https://github.com/googleapis/api-linter)
- [Google API Design Guide](https://cloud.google.com/apis/design)
- [API Improvement Proposals (AIPs)](https://google.aip.dev/)
- [Protocol Buffers](https://protobuf.dev/)

## Support

- **Issues**: [GitHub Issues](https://github.com/machanirobotics/google-api-linter-vscode/issues)
- **Discussions**: [GitHub Discussions](https://github.com/machanirobotics/google-api-linter-vscode/discussions)

---

**Machani Robotics** | [GitHub](https://github.com/machanirobotics) | [Website](https://machanirobotics.com)
