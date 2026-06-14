import * as assert from 'assert';
import * as vscode from 'vscode';
import { CommandRegistry } from '../../commands/CommandRegistry';
import { GitService } from '../../git/GitService';
import { WorktreeProvider } from '../../tree/WorktreeProvider';
import { WorktreeItem } from '../../tree/WorktreeProvider';

function makeGlobalState(
  initial: Record<string, unknown> = {}
): vscode.Memento & { update: (k: string, v: unknown) => Thenable<void> } {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
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
  };
}

function makeMockContext(globalStateValues: Record<string, unknown> = {}): vscode.ExtensionContext {
  return {
    globalState: makeGlobalState(globalStateValues),
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function makeMockGit(
  worktrees: Partial<import('../../git/GitService').Worktree>[] = []
): GitService {
  return {
    getRepoRoot: async () => '/repo',
    listWorktrees: async () => worktrees,
    addWorktree: async () => {},
    removeWorktree: async () => {},
    invalidateCache: () => {},
  } as unknown as GitService;
}

function makeMockProvider(): WorktreeProvider {
  return { refresh: () => {} } as unknown as WorktreeProvider;
}

function makeWorktreeItem(branch = 'feature/test', wtPath = '/repo/feature'): WorktreeItem {
  return {
    worktree: {
      path: wtPath,
      branch,
      head: 'abc123',
      isCurrent: false,
      isDirty: false,
      pathExists: true,
      locked: false,
      bare: false,
    },
  } as unknown as WorktreeItem;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getRegistry(
  ctx = makeMockContext(),
  git = makeMockGit(),
  provider = makeMockProvider()
): CommandRegistry {
  // Instead of registering again, we just return a new instance if needed,
  // but the commands are already bound to the first instance.
  // This is a limitation of testing in a real VS Code host.
  // For these tests, we'll try to use the registry instance to call methods directly
  // or rely on the fact that they call the same methods.
  return new CommandRegistry(ctx, git, provider);
}

suite('CommandRegistry', () => {
  let disposables: vscode.Disposable[] = [];

  setup(() => {
    // We can't really unregister commands in the real VS Code host,
    // and the extension might have already registered them.
    // So we don't call registry.register() in setup.
  });

  teardown(() => {
    disposables.forEach((d) => d.dispose());
    disposables = [];
  });

  suite('ygg.switch — inline button, no dialog', () => {
    test('uses stored newWindow preference directly', async () => {
      const ctx = makeMockContext({ 'ygg.switchMode': 'newWindow' });
      const reg = new CommandRegistry(ctx, makeMockGit(), makeMockProvider());
      // Directly call the private method via any

      let openedOptions: any;
      const originalExecute = vscode.commands.executeCommand;
      (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.openFolder') {
          openedOptions = args[1];
          return;
        }
        return originalExecute(cmd, ...args);
      };

      try {
        await (reg as any).switchWorktree(makeWorktreeItem('main', '/repo/main'));
        assert.deepStrictEqual(openedOptions, { forceNewWindow: true });
      } finally {
        (vscode.commands as any).executeCommand = originalExecute;
      }
    });

    test('does nothing (no stored mode, dialog cancelled) when no preference stored', async () => {
      const ctx = makeMockContext();
      const reg = new CommandRegistry(ctx, makeMockGit(), makeMockProvider());

      const originalShowQP = vscode.window.showQuickPick;
      const originalExecute = vscode.commands.executeCommand;

      (vscode.window as any).showQuickPick = async () => undefined;

      let openCalled = false;
      (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.openFolder') {
          openCalled = true;
          return;
        }
        return originalExecute(cmd, ...args);
      };

      try {
        await (reg as any).switchWorktree(makeWorktreeItem('feature', '/repo/feature'));
        assert.strictEqual(openCalled, false, 'should not open when dialog is dismissed');
      } finally {
        (vscode.window as any).showQuickPick = originalShowQP;
        (vscode.commands as any).executeCommand = originalExecute;
      }
    });

    test('uses stored replace preference directly', async () => {
      const ctx = makeMockContext({ 'ygg.switchMode': 'replace' });
      const reg = new CommandRegistry(ctx, makeMockGit(), makeMockProvider());

      let openedOptions: any;
      const originalExecute = vscode.commands.executeCommand;
      (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.openFolder') {
          openedOptions = args[1];
          return;
        }
        return originalExecute(cmd, ...args);
      };

      try {
        await (reg as any).switchWorktree(makeWorktreeItem());
        assert.deepStrictEqual(openedOptions, { forceNewWindow: false });
      } finally {
        (vscode.commands as any).executeCommand = originalExecute;
      }
    });

    test('uses stored addWorkspace preference directly', async () => {
      const ctx = makeMockContext({ 'ygg.switchMode': 'addWorkspace' });
      const reg = new CommandRegistry(ctx, makeMockGit(), makeMockProvider());

      let updateCalled = false;
      const originalUpdate = vscode.workspace.updateWorkspaceFolders;
      (vscode.workspace as any).updateWorkspaceFolders = () => {
        updateCalled = true;
        return true;
      };

      try {
        await (reg as any).switchWorktree(makeWorktreeItem());
        assert.ok(updateCalled);
      } finally {
        (vscode.workspace as any).updateWorkspaceFolders = originalUpdate;
      }
    });

    test('does nothing when item is undefined', async () => {
      const ctx = makeMockContext();
      const reg = new CommandRegistry(ctx, makeMockGit(), makeMockProvider());

      let openCalled = false;
      const originalExecute = vscode.commands.executeCommand;
      (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.openFolder') {
          openCalled = true;
          return;
        }
        return originalExecute(cmd, ...args);
      };

      try {
        await (reg as any).switchWorktree(undefined);
        assert.strictEqual(openCalled, false);
      } finally {
        (vscode.commands as any).executeCommand = originalExecute;
      }
    });
  });

  suite('ygg.selectAndSwitch — palette picker', () => {
    test('shows informationMessage when no switchable worktrees exist', async () => {
      const ctx = makeMockContext();
      const allCurrent = [
        {
          path: '/repo',
          branch: 'main',
          isCurrent: true,
          pathExists: true,
          head: '',
          isDirty: false,
          locked: false,
          bare: false,
        },
      ];
      const reg = new CommandRegistry(ctx, makeMockGit(allCurrent), makeMockProvider());

      let infoShown = false;
      const originalInfo = vscode.window.showInformationMessage;
      (vscode.window as any).showInformationMessage = async () => {
        infoShown = true;
        return undefined;
      };

      try {
        await (reg as any).selectAndSwitch();
        assert.ok(infoShown);
      } finally {
        vscode.window.showInformationMessage = originalInfo;
      }
    });

    test('calls listWorktrees to populate picker', async () => {
      const ctx = makeMockContext();
      let listCalled = false;
      const git = {
        ...makeMockGit(),
        listWorktrees: async () => {
          listCalled = true;
          return [];
        },
      } as unknown as GitService;
      const reg = new CommandRegistry(ctx, git, makeMockProvider());

      const originalInfo = vscode.window.showInformationMessage;
      (vscode.window as any).showInformationMessage = async () => undefined;

      try {
        await (reg as any).selectAndSwitch();
        assert.ok(listCalled);
      } finally {
        vscode.window.showInformationMessage = originalInfo;
      }
    });
  });

  suite('null-guard — commands do nothing without item', () => {
    test('remove without item does not call removeWorktree', async () => {
      const ctx = makeMockContext();
      let removeCalled = false;
      const git = {
        ...makeMockGit(),
        removeWorktree: async () => {
          removeCalled = true;
        },
      } as unknown as GitService;
      const reg = new CommandRegistry(ctx, git, makeMockProvider());

      await (reg as any).removeWorktree(undefined);
      assert.strictEqual(removeCalled, false);
    });

    test('copyPath without item does not throw', async () => {
      // Use the already registered command from the extension activation
      await vscode.commands.executeCommand('ygg.copyPath', undefined);
    });

    test('revealInOs without item does not throw', async () => {
      await vscode.commands.executeCommand('ygg.revealInOs', undefined);
    });
  });
});
