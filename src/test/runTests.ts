import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  // Use a short user-data-dir so the IPC socket path stays under 104 chars
  // (the default path inside a deep worktree exceeds macOS's limit).
  const userDataDir = path.join(os.tmpdir(), 'vsc-ygg-test');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--user-data-dir', userDataDir],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
