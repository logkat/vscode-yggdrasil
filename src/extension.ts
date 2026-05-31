import * as vscode from 'vscode';
import { GitService } from './git/GitService';
import { WorktreeProvider } from './tree/WorktreeProvider';
import { WorktreeDecorationProvider } from './tree/WorktreeDecorationProvider';
import { CommandRegistry } from './commands/CommandRegistry';
import { maybeShowWelcome, showWelcome } from './welcome/WelcomePage';
import { YggContentProvider } from './content/YggContentProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Set initial loading state
  vscode.commands.executeCommand('setContext', 'yggdrasil.isReady', false);

  try {
    const git = new GitService(
      () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      (worktreePath?: string) => {
        if (worktreePath) {
          const perWorktreeBase = context.workspaceState.get<string>(`ygg.baseBranch:${worktreePath}`);
          if (perWorktreeBase) { return perWorktreeBase; }
        }
        return vscode.workspace.getConfiguration('ygg').get<string>('baseBranch') || undefined;
      },
    );

    const decorationProvider = new WorktreeDecorationProvider();
    const provider = new WorktreeProvider(git, decorationProvider);

    const treeView = vscode.window.createTreeView('ygg.worktrees', {
      treeDataProvider: provider,
      showCollapseAll: false,
    });

    const explorerView = vscode.window.createTreeView('ygg.worktrees.explorer', {
      treeDataProvider: provider,
      showCollapseAll: false,
    });

    const registry = new CommandRegistry(context, git, provider);
    const commands = registry.register();

    const contentProvider = new YggContentProvider();
    const contentProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
      'ygg-git',
      contentProvider
    );

    const welcomeCommand = vscode.commands.registerCommand('ygg.welcome', () => showWelcome(context));

    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider(decorationProvider),
      treeView,
      explorerView,
      welcomeCommand,
      contentProviderDisposable,
      ...commands,
      provider
    );

    await maybeShowWelcome(context);

    // Initial indexing to set the ready state
    try {
      await git.getRepoRoot();
      await git.listWorktrees();
      // Ensure status bar is updated with the current worktree name
      await registry.updateWorktreeStatusBar();
    } catch (err) {
      // Expected if not a git repo or no workspace open — leave the ready
      // state false so the welcome view's "no git repo" message renders.
      console.log('Yggdrasil: initial index failed', err);
    }
  } catch (err) {
    // An unexpected wiring failure (e.g. a bad disposable). Log so users can
    // file an issue rather than silently shipping a broken extension.
    console.error('Yggdrasil: activation failed', err);
  } finally {
    vscode.commands.executeCommand('setContext', 'yggdrasil.isReady', true);
  }
}

export function deactivate(): void {
  // VS Code disposes all context.subscriptions automatically
}
