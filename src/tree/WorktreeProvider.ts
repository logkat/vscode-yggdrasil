import * as path from 'path';
import * as vscode from 'vscode';
import { GitService, Worktree } from '../git/GitService';

export type WorktreeContextValue =
  | 'worktreeItem'
  | 'worktreeItemCurrent'
  | 'worktreeItemMissing';

export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: Worktree,
    private readonly repoRoot: string
  ) {
    super(worktree.branch, vscode.TreeItemCollapsibleState.None);

    this.description = path.relative(repoRoot, worktree.path) || '.';
    this.tooltip = worktree.path;
    this.contextValue = WorktreeItem.contextValueFor(worktree);
    this.iconPath = WorktreeItem.iconFor(worktree);
  }

  private static contextValueFor(wt: Worktree): WorktreeContextValue {
    if (!wt.pathExists) { return 'worktreeItemMissing'; }
    if (wt.isCurrent)   { return 'worktreeItemCurrent'; }
    return 'worktreeItem';
  }

  private static iconFor(wt: Worktree): vscode.ThemeIcon {
    if (!wt.pathExists) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    }
    if (wt.bare) {
      return new vscode.ThemeIcon('archive');
    }
    if (wt.isCurrent) {
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'));
    }
    if (wt.isDirty) {
      return new vscode.ThemeIcon('source-control', new vscode.ThemeColor('list.warningForeground'));
    }
    return new vscode.ThemeIcon('git-branch');
  }
}

export class WorktreeProvider implements vscode.TreeDataProvider<WorktreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WorktreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private watchers: vscode.FileSystemWatcher[] = [];
  private lastError: string | undefined;

  constructor(private readonly git: GitService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorktreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<WorktreeItem[]> {
    let repoRoot: string;
    let worktrees: Worktree[];

    try {
      repoRoot = await this.git.getRepoRoot();
      worktrees = await this.git.listWorktrees();
      this.lastError = undefined;
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return [this.errorItem(this.lastError!)];
    }

    return worktrees.map((wt) => {
      const item = new WorktreeItem(wt, repoRoot);
      if (!wt.pathExists) {
        item.tooltip = 'Path not found — run `git worktree prune`';
      }
      if (wt.locked) {
        item.label = `${wt.branch} (locked)`;
      }
      return item;
    });
  }

  private errorItem(message: string): WorktreeItem {
    const dummy: Worktree = {
      path: '',
      branch: message,
      head: '',
      isCurrent: false,
      isDirty: false,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const item = new WorktreeItem(dummy, '');
    item.contextValue = 'worktreeError';
    item.iconPath = new vscode.ThemeIcon('error');
    item.command = {
      command: 'yggdrasil.refresh',
      title: 'Retry',
    };
    return item;
  }

  setupWatchers(repoRoot: string): vscode.Disposable {
    this.disposeWatchers();

    const base = vscode.Uri.file(repoRoot);

    const worktreesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, '.git/worktrees/**')
    );
    const headWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, '.git/HEAD')
    );

    const refresh = () => {
      this.git.invalidateCache();
      this.refresh();
    };

    worktreesWatcher.onDidCreate(refresh);
    worktreesWatcher.onDidDelete(refresh);
    worktreesWatcher.onDidChange(refresh);
    headWatcher.onDidChange(refresh);

    this.watchers = [worktreesWatcher, headWatcher];

    return {
      dispose: () => this.disposeWatchers(),
    };
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) { w.dispose(); }
    this.watchers = [];
  }
}
