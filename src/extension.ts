import * as vscode from 'vscode';
import { GitService } from './git/GitService';
import { WorktreeProvider } from './tree/WorktreeProvider';
import { WorktreeDecorationProvider } from './tree/WorktreeDecorationProvider';
import { CommandRegistry } from './commands/CommandRegistry';
import { maybeShowWelcome, showWelcome } from './welcome/WelcomePage';
import { YggContentProvider } from './content/YggContentProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('Yggdrasil Diagnostics');
  channel.appendLine('Yggdrasil extension is activating...');
  channel.show(true);
  
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
      treeView.onDidChangeVisibility(({ visible }) => {
        if (visible) { showWelcome(context); }
      }),
      explorerView.onDidChangeVisibility(({ visible }) => {
        if (visible) { showWelcome(context); }
      })
    );

    context.subscriptions.push(treeView, explorerView, welcomeCommand, contentProviderDisposable, ...commands, provider);

    const registeredCommands = await vscode.commands.getCommands(true);
    const yggdrasilCommands = registeredCommands.filter(c => c.startsWith('ygg.'));

    maybeShowWelcome(context);

    // Initial indexing to set the ready state
    try {
      await git.getRepoRoot();
      await git.listWorktrees();
      vscode.commands.executeCommand('setContext', 'yggdrasil.isReady', true);
    } catch (err) {
      // Even on error, we set ready to true so the view can show the error state
      vscode.commands.executeCommand('setContext', 'yggdrasil.isReady', true);
    }

    channel.appendLine('Yggdrasil extension activated successfully');
  } catch (err) {
    channel.appendLine(`Failed to activate Yggdrasil extension: ${err}`);
  }
}

export function deactivate(): void {
  // VS Code disposes all context.subscriptions automatically
}
