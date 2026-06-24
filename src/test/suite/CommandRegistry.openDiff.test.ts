import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommandRegistry } from '../../commands/CommandRegistry';
import { WorktreeFileItem, WorktreeProvider } from '../../tree/WorktreeProvider';
import { FileStatus, GitService } from '../../git/GitService';

function makeMockContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      keys: () => [...store.keys()],
      get<T>(key: string, defaultValue?: T): T {
        return (store.has(key) ? store.get(key) : defaultValue) as T;
      },
      update(key: string, value: unknown): Thenable<void> {
        if (value === undefined) {
          store.delete(key);
        } else {
          store.set(key, value);
        }
        return Promise.resolve();
      },
    },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function makeMockGit(): GitService {
  return {
    getRepoRoot: async () => '/repo',
    listWorktrees: async () => [],
    addWorktree: async () => {},
    removeWorktree: async () => {},
    invalidateCache: () => {},
  } as unknown as GitService;
}

function makeMockProvider(): WorktreeProvider {
  return { refresh: () => {} } as unknown as WorktreeProvider;
}

function makeFileItem(
  relativePath: string,
  status: FileStatus['status'],
  worktreePath: string,
  branch: string,
  baseSha = 'sha123'
): WorktreeFileItem {
  const file: FileStatus = { relativePath, status, isUntracked: false };
  const uri = vscode.Uri.parse(
    `ygg-worktree://worktree?path=${encodeURIComponent(path.join(worktreePath, relativePath))}&branch=${encodeURIComponent(branch)}`
  );
  return new WorktreeFileItem(file, worktreePath, branch, baseSha, uri);
}

suite('CommandRegistry — ygg.openDiff', () => {
  test('calls vscode.diff with correct URIs and preview: true', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    const item = makeFileItem('src/foo.ts', 'M', '/repo/feat', 'feat', 'baseSHA');

    const calls: { cmd: string; args: unknown[] }[] = [];
    const origExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (cmd: string, ...args: unknown[]) => {
      calls.push({ cmd, args });
    };

    try {
      await (reg as any).openDiff(item);
    } finally {
      (vscode.commands as any).executeCommand = origExecute;
    }

    const diffCall = calls.find((c) => c.cmd === 'vscode.diff');
    assert.ok(diffCall, 'vscode.diff was not called');

    const [leftUri, rightUri, title, opts] = diffCall!.args as [
      vscode.Uri,
      vscode.Uri,
      string,
      unknown,
    ];
    assert.strictEqual(leftUri.scheme, 'ygg-git');
    assert.strictEqual(rightUri.scheme, 'ygg-git');

    const leftParams = new URLSearchParams(leftUri.query);
    assert.strictEqual(leftParams.get('side'), 'BASE');
    assert.strictEqual(leftParams.get('sha'), 'baseSHA');
    assert.strictEqual(leftParams.get('wt'), '/repo/feat');
    assert.strictEqual(leftParams.get('file'), 'src/foo.ts');

    const rightParams = new URLSearchParams(rightUri.query);
    assert.strictEqual(rightParams.get('side'), 'WORK');

    assert.strictEqual(title, 'feat — src/foo.ts (branch base ↔ working tree)');
    assert.deepStrictEqual(opts, { preview: true });
  });

  test('does nothing when called with no arguments', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());

    const calls: string[] = [];
    const origExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (cmd: string) => {
      calls.push(cmd);
    };

    try {
      await (reg as any).openDiff(undefined);
    } finally {
      (vscode.commands as any).executeCommand = origExecute;
    }

    assert.strictEqual(
      calls.filter((c) => c === 'vscode.diff').length,
      0,
      'vscode.diff should not have been called'
    );
  });

  test('diff title format: "<branch> — <relativePath> (branch base ↔ working tree)"', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    const item = makeFileItem(
      'components/Button.tsx',
      'A',
      '/home/user/projects/feature-x',
      'feature/add-button'
    );

    let capturedTitle = '';
    const origExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (
      cmd: string,
      _l: unknown,
      _r: unknown,
      title: string
    ) => {
      if (cmd === 'vscode.diff') {
        capturedTitle = title;
      }
    };

    try {
      await (reg as any).openDiff(item);
    } finally {
      (vscode.commands as any).executeCommand = origExecute;
    }

    assert.strictEqual(
      capturedTitle,
      'feature/add-button — components/Button.tsx (branch base ↔ working tree)'
    );
  });

  test('register() includes ygg.openDiff disposable', () => {
    const git = {} as any;
    const provider = {} as any;
    const mockContext: vscode.ExtensionContext = makeMockContext();
    const reg = new CommandRegistry(mockContext, git, provider);

    // Stub registerCommand so it doesn't conflict with the already-activated extension
    const registeredNames: string[] = [];
    const origRegister = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = (name: string, _handler: unknown) => {
      registeredNames.push(name);
      return { dispose: () => {} };
    };

    let disposables: vscode.Disposable[];
    try {
      disposables = reg.register();
    } finally {
      (vscode.commands as any).registerCommand = origRegister;
    }

    assert.ok(disposables!.length > 0, 'register() should return disposables');
    assert.ok(registeredNames.includes('ygg.openDiff'), 'ygg.openDiff should be registered');
  });
});
