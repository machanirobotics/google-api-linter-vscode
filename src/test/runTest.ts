import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.join(__dirname, 'e2e', 'extension.test');
    const workspacePath = path.join(extensionDevelopmentPath, 'smoke_test', 'protobuf');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath],
      version: undefined, // use VS Code version from env or default
    });
  } catch (err) {
    console.error('E2E test run failed:', err);
    process.exit(1);
  }
}

main();
