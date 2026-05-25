import * as path from 'path';
import * as vscode from 'vscode';
import { GitService, Worktree, FileStatus } from '../git/GitService';

export type WorktreeContextValue =
  | 'worktreeItem'
  | 'worktreeItemCurrent'
  | 'worktreeItemMissing';

export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: Worktree,
    private readonly repoRoot: string
  ) {
    super(
      worktree.branch,
      (worktree.pathExists && !worktree.bare)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    this.description = path.relative(repoRoot, worktree.path) || '.';
    this.contextValue = WorktreeItem.contextValueFor(worktree);
    this.iconPath = WorktreeItem.iconFor(worktree);
    this.tooltip = this.getRichTooltip();
  }

  private getRichTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`### Worktree: ${this.worktree.branch}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`- **Path:** \`${this.worktree.path}\`\n`);
    md.appendMarkdown(`- **HEAD:** \`${this.worktree.head.slice(0, 7)}\`\n`);
    
    if (this.worktree.isCurrent) {
      md.appendMarkdown(`- **Status:** $(check) Current active worktree\n`);
    }
    if (this.worktree.locked) {
      md.appendMarkdown(`- **Status:** $(lock) Locked\n`);
    }
    if (this.worktree.isDirty) {
      md.appendMarkdown(`- **Status:** $(source-control) Has uncommitted working tree changes\n`);
    }
    
    return md;
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

export class WorktreeFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileStatus,
    public readonly worktreePath: string,
    public readonly branch: string,
    public readonly baseSha: string,
  ) {
    super(file.relativePath, vscode.TreeItemCollapsibleState.None);
    this.description = file.status;
    this.contextValue = 'worktreeFile';
    this.iconPath = WorktreeFileItem.iconFor(file.status);
    this.tooltip = this.getRichTooltip();
    this.command = {
      command: 'ygg.openDiff',
      title: 'Open Diff',
      arguments: [this],
    };
  }

  private getRichTooltip(): vscode.MarkdownString {
    const statusMap: Record<string, string> = {
      'M': 'Modified',
      'A': 'Added',
      'D': 'Deleted',
      'R': 'Renamed',
      'C': 'Copied',
      'U': 'Unmerged (Conflict)',
      'T': 'Type Changed',
      '?': 'Untracked'
    };
    const statusName = statusMap[this.file.status] || 'Changed';
    
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${statusName}\n\n`);
    md.appendMarkdown(`\`${this.file.relativePath}\`\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`Comparing **${this.branch}** version against branch base (\`${this.baseSha.slice(0, 7)}\`).`);
    return md;
  }

  private static iconFor(status: FileStatus['status']): vscode.ThemeIcon {
    switch (status) {
      case 'M': return new vscode.ThemeIcon('edit');
      case 'A': case '?': return new vscode.ThemeIcon('add');
      case 'D': return new vscode.ThemeIcon('trash');
      case 'R': return new vscode.ThemeIcon('arrow-right');
      case 'C': return new vscode.ThemeIcon('copy');
      case 'U': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground'));
      case 'T': return new vscode.ThemeIcon('file-submodule');
      default: {
        const _exhaustive: never = status;
        return new vscode.ThemeIcon('file');
      }
    }
  }
}

export class WorktreeProvider implements vscode.TreeDataProvider<WorktreeItem | WorktreeFileItem | vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WorktreeItem | WorktreeFileItem | vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private watchers: vscode.FileSystemWatcher[] = [];
  private lastError: string | undefined;

  constructor(private readonly git: GitService) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorktreeItem | WorktreeFileItem | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WorktreeItem | WorktreeFileItem | vscode.TreeItem): Promise<(WorktreeItem | WorktreeFileItem | vscode.TreeItem)[]> {
    // Leaf nodes have no children
    if (element instanceof WorktreeFileItem) { return []; }

    // Expanding a worktree item → show branch changes (committed + staged + working tree)
    if (element instanceof WorktreeItem) {
      try {
        const { files, baseSha, baseRef } = await this.git.getWorktreeBranchChanges(element.worktree.path);
        if (files.length === 0) {
          const item = new vscode.TreeItem('No changes on branch', vscode.TreeItemCollapsibleState.None);
          item.description = `relative to ${baseRef}`;
          item.tooltip = new vscode.MarkdownString(`This branch is up-to-date with **${baseRef}** (at \`${baseSha.slice(0, 7)}\`).`);
          item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
          return [item];
        }
        return files.map(f => new WorktreeFileItem(f, element.worktree.path, element.worktree.branch, baseSha));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const errorItem = new vscode.TreeItem(`Error: ${msg}`, vscode.TreeItemCollapsibleState.None);
        errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
        errorItem.tooltip = new vscode.MarkdownString(`**Git Error:**\n\n${msg}`);
        return [errorItem];
      }
    }

    // Root — existing logic
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
