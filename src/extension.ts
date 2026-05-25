import * as vscode from 'vscode';
import { GitService } from './git/GitService';
import { WorktreeProvider } from './tree/WorktreeProvider';
import { CommandRegistry } from './commands/CommandRegistry';
import { maybeShowWelcome, showWelcome } from './welcome/WelcomePage';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('Yggdrasil Diagnostics');
  channel.appendLine('Yggdrasil extension is activating...');
  channel.show(true);
  
  console.log('Yggdrasil extension is activating...');
  try {
    const git = new GitService(
      () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    );

    const provider = new WorktreeProvider(git);

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

    const welcomeCommand = vscode.commands.registerCommand('ygg.welcome', () => showWelcome(context));

    context.subscriptions.push(treeView, explorerView, welcomeCommand, ...commands, provider);

    const registeredCommands = await vscode.commands.getCommands(true);
    const yggdrasilCommands = registeredCommands.filter(c => c.startsWith('ygg.'));
    console.log('Registered Yggdrasil commands:', yggdrasilCommands);

    maybeShowWelcome(context);
    console.log('Yggdrasil extension activated successfully');
    channel.appendLine('Yggdrasil extension activated successfully');
  } catch (err) {
    console.error('Failed to activate Yggdrasil extension:', err);
    channel.appendLine(`Failed to activate Yggdrasil extension: ${err}`);
  }
}

export function deactivate(): void {
  // VS Code disposes all context.subscriptions automatically
}
