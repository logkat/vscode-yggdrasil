import * as path from 'path';
import * as vscode from 'vscode';
import { GitService } from '../git/GitService';
import { FileStatus, Worktree } from '../git/parsers';
import { WorktreeDecorationProvider } from './WorktreeDecorationProvider';
import { sortWorktrees } from './sort';
import { WorktreeItem, WorktreeFolderItem, WorktreeFileItem } from './items';
import { AgentSessionService } from '../agents/AgentSessionService';
import { AgentSession } from '../agents/IAgentProvider';
import { AgentSessionsItem, AgentSessionItem } from './AgentSessionsItem';

// Re-exports preserve the existing public surface for tests and external callers.
export { WorktreeItem, WorktreeFolderItem, WorktreeFileItem } from './items';
export type { WorktreeContextValue } from './items';

type TreeNode =
  | WorktreeItem
  | WorktreeFolderItem
  | WorktreeFileItem
  | AgentSessionsItem
  | AgentSessionItem
  | vscode.TreeItem;
type CachedBranchChanges = { files: FileStatus[]; baseSha: string; baseRef: string };

function worktreeFieldsEqual(a: Worktree, b: Worktree): boolean {
  return (
    a.path === b.path &&
    a.branch === b.branch &&
    a.head === b.head &&
    a.isCurrent === b.isCurrent &&
    a.isMain === b.isMain &&
    a.isDirty === b.isDirty &&
    a.pathExists === b.pathExists &&
    a.locked === b.locked &&
    a.bare === b.bare &&
    a.aheadCount === b.aheadCount &&
    (a.isVirtual ?? false) === (b.isVirtual ?? false)
  );
}

function worktreeListsEqual(a: Worktree[] | undefined, b: Worktree[]): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!worktreeFieldsEqual(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

function sessionsRenderEqual(a: AgentSession[], b: AgentSession[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].sessionId !== b[i].sessionId ||
      a[i].status !== b[i].status ||
      a[i].isArchived !== b[i].isArchived ||
      a[i].name !== b[i].name
    ) {
      return false;
    }
  }
  return true;
}

function fileStatusesEqual(a: FileStatus[], b: FileStatus[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].relativePath !== b[i].relativePath ||
      a[i].status !== b[i].status ||
      a[i].isUntracked !== b[i].isUntracked
    ) {
      return false;
    }
  }
  return true;
}

export class WorktreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | null | void
  >();
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
  private rootCache: TreeNode[] | undefined;
  private agentSessionCache = new Map<string, AgentSession[]>();

  constructor(
    private readonly git: GitService,
    private readonly decorationProvider?: WorktreeDecorationProvider,
    private readonly agentService?: AgentSessionService
  ) {}

  public refresh(): void {
    // Only clear the structural caches, keep the object instances in instanceCache
    this.treeCache.clear();
    this.rootCache = undefined;
    this.agentSessionCache.clear();
    this._onDidChangeTreeData.fire();
    this.decorationProvider?.refresh();
  }

  private async triggerBackgroundRefresh(): Promise<void> {
    if (this.isRefreshing) {
      return;
    }
    this.isRefreshing = true;

    try {
      const oldWorktrees = this.git.getCachedWorktrees();
      const fresh = await this.git.listWorktrees();

      let sessionsChanged = false;
      if (this.agentService) {
        await Promise.all(
          fresh.map((wt) =>
            this.agentService!.getSessionsForWorktree(wt.path)
              .then((s) => {
                const prev = this.agentSessionCache.get(wt.path);
                if (!sessionsChanged && !sessionsRenderEqual(prev ?? [], s)) {
                  sessionsChanged = true;
                }
                this.agentSessionCache.set(wt.path, s);
              })
              .catch(() => {
                this.agentSessionCache.set(wt.path, []);
              })
          )
        );
      }

      const changed = !worktreeListsEqual(oldWorktrees, fresh) || sessionsChanged;

      if (changed) {
        this.pruneInstanceCacheForWorktrees(fresh);
        this.rootCache = undefined; // Invalidate memoized root nodes
        this._onDidChangeTreeData.fire();
        this.decorationProvider?.refresh();
      }
    } catch (err) {
      console.log('Background refresh failed:', err);
    } finally {
      this.isRefreshing = false;
    }
  }

  private async triggerNodeBackgroundRefresh(element: WorktreeItem): Promise<void> {
    const key = `refresh:${element.worktree.path}`;
    if (this.refreshingNodes.has(key)) {
      return;
    }
    this.refreshingNodes.add(key);

    try {
      const oldChanges = this.git.getCachedBranchChanges(element.worktree.path);
      const fresh = await this.git.getWorktreeBranchChanges(element.worktree.path);
      const changed = !oldChanges || !fileStatusesEqual(oldChanges.files, fresh.files);

      if (changed) {
        this.treeCache.delete(element.worktree.path); // Invalidate memoized tree for this node
        this._onDidChangeTreeData.fire(element);
      }
    } catch (err) {
      console.log(`Node background refresh failed for ${element.worktree.branch}:`, err);
    } finally {
      this.refreshingNodes.delete(key);
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] | Thenable<TreeNode[]> {
    // Leaf nodes have no children
    if (element instanceof AgentSessionItem) {
      return [];
    }
    if (element instanceof AgentSessionsItem) {
      return element.sessions.map((s) => new AgentSessionItem(s));
    }
    if (element instanceof WorktreeFileItem) {
      return [];
    }

    // Expanding a folder item → return its pre-built children
    if (element instanceof WorktreeFolderItem) {
      return element.children;
    }

    // Expanding a worktree item
    if (element instanceof WorktreeItem) {
      return this.getChildrenForWorktree(element);
    }

    // Root node
    return this.getRootChildren();
  }

  private getChildrenForWorktree(element: WorktreeItem): TreeNode[] | Thenable<TreeNode[]> {
    const agentNodes = this.buildAgentNodes(element.worktree.path);

    const cached = this.git.getCachedBranchChanges(element.worktree.path);
    if (cached) {
      this.triggerNodeBackgroundRefresh(element);

      const memoized = this.treeCache.get(element.worktree.path);
      if (memoized) {
        return [...agentNodes, ...memoized];
      }

      const result = this.renderBranchChanges(
        cached,
        element.worktree.path,
        element.worktree.branch
      );
      this.treeCache.set(
        element.worktree.path,
        result as (WorktreeFolderItem | WorktreeFileItem)[]
      );
      return [...agentNodes, ...result];
    }

    return this.git
      .getWorktreeBranchChanges(element.worktree.path)
      .then((fresh) => {
        const result = this.renderBranchChanges(
          fresh,
          element.worktree.path,
          element.worktree.branch
        );
        this.treeCache.set(
          element.worktree.path,
          result as (WorktreeFolderItem | WorktreeFileItem)[]
        );
        return [...agentNodes, ...result];
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        const errorItem = new vscode.TreeItem(
          `Error: ${msg}`,
          vscode.TreeItemCollapsibleState.None
        );
        errorItem.iconPath = new vscode.ThemeIcon(
          'error',
          new vscode.ThemeColor('list.errorForeground')
        );
        errorItem.tooltip = new vscode.MarkdownString(`**Git Error:**\n\n${msg}`);
        return [...agentNodes, errorItem];
      });
  }

  private buildAgentNodes(worktreePath: string): TreeNode[] {
    const sessions = this.agentSessionCache.get(worktreePath) ?? [];
    const showWhenEmpty = vscode.workspace
      .getConfiguration('ygg')
      .get<boolean>('showAgentNodeWhenEmpty', false);
    if (sessions.length === 0 && !showWhenEmpty) {
      return [];
    }
    return [new AgentSessionsItem(sessions)];
  }

  private renderBranchChanges(
    changes: CachedBranchChanges,
    worktreePath: string,
    branch: string
  ): TreeNode[] {
    if (changes.files.length === 0) {
      return [this.cleanItem(changes.baseRef, changes.baseSha)];
    }
    return this.buildFileTree(changes.files, worktreePath, branch, changes.baseSha);
  }

  private getRootChildren(): TreeNode[] | Thenable<TreeNode[]> {
    const cachedWorktrees = this.git.getCachedWorktrees();
    const cachedRepoRoot = this.git.getCachedRepoRoot();

    if (cachedWorktrees && cachedRepoRoot) {
      this.triggerBackgroundRefresh();

      if (this.rootCache) {
        return this.rootCache;
      }

      const sortedWorktrees = sortWorktrees(cachedWorktrees);
      this.rootCache = sortedWorktrees.map((wt) =>
        this.getOrCreateWorktreeItem(wt, cachedRepoRoot)
      );
      return this.rootCache;
    }

    // Async path (cache miss)
    return this.loadRootNodes();
  }

  private async loadRootNodes(): Promise<TreeNode[]> {
    try {
      const repoRoot = await this.git.getRepoRoot();
      const worktrees = await this.git.listWorktrees();
      this.lastError = undefined;

      if (this.agentService) {
        await Promise.all(
          worktrees.map((wt) =>
            this.agentService!.getSessionsForWorktree(wt.path)
              .then((s) => {
                this.agentSessionCache.set(wt.path, s);
              })
              .catch(() => {
                this.agentSessionCache.set(wt.path, []);
              })
          )
        );
      }

      if (this.git.getWorkspaceRoot()) {
        this.setupWatchers(repoRoot, worktrees);
      }

      const sortedWorktrees = sortWorktrees(worktrees);
      this.rootCache = sortedWorktrees.map((wt) => this.getOrCreateWorktreeItem(wt, repoRoot));
      return this.rootCache;
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return [this.errorItem(this.lastError!)];
    }
  }

  private cleanItem(baseRef: string, baseSha: string): vscode.TreeItem {
    const item = new vscode.TreeItem('No changes on branch', vscode.TreeItemCollapsibleState.None);
    item.description = `relative to ${baseRef}`;
    item.tooltip = new vscode.MarkdownString(
      `This branch is up-to-date with **${baseRef}** (at \`${baseSha.slice(0, 7)}\`).`
    );
    item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    return item;
  }

  private makeWorktreeUri(wtPath: string, branch: string): vscode.Uri {
    // Opaque URI format: ygg-worktree:branch:<branch>?path=<path>
    // This is the most stable URI format for decorations during selection.
    return vscode.Uri.parse(
      `ygg-worktree:branch:${encodeURIComponent(branch)}?path=${encodeURIComponent(wtPath)}`
    );
  }

  private getOrCreateWorktreeItem(wt: Worktree, repoRoot: string): WorktreeItem {
    const id = wt.path;
    const existing = this.instanceCache.get(id);
    const newUri = this.makeWorktreeUri(wt.path, wt.branch);

    if (existing instanceof WorktreeItem) {
      existing.updateFrom(wt, repoRoot, newUri);
      const existingSessions = this.agentSessionCache.get(wt.path);
      if (existingSessions !== undefined) {
        existing.updateSessions(existingSessions);
      }
      return existing;
    }
    const item = new WorktreeItem(wt, repoRoot, newUri);
    const newSessions = this.agentSessionCache.get(wt.path);
    if (newSessions !== undefined) {
      item.updateSessions(newSessions);
    }
    this.instanceCache.set(id, item);
    return item;
  }

  private getOrCreateFolderItem(
    name: string,
    folderPath: string,
    wtPath: string,
    branch: string,
    baseSha: string
  ): WorktreeFolderItem {
    const id = path.join(wtPath, folderPath);
    const existing = this.instanceCache.get(id);
    const newUri = this.makeWorktreeUri(path.join(wtPath, folderPath), branch);

    if (existing instanceof WorktreeFolderItem) {
      existing.updateUri(newUri);
      return existing;
    }
    const item = new WorktreeFolderItem(name, folderPath, wtPath, branch, baseSha, [], newUri);
    this.instanceCache.set(id, item);
    return item;
  }

  private getOrCreateFileItem(
    file: FileStatus,
    wtPath: string,
    branch: string,
    baseSha: string
  ): WorktreeFileItem {
    const id = path.join(wtPath, file.relativePath);
    const existing = this.instanceCache.get(id);
    if (existing instanceof WorktreeFileItem) {
      existing.updateFrom(file);
      return existing;
    }
    const uri = this.makeWorktreeUri(path.join(wtPath, file.relativePath), branch);
    const item = new WorktreeFileItem(file, wtPath, branch, baseSha, uri);
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
      const parts = file.relativePath.split(/[/\\]/);
      let currentPath = '';
      let currentChildren = rootNodes;

      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

        let folderItem = folders.get(currentPath);
        if (!folderItem) {
          folderItem = this.getOrCreateFolderItem(
            folderName,
            currentPath,
            worktreePath,
            branch,
            baseSha
          );
          currentChildren.push(folderItem);
          folders.set(currentPath, folderItem);
        }
        currentChildren = folderItem.children;
      }

      currentChildren.push(this.getOrCreateFileItem(file, worktreePath, branch, baseSha));
    }

    // Sort children (folders first, then files)
    const sortNodes = (nodes: (WorktreeFolderItem | WorktreeFileItem)[]): void => {
      nodes.sort((a, b) => {
        const aIsFolder = a instanceof WorktreeFolderItem;
        const bIsFolder = b instanceof WorktreeFolderItem;
        if (aIsFolder && !bIsFolder) {
          return -1;
        }
        if (!aIsFolder && bIsFolder) {
          return 1;
        }
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
      isMain: false,
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

  /**
   * Drop cached item instances for worktrees that no longer exist so the
   * instanceCache cannot grow unboundedly across sessions where worktrees come
   * and go.
   */
  private pruneInstanceCacheForWorktrees(fresh: Worktree[]): void {
    const liveWorktreePaths = new Set(fresh.map((wt) => wt.path));
    for (const key of this.instanceCache.keys()) {
      const item = this.instanceCache.get(key);
      if (item instanceof WorktreeItem) {
        if (!liveWorktreePaths.has(item.worktree.path)) {
          this.instanceCache.delete(key);
        }
        continue;
      }
      if (item instanceof WorktreeFolderItem || item instanceof WorktreeFileItem) {
        if (!liveWorktreePaths.has(item.worktreePath)) {
          this.instanceCache.delete(key);
        }
      }
    }
    for (const key of this.agentSessionCache.keys()) {
      if (!liveWorktreePaths.has(key)) {
        this.agentSessionCache.delete(key);
      }
    }
  }

  setupWatchers(repoRoot: string, worktrees: Worktree[]): void {
    this.disposeWatchers();

    let debounceTimer: NodeJS.Timeout | undefined;
    const refresh = (): void => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
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
      if (!wt.pathExists || wt.bare || wt.isCurrent) {
        continue;
      }

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
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
  }
}
