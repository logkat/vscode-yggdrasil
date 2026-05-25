import * as vscode from 'vscode';
import { GitService } from '../git/GitService';
import { WorktreeItem, WorktreeFileItem, WorktreeProvider } from '../tree/WorktreeProvider';
import { makeUri } from '../content/YggContentProvider';

type SwitchMode = 'newWindow' | 'replace' | 'addWorkspace';
const STATE_KEY = 'ygg.switchMode';

export class CommandRegistry {
  private statusBarItem: vscode.StatusBarItem | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitService,
    private readonly provider: WorktreeProvider,
  ) {}

  register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    this.restoreStatusBar();

    disposables.push(vscode.commands.registerCommand('ygg.refresh', () => {
      this.git.invalidateCache();
      this.provider.refresh();
    }));

    disposables.push(vscode.commands.registerCommand('ygg.switch', (item?: WorktreeItem) =>
      this.switchWorktree(item)
    ));

    disposables.push(vscode.commands.registerCommand('ygg.selectAndSwitch', () =>
      this.selectAndSwitch()
    ));

    disposables.push(vscode.commands.registerCommand('ygg.clearSwitchMode', () =>
      this.clearSwitchMode()
    ));

    disposables.push(vscode.commands.registerCommand('ygg.add', () => this.addWorktree()));

    disposables.push(vscode.commands.registerCommand('ygg.remove', (item?: WorktreeItem) =>
      this.removeWorktree(item)
    ));

    disposables.push(vscode.commands.registerCommand('ygg.copyPath', (item?: WorktreeItem) => {
      if (!item) { return; }
      vscode.env.clipboard.writeText(item.worktree.path);
    }));

    disposables.push(vscode.commands.registerCommand('ygg.revealInOs', (item?: WorktreeItem) => {
      if (!item) { return; }
      vscode.commands.executeCommand(
        'revealFileInOS',
        vscode.Uri.file(item.worktree.path)
      );
    }));

    disposables.push(vscode.commands.registerCommand(
      'ygg.openDiff',
      (item?: WorktreeFileItem) => this.openDiff(item)
    ));

    return disposables;
  }

  private async switchWorktree(item?: WorktreeItem): Promise<void> {
    if (!item) { return; }
    const stored = this.context.globalState.get<SwitchMode>(STATE_KEY);
    let mode: SwitchMode;
    if (stored) {
      mode = stored;
    } else {
      const result = await this.promptSwitchMode(item.worktree.branch, item.worktree.path);
      if (!result) { return; }
      mode = result.mode;
      if (result.remember) {
        await this.context.globalState.update(STATE_KEY, mode);
        this.showStatusBar(mode);
      }
    }
    await this.openWorktree(item.worktree.path, mode);
  }

  private async selectAndSwitch(): Promise<void> {
    const all = await this.git.listWorktrees();
    const candidates = all.filter(wt => !wt.isCurrent && wt.pathExists);
    if (candidates.length === 0) {
      vscode.window.showInformationMessage('No other worktrees to switch to.');
      return;
    }
    const picks = candidates.map(wt => ({ label: wt.branch, description: wt.path, wt }));
    const picked = await vscode.window.showQuickPick(picks, { placeHolder: 'Select worktree to switch to' });
    if (!picked) { return; }

    const result = await this.promptSwitchMode(picked.wt.branch, picked.wt.path);
    if (!result) { return; }
    if (result.remember) {
      await this.context.globalState.update(STATE_KEY, result.mode);
      this.showStatusBar(result.mode);
    }
    await this.openWorktree(picked.wt.path, result.mode);
  }

  private async openWorktree(wtPath: string, mode: SwitchMode): Promise<void> {
    const uri = vscode.Uri.file(wtPath);
    try {
      switch (mode) {
        case 'newWindow':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
          break;
        case 'replace':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
          break;
        case 'addWorkspace':
          vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length ?? 0,
            0,
            { uri }
          );
          break;
      }
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to open worktree: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async promptSwitchMode(
    branch: string,
    wtPath: string,
  ): Promise<{ mode: SwitchMode; remember: boolean } | undefined> {
    interface ModeItem extends vscode.QuickPickItem { mode: SwitchMode; remember: boolean; }

    const once: ModeItem[] = [
      { label: '$(window)       New Window',       description: 'Open in a new VS Code window',    mode: 'newWindow',    remember: false },
      { label: '$(replace-all)  Replace Window',   description: 'Reuse this VS Code window',        mode: 'replace',      remember: false },
      { label: '$(add)          Add to Workspace', description: 'Add folder to current workspace', mode: 'addWorkspace', remember: false },
    ];
    const remembered: ModeItem[] = [
      { label: '$(window)       New Window',       description: 'Open in new window and save as default',     mode: 'newWindow',    remember: true },
      { label: '$(replace-all)  Replace Window',   description: 'Replace window and save as default',          mode: 'replace',      remember: true },
      { label: '$(add)          Add to Workspace', description: 'Add to workspace and save as default',       mode: 'addWorkspace', remember: true },
    ];

    const allItems: (ModeItem | vscode.QuickPickItem)[] = [
      ...once,
      { label: 'Save as default', kind: vscode.QuickPickItemKind.Separator },
      ...remembered,
    ];

    const picked = await vscode.window.showQuickPick(allItems, {
      title: `Open worktree: ${branch}`,
      placeHolder: wtPath,
    });

    if (!picked || !('mode' in picked)) { return undefined; }
    return { mode: picked.mode, remember: picked.remember };
  }

  private async addWorktree(): Promise<void> {
    const kind = await vscode.window.showQuickPick(
      ['Existing branch', 'New branch'],
      { placeHolder: 'Choose branch type' }
    );
    if (!kind) { return; }

    const isNew = kind === 'New branch';
    const branch = await vscode.window.showInputBox({ prompt: 'Branch name' });
    if (!branch) { return; }

    const safeBranch = branch.replace(/\//g, '-');
    const locations = [
      { label: 'Parent directory', detail: `../${safeBranch}`, value: `../${safeBranch}` },
      { label: 'Nested (.worktrees)', detail: `.worktrees/${safeBranch}`, value: `.worktrees/${safeBranch}` },
      { label: 'Agent (.agent/worktrees)', detail: `.agent/worktrees/${safeBranch}`, value: `.agent/worktrees/${safeBranch}` },
      { label: 'Custom...', detail: 'Enter a custom path', value: 'custom' }
    ];

    const pickedLocation = await vscode.window.showQuickPick(locations, { placeHolder: 'Where to create the worktree?' });
    if (!pickedLocation) { return; }

    let wtPath: string | undefined;
    if (pickedLocation.value === 'custom') {
      wtPath = await vscode.window.showInputBox({
        prompt: 'Worktree path',
        value: `../${safeBranch}`,
      });
    } else {
      wtPath = pickedLocation.value;
    }
    
    if (!wtPath) { return; }

    try {
      await this.git.addWorktree(wtPath, branch, isNew);
      this.provider.refresh();
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Add worktree failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async removeWorktree(item?: WorktreeItem): Promise<void> {
    if (!item) { return; }
    const answer = await vscode.window.showWarningMessage(
      `Remove worktree '${item.worktree.branch}'?`,
      { modal: true },
      'Remove'
    );
    if (answer !== 'Remove') { return; }

    try {
      await this.git.removeWorktree(item.worktree.path);
      this.provider.refresh();
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Remove worktree failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private restoreStatusBar(): void {
    const stored = this.context.globalState.get<SwitchMode>(STATE_KEY);
    if (stored) { this.showStatusBar(stored); }
  }

  private showStatusBar(mode: SwitchMode): void {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
      );
    }
    const labels: Record<SwitchMode, string> = {
      newWindow: 'New Window',
      replace: 'Replace Window',
      addWorkspace: 'Add to Workspace',
    };
    this.statusBarItem.text = `$(git-branch) Worktree: ${labels[mode]} ×`;
    this.statusBarItem.tooltip = 'Click to clear remembered worktree switch mode';
    this.statusBarItem.command = 'ygg.clearSwitchMode';
    this.statusBarItem.show();
  }

  private async openDiff(item?: WorktreeFileItem): Promise<void> {
    if (!item) { return; }
    const { file, worktreePath, branch, baseSha } = item;
    const baseUri = makeUri('BASE', worktreePath, file.relativePath, baseSha);
    const workUri = makeUri('WORK', worktreePath, file.relativePath);
    const title   = `${branch} — ${file.relativePath} (branch base ↔ working tree)`;
    
    try {
      await vscode.commands.executeCommand('vscode.diff', baseUri, workUri, title, { preview: true });
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to open diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async clearSwitchMode(): Promise<void> {
    const had = this.context.globalState.get<SwitchMode>(STATE_KEY);
    await this.context.globalState.update(STATE_KEY, undefined);
    this.statusBarItem?.hide();
    this.statusBarItem?.dispose();
    this.statusBarItem = undefined;
    if (!had) {
      vscode.window.showInformationMessage('No remembered switch mode to clear.');
    }
  }
}
