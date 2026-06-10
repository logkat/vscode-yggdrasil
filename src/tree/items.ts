import * as path from 'path';
import * as vscode from 'vscode';
import { Worktree, FileStatus } from '../git/parsers';
import { AgentSession } from '../agents/IAgentProvider';

export type WorktreeContextValue =
  | 'worktreeItem'
  | 'worktreeItemCurrent'
  | 'worktreeItemMissing'
  | 'worktreeItemVirtual';

export class WorktreeItem extends vscode.TreeItem {
  public worktree: Worktree;
  private agentSessions: AgentSession[] = [];

  public updateSessions(sessions: AgentSession[]): void {
    this.agentSessions = sessions;
    this.tooltip = WorktreeItem.buildTooltip(this.worktree, sessions);
  }

  constructor(
    worktree: Worktree,
    private repoRoot: string,
    resourceUri: vscode.Uri,
  ) {
    super(
      worktree.branch,
      (worktree.pathExists && !worktree.bare && !worktree.isVirtual)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    this.worktree = worktree;
    this.resourceUri = resourceUri;
    this.description = worktree.isVirtual ? '(not checked out)' : (path.relative(repoRoot, worktree.path) || '.');
    this.contextValue = WorktreeItem.contextValueFor(worktree);
    this.iconPath = WorktreeItem.iconFor(worktree);
    this.tooltip = WorktreeItem.buildTooltip(worktree);
    this.id = worktree.path;
  }

  /**
   * Update mutable display state from a fresh Worktree snapshot.
   * Does not change `id`/`resourceUri` ownership semantics; resourceUri is set
   * separately so we can preserve reference equality when the URI string is unchanged.
   */
  public updateFrom(worktree: Worktree, repoRoot: string, newUri: vscode.Uri): void {
    this.worktree = worktree;
    this.repoRoot = repoRoot;
    this.label = worktree.locked ? `${worktree.branch} (locked)` : worktree.branch;
    this.description = path.relative(repoRoot, worktree.path) || '.';
    this.iconPath = WorktreeItem.iconFor(worktree);
    this.tooltip = WorktreeItem.buildTooltip(worktree);
    if (!this.resourceUri || this.resourceUri.toString() !== newUri.toString()) {
      this.resourceUri = newUri;
    }
  }

  private static buildTooltip(worktree: Worktree, sessions: AgentSession[] = []): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (worktree.isVirtual) {
      md.appendMarkdown(`### Virtual Branch: ${worktree.branch}\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`This branch exists in the repository but is **not checked out** in any worktree.\n\n`);
      md.appendMarkdown(`Use the switch command to create a new worktree for this branch.\n`);
      return md;
    }

    md.appendMarkdown(`### Worktree: ${worktree.branch}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`- **Path:** \`${worktree.path}\`\n`);
    md.appendMarkdown(`- **HEAD:** \`${worktree.head.slice(0, 7)}\`\n`);

    if (worktree.isCurrent) {
      md.appendMarkdown(`- **Status:** $(check) Current active worktree\n`);
    }
    if (worktree.locked) {
      md.appendMarkdown(`- **Status:** $(lock) Locked\n`);
    }
    if (worktree.isDirty) {
      md.appendMarkdown(`- **Status:** $(source-control) Has uncommitted working tree changes\n`);
    }
    if (worktree.aheadCount && worktree.aheadCount > 0) {
      md.appendMarkdown(`- **Status:** $(git-commit) Ahead of base by **${worktree.aheadCount}** commit${worktree.aheadCount === 1 ? '' : 's'}\n`);
    }

    if (sessions.length > 0) {
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`**Agent Sessions (${sessions.length}):**\n\n`);
      for (const s of sessions) {
        const idShort = s.sessionId.slice(0, 8);
        const namePart = s.name ? ` — "${s.name}"` : '';
        const statusPart = s.status ? ` *(${s.status})*` : (s.isArchived ? ' *(archived)*' : '');
        md.appendMarkdown(`- **${s.agentLabel}:** \`${idShort}\`${namePart}${statusPart}\n`);
      }
    }

    return md;
  }

  private static contextValueFor(wt: Worktree): WorktreeContextValue {
    if (wt.isVirtual)   { return 'worktreeItemVirtual'; }
    if (!wt.pathExists) { return 'worktreeItemMissing'; }
    if (wt.isCurrent)   { return 'worktreeItemCurrent'; }
    return 'worktreeItem';
  }

  public static iconFor(wt: Worktree): vscode.ThemeIcon {
    if (wt.isVirtual) {
      return new vscode.ThemeIcon('repo', new vscode.ThemeColor('disabledForeground'));
    }
    if (!wt.pathExists) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground'));
    }
    if (wt.bare) {
      return new vscode.ThemeIcon('archive');
    }
    if (wt.isCurrent) {
      return new vscode.ThemeIcon('check');
    }
    if (wt.isDirty) {
      return new vscode.ThemeIcon('source-control');
    }
    if (wt.aheadCount && wt.aheadCount > 0) {
      return new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('charts.blue'));
    }
    return new vscode.ThemeIcon('git-branch');
  }
}

export class WorktreeFolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string, // relative to worktree root
    public readonly worktreePath: string,
    public readonly branch: string,
    public readonly baseSha: string,
    public children: (WorktreeFolderItem | WorktreeFileItem)[],
    resourceUri: vscode.Uri,
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.resourceUri = resourceUri;
    this.contextValue = 'worktreeFolder';
    this.id = path.join(worktreePath, folderPath);
    this.tooltip = `Folder: ${folderPath}`;
  }

  public updateUri(newUri: vscode.Uri): void {
    this.children = [];
    if (!this.resourceUri || this.resourceUri.toString() !== newUri.toString()) {
      this.resourceUri = newUri;
    }
  }
}

export class WorktreeFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileStatus,
    public readonly worktreePath: string,
    public readonly branch: string,
    public readonly baseSha: string,
    resourceUri: vscode.Uri,
  ) {
    super(path.basename(file.relativePath), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = resourceUri;
    this.description = file.status;
    this.contextValue = 'worktreeFile';
    this.id = path.join(worktreePath, file.relativePath);
    this.iconPath = WorktreeFileItem.iconFor(file.status);
    this.tooltip = WorktreeFileItem.buildTooltip(file, branch, baseSha);
    this.command = {
      command: 'ygg.openDiff',
      title: 'Open Diff',
      arguments: [this],
    };
  }

  /**
   * Refresh visual state when the file status changes between refreshes.
   * Keeps the same instance so VS Code preserves selection.
   */
  public updateFrom(file: FileStatus): void {
    this.description = file.status;
    this.iconPath = WorktreeFileItem.iconFor(file.status);
    this.tooltip = WorktreeFileItem.buildTooltip(file, this.branch, this.baseSha);
  }

  private static buildTooltip(file: FileStatus, branch: string, baseSha: string): vscode.MarkdownString {
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
    const statusName = statusMap[file.status] || 'Changed';

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${statusName}\n\n`);
    md.appendMarkdown(`\`${file.relativePath}\`\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`Comparing **${branch}** version against branch base (\`${baseSha.slice(0, 7)}\`).`);
    return md;
  }

  public static iconFor(status: FileStatus['status']): vscode.ThemeIcon {
    switch (status) {
      case 'M': return new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.blue'));
      case 'A': return new vscode.ThemeIcon('add', new vscode.ThemeColor('testing.iconPassed'));
      case '?': return new vscode.ThemeIcon('add'); // Untracked as base color
      case 'D': return new vscode.ThemeIcon('trash', new vscode.ThemeColor('testing.iconFailed'));
      case 'R': return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.blue'));
      case 'C': return new vscode.ThemeIcon('copy', new vscode.ThemeColor('testing.iconPassed'));
      case 'U': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground'));
      case 'T': return new vscode.ThemeIcon('file-submodule', new vscode.ThemeColor('charts.blue'));
      default: {
        const _exhaustive: never = status;
        return new vscode.ThemeIcon('file');
      }
    }
  }
}
