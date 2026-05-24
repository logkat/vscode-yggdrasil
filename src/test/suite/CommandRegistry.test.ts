import * as assert from 'assert';
import * as vscode from 'vscode';
import { CommandRegistry, WebviewPanelFactory } from '../../commands/CommandRegistry';
import { GitService } from '../../git/GitService';
import { WorktreeProvider } from '../../tree/WorktreeProvider';
import { WorktreeItem } from '../../tree/WorktreeProvider';

// Minimal mock for vscode.ExtensionContext.globalState
function makeGlobalState(initial: Record<string, unknown> = {}): vscode.Memento & { update: (k: string, v: unknown) => Thenable<void> } {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    keys: () => [...store.keys()],
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) { store.delete(key); }
      else { store.set(key, value); }
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

suite('CommandRegistry — WebView message protocol', () => {
  let capturedMessages: Array<(msg: unknown) => void> = [];

  function makeFactory(autoReply?: { action: string; mode?: string; remember?: boolean }): WebviewPanelFactory {
    return (_title, _html, onMessage) => {
      capturedMessages.push(onMessage);
      if (autoReply) {
        // Deliver the reply asynchronously to simulate user interaction
        Promise.resolve().then(() => onMessage(autoReply));
      }
      return { dispose: () => {} };
    };
  }

  setup(() => {
    capturedMessages = [];
  });

  test('action:cancel resolves without calling openFolder', async () => {
    const openedFolders: vscode.Uri[] = [];
    const ctx = makeMockContext();
    const registry = new CommandRegistry(ctx, makeMockGit(), makeMockProvider(), makeFactory({ action: 'cancel' }));
    registry.register();

    const originalExecute = vscode.commands.executeCommand.bind(vscode.commands);
    let called = false;
    const stub = async (cmd: string, ...args: unknown[]) => {
      if (cmd === 'vscode.openFolder') { called = true; }
      return originalExecute(cmd, ...args);
    };
    (vscode.commands as unknown as { executeCommand: typeof stub }).executeCommand = stub;

    await vscode.commands.executeCommand('yggdrasil.switch', makeWorktreeItem());
    assert.strictEqual(called, false);
  });

  test('action:open mode:newWindow stores preference and opens in new window', async () => {
    const ctx = makeMockContext();
    let openedUri: vscode.Uri | undefined;
    let openedOptions: unknown;

    const factory = makeFactory({ action: 'open', mode: 'newWindow', remember: true });
    const registry = new CommandRegistry(ctx, makeMockGit(), makeMockProvider(), factory);
    registry.register();

    // Intercept the openFolder command
    const orig = vscode.commands.executeCommand.bind(vscode.commands);
    (vscode.commands as unknown as { executeCommand: Function }).executeCommand = async (cmd: string, uri: vscode.Uri, opts: unknown) => {
      if (cmd === 'vscode.openFolder') { openedUri = uri; openedOptions = opts; return; }
      return orig(cmd, uri, opts);
    };

    await vscode.commands.executeCommand('yggdrasil.switch', makeWorktreeItem('main', '/repo/main'));

    assert.ok(openedUri, 'openFolder should have been called');
    assert.strictEqual(openedUri!.fsPath, '/repo/main');
    assert.deepStrictEqual(openedOptions, { forceNewWindow: true });
    assert.strictEqual(ctx.globalState.get('yggdrasil.switchMode'), 'newWindow');
  });

  test('action:open mode:addWorkspace calls updateWorkspaceFolders', async () => {
    const ctx = makeMockContext();
    const factory = makeFactory({ action: 'open', mode: 'addWorkspace', remember: false });
    const registry = new CommandRegistry(ctx, makeMockGit(), makeMockProvider(), factory);
    registry.register();

    let updateCalled = false;
    const origUpdate = vscode.workspace.updateWorkspaceFolders.bind(vscode.workspace);
    (vscode.workspace as unknown as { updateWorkspaceFolders: Function }).updateWorkspaceFolders =
      (start: number, del: number, ...folders: unknown[]) => {
        updateCalled = true;
        return true;
      };

    await vscode.commands.executeCommand('yggdrasil.switch', makeWorktreeItem());
    assert.ok(updateCalled, 'updateWorkspaceFolders should have been called');
    assert.strictEqual(ctx.globalState.get('yggdrasil.switchMode'), undefined, 'should NOT persist when remember=false');
  });

  test('unrecognized action is silently ignored', async () => {
    const ctx = makeMockContext();
    const factory = makeFactory({ action: 'unknown_action', mode: 'newWindow', remember: false });
    const registry = new CommandRegistry(ctx, makeMockGit(), makeMockProvider(), factory);
    registry.register();

    // Should not throw
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand('yggdrasil.switch', makeWorktreeItem()))
    );
  });

  test('stored mode skips dialog and uses saved preference', async () => {
    const ctx = makeMockContext({ 'yggdrasil.switchMode': 'replace' });
    let dialogShown = false;
    const factory: WebviewPanelFactory = () => {
      dialogShown = true;
      return { dispose: () => {} };
    };
    const registry = new CommandRegistry(ctx, makeMockGit(), makeMockProvider(), factory);
    registry.register();

    let openedOptions: unknown;
    (vscode.commands as unknown as { executeCommand: Function }).executeCommand = async (cmd: string, _uri: vscode.Uri, opts: unknown) => {
      if (cmd === 'vscode.openFolder') { openedOptions = opts; }
    };

    await vscode.commands.executeCommand('yggdrasil.switch', makeWorktreeItem());
    assert.strictEqual(dialogShown, false, 'dialog should be skipped when preference is stored');
    assert.deepStrictEqual(openedOptions, { forceNewWindow: false });
  });
});
