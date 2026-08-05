import * as path from 'path';
import * as vscode from 'vscode';
import { Worktree, FileStatus } from '../git/parsers';
import { AgentSession } from '../agents/IAgentProvider';

export type WorktreeContextValue =
  | 'worktreeItem'
  | 'worktreeItemCurrent'
  | 'worktreeItemMissing'
  | 'worktreeItemVirtual'
  | 'worktreeItemBare';

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
    private colorId?: string
  ) {
    // Every worktree row is collapsible, including missing, bare and
    // not-checked-out ones — they expand to a single line explaining their
    // state. A row without a twistie leaves a hole in the twistie column, and
    // since one level of nesting is only 8px (VS Code's `workbench.tree.indent`,
    // which an extension cannot override), that hole made a top-level worktree
    // read as a child of the worktree above it.
    super(worktree.branch, vscode.TreeItemCollapsibleState.Collapsed);

    this.worktree = worktree;
    this.resourceUri = resourceUri;
    this.label = WorktreeItem.labelFor(worktree);
    this.description = WorktreeItem.descriptionFor(worktree, repoRoot);
    this.contextValue = WorktreeItem.contextValueFor(worktree);
    this.iconPath = WorktreeItem.iconFor(worktree, colorId);
    this.tooltip = WorktreeItem.buildTooltip(worktree);
    this.id = worktree.path;
  }

  /**
   * Update mutable display state from a fresh Worktree snapshot.
   * Does not change `id`/`resourceUri` ownership semantics; resourceUri is set
   * separately so we can preserve reference equality when the URI string is unchanged.
   */
  public updateFrom(
    worktree: Worktree,
    repoRoot: string,
    newUri: vscode.Uri,
    colorId?: string
  ): void {
    this.worktree = worktree;
    this.repoRoot = repoRoot;
    this.colorId = colorId;
    this.label = WorktreeItem.labelFor(worktree);
    this.description = WorktreeItem.descriptionFor(worktree, repoRoot);
    // Must be re-derived: instances are reused across refreshes, so a worktree
    // whose folder is deleted while the view is open would otherwise keep the
    // `worktreeItem` value it was built with and never match the
    // `worktreeItemMissing` menu clauses — offering Switch and Remove, which now
    // fail, while hiding the Prune it tells the user to run.
    this.contextValue = WorktreeItem.contextValueFor(worktree);
    this.iconPath = WorktreeItem.iconFor(worktree, colorId);
    this.tooltip = WorktreeItem.buildTooltip(worktree, this.agentSessions);
    if (!this.resourceUri || this.resourceUri.toString() !== newUri.toString()) {
      this.resourceUri = newUri;
    }
  }

  private static buildTooltip(
    worktree: Worktree,
    sessions: AgentSession[] = []
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    // Without this the `$(check)` / `$(source-control)` / `$(git-commit)` markers
    // below render as literal text in the tooltip instead of as codicons.
    md.supportThemeIcons = true;

    if (worktree.isVirtual) {
      md.appendMarkdown(`### Virtual Branch: ${worktree.branch}\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(
        `This branch exists in the repository but is **not checked out** in any worktree.\n\n`
      );
      md.appendMarkdown(`Use the switch command to create a new worktree for this branch.\n`);
      return md;
    }

    md.appendMarkdown(`### Worktree: ${worktree.branch}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`- **Path:** \`${worktree.path}\`\n`);
    // A bare repository reports no HEAD, which rendered as an empty code span.
    if (worktree.head) {
      md.appendMarkdown(`- **HEAD:** \`${worktree.head.slice(0, 7)}\`\n`);
    }

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
      md.appendMarkdown(
        `- **Status:** $(git-commit) Ahead of base by **${worktree.aheadCount}** commit${worktree.aheadCount === 1 ? '' : 's'}\n`
      );
    }

    if (sessions.length > 0) {
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`**Agent Sessions (${sessions.length}):**\n\n`);
      for (const s of sessions) {
        const idShort = s.sessionId.slice(0, 8);
        const namePart = s.name ? ` — "${s.name}"` : '';
        const statusPart = s.status ? ` *(${s.status})*` : s.isArchived ? ' *(archived)*' : '';
        md.appendMarkdown(`- **${s.agentLabel}:** \`${idShort}\`${namePart}${statusPart}\n`);
      }
    }

    return md;
  }

  /**
   * Label and description are derived in one place so the initial render and
   * every subsequent `updateFrom` agree. They previously diverged: only
   * `updateFrom` appended `(locked)`, and only the constructor knew that a
   * virtual worktree has no real path — so a virtual row's description decayed
   * into `path.relative(repoRoot, 'VIRTUAL:main')` on the first refresh.
   */
  private static labelFor(wt: Worktree): string {
    return wt.locked ? `${wt.branch} (locked)` : wt.branch;
  }

  private static descriptionFor(wt: Worktree, repoRoot: string): string {
    if (wt.isVirtual) {
      return '(not checked out)';
    }
    if (!wt.pathExists) {
      return 'missing';
    }
    return path.relative(repoRoot, wt.path) || '.';
  }

  private static contextValueFor(wt: Worktree): WorktreeContextValue {
    if (wt.isVirtual) {
      return 'worktreeItemVirtual';
    }
    if (!wt.pathExists) {
      return 'worktreeItemMissing';
    }
    // A bare repository has no working tree, so "switch to it", "remove it" and
    // "set its base branch" are all meaningless. Its own context value keeps it
    // out of those menus while the `/^worktreeItem/` ones (copy path, reveal)
    // still apply.
    if (wt.bare) {
      return 'worktreeItemBare';
    }
    if (wt.isCurrent) {
      return 'worktreeItemCurrent';
    }
    return 'worktreeItem';
  }

  /**
   * The glyph answers "what is this row", not "what state is it in". State
   * (dirty / ahead) rides along as a decoration badge from
   * WorktreeDecorationProvider, so the current worktree can keep its check mark
   * without that check hiding the fact that it also has uncommitted work — which
   * is exactly what the old precedence chain did.
   *
   * `colorId` is the worktree's assigned colour when `ygg.worktreeColors` is on.
   * It goes on the icon rather than only on the label because VS Code's
   * `list.activeSelectionForeground` repaints the label of the focused row,
   * which made a selected worktree lose its colour. Icon colour survives that.
   */
  public static iconFor(wt: Worktree, colorId?: string): vscode.ThemeIcon {
    if (wt.isVirtual) {
      return new vscode.ThemeIcon('repo', new vscode.ThemeColor('disabledForeground'));
    }
    // A broken worktree is a problem before it is an identity — the error
    // colour outranks the assigned colour here.
    if (!wt.pathExists) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground'));
    }

    const glyph = WorktreeItem.glyphFor(wt);
    if (colorId) {
      return new vscode.ThemeIcon(glyph, new vscode.ThemeColor(colorId));
    }
    return new vscode.ThemeIcon(glyph, WorktreeItem.stateColorFor(wt));
  }

  private static glyphFor(wt: Worktree): string {
    if (wt.bare) {
      return 'archive';
    }
    if (wt.isCurrent) {
      return 'check';
    }
    if (wt.isDirty) {
      return 'source-control';
    }
    if (wt.aheadCount && wt.aheadCount > 0) {
      return 'git-commit';
    }
    return 'git-branch';
  }

  /** Fallback tint used when per-worktree colours are switched off. */
  private static stateColorFor(wt: Worktree): vscode.ThemeColor | undefined {
    if (wt.bare) {
      return undefined;
    }
    if (wt.isCurrent) {
      return new vscode.ThemeColor('ygg.worktreeColor.current');
    }
    if (wt.isDirty) {
      return new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
    }
    if (wt.aheadCount && wt.aheadCount > 0) {
      return new vscode.ThemeColor('charts.blue');
    }
    return undefined;
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
    _resourceUri: vscode.Uri,
    colorId?: string
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    // No `resourceUri`, which is load-bearing twice over. A *collapsible* item
    // that has one renders as FileKind.FOLDER through the icon theme and ignores
    // `iconPath` entirely — and the default theme has no folder icons, so the
    // row drew nothing at all. Leaving it off puts the row on the codicon path.
    //
    // It also means the row never receives a FileDecoration, so the worktree
    // tint arrives on the icon instead. That keeps the colouring inside this
    // tree and off the Explorer, and it survives row selection as a bonus.
    this.iconPath = new vscode.ThemeIcon(
      'folder',
      colorId ? new vscode.ThemeColor(colorId) : undefined
    );
    this.contextValue = 'worktreeFolder';
    this.id = path.join(worktreePath, folderPath);
    this.tooltip = `Folder: ${folderPath}`;
  }

  /** Clears memoized children and re-tints for the current colour setting. */
  public updateColor(colorId?: string): void {
    this.children = [];
    this.iconPath = new vscode.ThemeIcon(
      'folder',
      colorId ? new vscode.ThemeColor(colorId) : undefined
    );
  }
}

/**
 * Colours come from the `gitDecoration.*` token family rather than `charts.*` /
 * `testing.*`, so a changed file is tinted exactly the way the user's theme
 * already tints it in the SCM view and the Explorer. Shared by the row icon and
 * by the status badge on the right of the row.
 */
export function statusColorId(status: FileStatus['status']): string {
  switch (status) {
    case 'A':
    case 'C':
      return 'gitDecoration.addedResourceForeground';
    case '?':
      return 'gitDecoration.untrackedResourceForeground';
    case 'D':
      return 'gitDecoration.deletedResourceForeground';
    case 'R':
      return 'gitDecoration.renamedResourceForeground';
    case 'U':
      return 'gitDecoration.conflictingResourceForeground';
    case 'M':
    case 'T':
      return 'gitDecoration.modifiedResourceForeground';
    default: {
      // Adding a porcelain code to FileStatus['status'] must fail the build
      // here rather than silently render as "modified".
      const _exhaustive: never = status;
      return 'gitDecoration.modifiedResourceForeground';
    }
  }
}

// Keyed by the full status union so a new porcelain code is a compile error
// rather than a silently generic icon.
const STATUS_GLYPHS: Record<FileStatus['status'], string> = {
  M: 'edit',
  A: 'add',
  '?': 'add',
  D: 'trash',
  R: 'arrow-right',
  C: 'copy',
  U: 'warning',
  T: 'file-symlink-file',
};

export const STATUS_NAMES: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Unmerged (Conflict)',
  T: 'Type Changed',
  '?': 'Untracked',
};

export class WorktreeFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileStatus,
    public readonly worktreePath: string,
    public readonly branch: string,
    public readonly baseSha: string,
    resourceUri: vscode.Uri,
    showDirectory = false
  ) {
    super(path.basename(file.relativePath), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = resourceUri;
    this.description = WorktreeFileItem.descriptionFor(file, showDirectory);
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
  public updateFrom(file: FileStatus, showDirectory = false): void {
    this.description = WorktreeFileItem.descriptionFor(file, showDirectory);
    this.iconPath = WorktreeFileItem.iconFor(file.status);
    this.tooltip = WorktreeFileItem.buildTooltip(file, this.branch, this.baseSha);
  }

  /**
   * Status letter, plus the containing directory in the flat layout.
   *
   * The letter lives here rather than on a FileDecoration badge because VS Code
   * does not honour `FileDecoration.color` for badges in a TreeView — the letter
   * rendered, but always in the default badge colour, which put an uncoloured
   * classifier next to a coloured icon. The colour signal stays on the icon,
   * which is the one element an extension can reliably tint.
   */
  private static descriptionFor(file: FileStatus, showDirectory: boolean): string {
    if (!showDirectory) {
      return file.status;
    }
    const dir = path.dirname(file.relativePath);
    return dir === '.' ? file.status : `${file.status} · ${dir}`;
  }

  private static buildTooltip(
    file: FileStatus,
    branch: string,
    baseSha: string
  ): vscode.MarkdownString {
    const statusName = STATUS_NAMES[file.status] || 'Changed';

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${statusName}\n\n`);
    md.appendMarkdown(`\`${file.relativePath}\`\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(
      `Comparing **${branch}** version against branch base (\`${baseSha.slice(0, 7)}\`).`
    );
    return md;
  }

  public static iconFor(status: FileStatus['status']): vscode.ThemeIcon {
    return new vscode.ThemeIcon(
      STATUS_GLYPHS[status] ?? 'file',
      new vscode.ThemeColor(statusColorId(status))
    );
  }
}
