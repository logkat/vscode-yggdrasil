import * as path from 'path';
import * as vscode from 'vscode';
import { GitService, Worktree, FileStatus } from '../git/GitService';
import { WorktreeDecorationProvider } from './WorktreeDecorationProvider';

export type WorktreeContextValue =
  | 'worktreeItem'
  | 'worktreeItemCurrent'
  | 'worktreeItemMissing';

export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: Worktree,
    private readonly repoRoot: string,
    public readonly resourceUri: vscode.Uri
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
    this.id = worktree.path;
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
    if (this.worktree.aheadCount && this.worktree.aheadCount > 0) {
      md.appendMarkdown(`- **Status:** $(git-commit) Ahead of base by **${this.worktree.aheadCount}** commit${this.worktree.aheadCount === 1 ? '' : 's'}\n`);
    }
    
    return md;
  }

  private static contextValueFor(wt: Worktree): WorktreeContextValue {
    if (!wt.pathExists) { return 'worktreeItemMissing'; }
    if (wt.isCurrent)   { return 'worktreeItemCurrent'; }
    return 'worktreeItem';
  }

  public static iconFor(wt: Worktree): vscode.ThemeIcon {
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
    public readonly resourceUri: vscode.Uri
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'worktreeFolder';
    this.id = path.join(worktreePath, folderPath);
    this.tooltip = `Folder: ${folderPath}`;
  }
}

export class WorktreeFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileStatus,
    public readonly worktreePath: string,
    public readonly branch: string,
    public readonly baseSha: string,
  ) {
    super(path.basename(file.relativePath), vscode.TreeItemCollapsibleState.None);
    this.description = file.status;
    this.contextValue = 'worktreeFile';
    this.id = path.join(worktreePath, file.relativePath);
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

export class WorktreeProvider implements vscode.TreeDataProvider<WorktreeItem | WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WorktreeItem | WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private watchers: vscode.FileSystemWatcher[] = [];
  private lastError: string | undefined;
  private isRefreshing = false;
  private refreshingNodes = new Set<string>();

  // Persistent instance cache to ensure reference equality across refreshes.
  // Returning the exact same object instance is the ultimate flicker fix.
  private instanceCache = new Map<string, WorktreeItem | WorktreeFolderItem | WorktreeFileItem>();

  // Memoization caches for tree structure
  private treeCache = new Map<string, (WorktreeFolderItem | WorktreeFileItem)[]>();
  private rootCache: (WorktreeItem | vscode.TreeItem)[] | undefined;

  constructor(
    private readonly git: GitService,
    private readonly decorationProvider?: WorktreeDecorationProvider
  ) {}

  public refresh(): void {
    // Only clear the structural caches, keep the object instances in instanceCache
    this.treeCache.clear();
    this.rootCache = undefined;
    this._onDidChangeTreeData.fire();
    this.decorationProvider?.refresh();
  }

  private async triggerBackgroundRefresh(): Promise<void> {
    if (this.isRefreshing) { return; }
    this.isRefreshing = true;

    try {
      const oldWorktrees = this.git.getCachedWorktrees();
      const fresh = await this.git.listWorktrees();
      
      // Deep equality check for root nodes
      const changed = !oldWorktrees || JSON.stringify(oldWorktrees) !== JSON.stringify(fresh);

      if (changed) {
        this.rootCache = undefined; // Invalidate memoized root nodes
        this._onDidChangeTreeData.fire();
        this.decorationProvider?.refresh();
      }
    } catch (err) {
      console.error('Background refresh failed:', err);
    } finally {
      this.isRefreshing = false;
    }
  }

  private async triggerNodeBackgroundRefresh(element: WorktreeItem): Promise<void> {
    const key = `refresh:${element.worktree.path}`;
    if (this.refreshingNodes.has(key)) { return; }
    this.refreshingNodes.add(key);

    try {
      const oldChanges = this.git.getCachedBranchChanges(element.worktree.path);
      const fresh = await this.git.getWorktreeBranchChanges(element.worktree.path);
      
      // Deep equality check for expanded worktree nodes
      const changed = !oldChanges || JSON.stringify(oldChanges.files) !== JSON.stringify(fresh.files);

      if (changed) {
        this.treeCache.delete(element.worktree.path); // Invalidate memoized tree for this node
        this._onDidChangeTreeData.fire(element);
      }
    } catch (err) {
      console.error(`Node background refresh failed for ${element.worktree.branch}:`, err);
    } finally {
      this.refreshingNodes.delete(key);
    }
  }

  getTreeItem(element: WorktreeItem | WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorktreeItem | WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem): (WorktreeItem | WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem)[] | Thenable<(WorktreeItem | WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem)[]> {
    // Leaf nodes have no children
    if (element instanceof WorktreeFileItem) { return []; }

    // Expanding a folder item → return its pre-built children
    if (element instanceof WorktreeFolderItem) {
      return element.children;
    }

    // Expanding a worktree item
    if (element instanceof WorktreeItem) {
      const cached = this.git.getCachedBranchChanges(element.worktree.path);
      if (cached) {
        this.triggerNodeBackgroundRefresh(element);
        
        // Reuse memoized tree if available
        const memoized = this.treeCache.get(element.worktree.path);
        if (memoized) { return memoized; }

        let result: (WorktreeFolderItem | WorktreeFileItem | vscode.TreeItem)[];
        if (cached.files.length === 0) {
          result = [this.cleanItem(cached.baseRef, cached.baseSha)];
        } else {
          result = this.buildFileTree(cached.files, element.worktree.path, element.worktree.branch, cached.baseSha);
        }
        
        this.treeCache.set(element.worktree.path, result as (WorktreeFolderItem | WorktreeFileItem)[]);
        return result as (WorktreeFolderItem | WorktreeFileItem)[];
      }
      
      // Async path (cache miss)
      return this.git.getWorktreeBranchChanges(element.worktree.path).then(({ files, baseSha, baseRef }) => {
        const result = files.length === 0
          ? [this.cleanItem(baseRef, baseSha)]
          : this.buildFileTree(files, element.worktree.path, element.worktree.branch, baseSha);
        
        this.treeCache.set(element.worktree.path, result as (WorktreeFolderItem | WorktreeFileItem)[]);
        return result as (WorktreeFolderItem | WorktreeFileItem)[];
      }).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        const errorItem = new vscode.TreeItem(`Error: ${msg}`, vscode.TreeItemCollapsibleState.None);
        errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
        errorItem.tooltip = new vscode.MarkdownString(`**Git Error:**\n\n${msg}`);
        return [errorItem];
      });
    }

    // Root node
    const cachedWorktrees = this.git.getCachedWorktrees();
    const cachedRepoRoot = this.git.getCachedRepoRoot();

    if (cachedWorktrees && cachedRepoRoot) {
      this.triggerBackgroundRefresh();
      
      if (this.rootCache) { return this.rootCache; }

      this.rootCache = cachedWorktrees.map((wt) => {
        return this.getOrCreateWorktreeItem(wt, cachedRepoRoot);
      });
      return this.rootCache;
    }

    // Async path (cache miss)
    return this.loadRootNodes();
  }

  private async loadRootNodes(): Promise<(WorktreeItem | vscode.TreeItem)[]> {
    try {
      const repoRoot = await this.git.getRepoRoot();
      const worktrees = await this.git.listWorktrees();
      this.lastError = undefined;
if (this.git.getWorkspaceRoot()) {
  this.setupWatchers(repoRoot, worktrees);
}

this.rootCache = worktrees.map((wt) => {
  return this.getOrCreateWorktreeItem(wt, repoRoot);
});
return this.rootCache;
} catch (err: unknown) {

      this.lastError = err instanceof Error ? err.message : String(err);
      return [this.errorItem(this.lastError!)];
    }
  }

  private cleanItem(baseRef: string, baseSha: string): vscode.TreeItem {
    const item = new vscode.TreeItem('No changes on branch', vscode.TreeItemCollapsibleState.None);
    item.description = `relative to ${baseRef}`;
    item.tooltip = new vscode.MarkdownString(`This branch is up-to-date with **${baseRef}** (at \`${baseSha.slice(0, 7)}\`).`);
    item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    return item;
  }

  private makeWorktreeUri(wtPath: string, branch: string): vscode.Uri {
    // Opaque URI format: ygg-worktree:branch:<branch>?path=<path>
    // This is the most stable URI format for decorations during selection.
    return vscode.Uri.parse(`ygg-worktree:branch:${encodeURIComponent(branch)}?path=${encodeURIComponent(wtPath)}`);
  }

  private getOrCreateWorktreeItem(wt: Worktree, repoRoot: string): WorktreeItem {
    const id = wt.path;
    let item = this.instanceCache.get(id) as WorktreeItem;
    const newUri = this.makeWorktreeUri(wt.path, wt.branch);

    if (item && item instanceof WorktreeItem) {
      // Update mutable properties
      (item as any).worktree = wt;
      item.label = wt.locked ? `${wt.branch} (locked)` : wt.branch;
      item.description = path.relative(repoRoot, wt.path) || '.';
      item.iconPath = WorktreeItem.iconFor(wt);
      item.tooltip = (item as any).getRichTooltip();
      
      // CRITICAL FIX: Only update resourceUri if the CONTENT has changed string-wise.
      // Changing the URI object reference even with same values can break decorations.
      if (!item.resourceUri || item.resourceUri.toString() !== newUri.toString()) {
        (item as any).resourceUri = newUri;
      }
      return item;
    }
    item = new WorktreeItem(wt, repoRoot, newUri);
    this.instanceCache.set(id, item);
    return item;
  }

  private getOrCreateFolderItem(name: string, folderPath: string, wtPath: string, branch: string, baseSha: string): WorktreeFolderItem {
    const id = path.join(wtPath, folderPath);
    let item = this.instanceCache.get(id) as WorktreeFolderItem;
    const newUri = this.makeWorktreeUri(path.join(wtPath, folderPath), branch);

    if (item && item instanceof WorktreeFolderItem) {
      item.children = []; // Clear for reconstruction
      if (!item.resourceUri || item.resourceUri.toString() !== newUri.toString()) {
        (item as any).resourceUri = newUri;
      }
      return item;
    }
    item = new WorktreeFolderItem(name, folderPath, wtPath, branch, baseSha, [], newUri);
    this.instanceCache.set(id, item);
    return item;
  }

  private getOrCreateFileItem(file: FileStatus, wtPath: string, branch: string, baseSha: string): WorktreeFileItem {
    const id = path.join(wtPath, file.relativePath);
    let item = this.instanceCache.get(id) as WorktreeFileItem;
    if (item && item instanceof WorktreeFileItem) {
      (item as any).description = file.status;
      item.iconPath = WorktreeFileItem.iconFor(file.status);
      item.tooltip = (item as any).getRichTooltip();
      return item;
    }
    item = new WorktreeFileItem(file, wtPath, branch, baseSha);
    this.instanceCache.set(id, item);
    return item;
  }

  private buildFileTree(
    files: FileStatus[],
    worktreePath: string,
    branch: string,
    baseSha: string
  ): (WorktreeFolderItem | WorktreeFileItem)[] {
    const rootNodes: (WorktreeFolderItem | WorktreeFileItem)[] = [];
    const folders = new Map<string, WorktreeFolderItem>();

    // Sort files by path to ensure consistent processing
    const sortedFiles = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const file of sortedFiles) {
      const parts = file.relativePath.split(/[\\\/]/);
      let currentPath = '';
      let currentChildren = rootNodes;

      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        
        let folderItem = folders.get(currentPath);
        if (!folderItem) {
          folderItem = this.getOrCreateFolderItem(folderName, currentPath, worktreePath, branch, baseSha);
          currentChildren.push(folderItem);
          folders.set(currentPath, folderItem);
        }
        currentChildren = folderItem.children;
      }

      currentChildren.push(this.getOrCreateFileItem(file, worktreePath, branch, baseSha));
    }

    // Sort children (folders first, then files)
    const sortNodes = (nodes: (WorktreeFolderItem | WorktreeFileItem)[]) => {
      nodes.sort((a, b) => {
        const aIsFolder = a instanceof WorktreeFolderItem;
        const bIsFolder = b instanceof WorktreeFolderItem;
        if (aIsFolder && !bIsFolder) { return -1; }
        if (!aIsFolder && bIsFolder) { return 1; }
        return a.label!.toString().localeCompare(b.label!.toString());
      });
      for (const node of nodes) {
        if (node instanceof WorktreeFolderItem) {
          sortNodes(node.children);
        }
      }
    };
    sortNodes(rootNodes);

    return rootNodes;
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
    const item = new WorktreeItem(dummy, '', vscode.Uri.parse('ygg-worktree:error'));
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

    let debounceTimer: NodeJS.Timeout | undefined;
    const refresh = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(() => {
        this.git.invalidateCache();
        this.triggerBackgroundRefresh();
      }, 500); // 500ms debounce for Git bursts
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
