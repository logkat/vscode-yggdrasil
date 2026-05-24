import * as vscode from 'vscode';
import { GitService } from './git/GitService';
import { WorktreeProvider } from './tree/WorktreeProvider';
import { CommandRegistry } from './commands/CommandRegistry';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const git = new GitService(
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  );

  const provider = new WorktreeProvider(git);

  const treeView = vscode.window.createTreeView('yggdrasil.worktrees', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const registry = new CommandRegistry(context, git, provider);
  const commands = registry.register();

  // Set up file watchers once we know the repo root
  let watcherDisposable: vscode.Disposable | undefined;
  git.getRepoRoot().then((root) => {
    watcherDisposable = provider.setupWatchers(root);
    context.subscriptions.push(watcherDisposable);
  }).catch(() => {
    // Watcher setup is best-effort; provider will show error on first load
  });

  context.subscriptions.push(treeView, ...commands);
}

export function deactivate(): void {
  // VS Code disposes all context.subscriptions automatically
}
