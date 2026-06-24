import * as vscode from 'vscode';
import { GitService } from '../git/GitService';

export type SwitchMode = 'newWindow' | 'replace' | 'addWorkspace';
export const SWITCH_MODE_STATE_KEY = 'ygg.switchMode';

const SWITCH_MODE_LABELS: Record<SwitchMode, string> = {
  newWindow: 'New Window',
  replace: 'Replace Window',
  addWorkspace: 'Add to Workspace',
};

/**
 * Owns the two status-bar items the extension exposes:
 *   - `switchModeItem`: shown only when the user has pinned a default switch mode
 *   - `worktreeItem`: shows the active worktree name and triggers `ygg.selectAndSwitch`
 */
export class StatusBarManager implements vscode.Disposable {
  private switchModeItem: vscode.StatusBarItem | undefined;
  private worktreeItem: vscode.StatusBarItem | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitService
  ) {}

  /**
   * Create the worktree-name status bar item and restore the pinned switch
   * mode indicator (if any). Returns disposables for the registry to track.
   */
  initialize(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    this.worktreeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.worktreeItem.command = 'ygg.selectAndSwitch';
    this.worktreeItem.tooltip = 'Switch Worktree';
    disposables.push(this.worktreeItem);

    const pinned = this.context.globalState.get<SwitchMode>(SWITCH_MODE_STATE_KEY);
    if (pinned) {
      this.showSwitchMode(pinned);
      if (this.switchModeItem) {
        disposables.push(this.switchModeItem);
      }
    }

    return disposables;
  }

  showSwitchMode(mode: SwitchMode): void {
    if (!this.switchModeItem) {
      this.switchModeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    }
    this.switchModeItem.text = `$(git-branch) Worktree: ${SWITCH_MODE_LABELS[mode]} ×`;
    this.switchModeItem.tooltip = 'Click to clear remembered worktree switch mode';
    this.switchModeItem.command = 'ygg.clearSwitchMode';
    this.switchModeItem.show();
  }

  clearSwitchMode(): void {
    this.switchModeItem?.hide();
    this.switchModeItem?.dispose();
    this.switchModeItem = undefined;
  }

  async refreshWorktreeName(): Promise<void> {
    if (!this.worktreeItem) {
      return;
    }
    try {
      const worktrees = this.git.getCachedWorktrees() ?? (await this.git.listWorktrees());
      const current = worktrees.find((wt) => wt.isCurrent);
      if (current) {
        this.worktreeItem.text = `$(file-submodule) ${current.branch}`;
        this.worktreeItem.show();
      } else {
        this.worktreeItem.hide();
      }
    } catch {
      this.worktreeItem.hide();
    }
  }

  dispose(): void {
    this.switchModeItem?.dispose();
    this.worktreeItem?.dispose();
  }
}

/**
 * Replace characters that are illegal in git refs or in path components on
 * Windows. Operates conservatively — better to map something safe than to let
 * `git worktree add` fail with a cryptic message later.
 */
export function sanitizeBranchForPath(branch: string): string {
  // Replace any character that isn't safe in a Windows path component, plus
  // forward-slash so nested branch names produce a single directory entry.
  return branch.replace(/[\\/:*?"<>|~^\s]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
}
