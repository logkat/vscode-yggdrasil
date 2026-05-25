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
    this.command = { command: 'ygg.welcome', title: 'Open Welcome' };
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

  public refresh(): void {
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

    if (this.git.getWorkspaceRoot()) {
      this.setupWatchers(repoRoot, worktrees);
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
      command: 'ygg.refresh',
      title: 'Retry',
    };
    return item;
  }

  setupWatchers(repoRoot: string, worktrees: Worktree[]): void {
    this.disposeWatchers();

    const refresh = () => {
      this.git.invalidateCache();
      this.refresh();
    };

    // 1. Watch main repo metadata
    const base = vscode.Uri.file(repoRoot);
    const worktreesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, '.git/worktrees/**')
    );
    const headWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, '.git/HEAD')
    );

    worktreesWatcher.onDidCreate(refresh);
    worktreesWatcher.onDidDelete(refresh);
    worktreesWatcher.onDidChange(refresh);
    headWatcher.onDidChange(refresh);

    this.watchers.push(worktreesWatcher, headWatcher);

    // 2. Watch individual worktrees for branch switches (HEAD changes)
    for (const wt of worktrees) {
      if (!wt.pathExists || wt.bare || wt.isCurrent) { continue; }

      // If we have the dotGit path (which for worktrees is usually a file pointing to main repo),
      // we watch that and also the HEAD file it points to if possible.
      // But simpler: just watch the HEAD file in the worktree's .git (which is a file)
      const wtGitPath = wt.dotGit || path.join(wt.path, '.git');
      
      // If .git is a file (common for worktrees), watching it might not catch internal HEAD changes.
      // However, for worktrees, .git/HEAD is what changes when switching branches.
      const wtBase = vscode.Uri.file(wt.path);
      const wtHeadWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(wtBase, '.git/HEAD')
      );
      wtHeadWatcher.onDidChange(refresh);
      this.watchers.push(wtHeadWatcher);
    }
  }

  dispose(): void {
    this.disposeWatchers();
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) { w.dispose(); }
    this.watchers = [];
  }
}
