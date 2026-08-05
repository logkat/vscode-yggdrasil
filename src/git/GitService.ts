import * as fs from 'fs';
import * as path from 'path';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { TaskQueue } from '../utils/TaskQueue';
import {
  FileStatus,
  Worktree,
  parsePorcelain,
  parseStatusLine,
  parseDiffNameStatus,
} from './parsers';

// Re-exports preserve the existing public surface for tests and external callers.
export { dequotePath, parseStatusLine, parseDiffNameStatus, parsePorcelain } from './parsers';
export type { FileStatus, Worktree } from './parsers';

export class GitService {
  private repoRootCache: string | undefined;
  private workspaceRealPathCache: { raw: string; resolved: string } | undefined;
  private cachedWorktrees: Worktree[] | undefined;
  private branchChangesCache = new Map<
    string,
    { files: FileStatus[]; baseSha: string; baseRef: string }
  >();
  private readonly queue = new TaskQueue(4);

  constructor(
    public readonly getWorkspaceRoot: () => string | undefined,
    private readonly getBaseBranch: (worktreePath?: string) => string | undefined = () => undefined,
    private readonly runRaw: typeof execFileNoThrow = execFileNoThrow
  ) {}

  public getCachedRepoRoot(): string | undefined {
    return this.repoRootCache;
  }

  public getCachedWorktrees(): Worktree[] | undefined {
    return this.cachedWorktrees;
  }

  public getCachedBranchChanges(
    worktreePath: string
  ): { files: FileStatus[]; baseSha: string; baseRef: string } | undefined {
    return this.branchChangesCache.get(worktreePath);
  }

  private async run(
    cmd: string,
    args: string[],
    options?: import('../utils/execFileNoThrow').ExecOptions
  ): Promise<import('../utils/execFileNoThrow').ExecResult> {
    return this.queue.run(() => this.runRaw(cmd, args, options));
  }

  async getRepoRoot(): Promise<string> {
    if (this.repoRootCache) {
      return this.repoRootCache;
    }
    const cwd = this.getWorkspaceRoot();
    if (!cwd) {
      throw new Error('No workspace folder open');
    }
    const result = await this.run('git', ['rev-parse', '--show-toplevel'], { cwd });
    if (result.status === -1) {
      throw new Error('git not found on PATH');
    }
    if (result.status === 0) {
      this.repoRootCache = result.stdout.trim();
      return this.repoRootCache;
    }

    // `--show-toplevel` fails inside a bare repository ("fatal: this operation
    // must be run in a work tree"), which is the common `bare .git + .worktrees/`
    // layout this extension exists to serve. There is no work tree to report, but
    // `git worktree list` and ref lookups work fine with cwd here, so use it.
    const isBare = await this.run('git', ['rev-parse', '--is-bare-repository'], { cwd });
    if (isBare.status === 0 && isBare.stdout.trim() === 'true') {
      this.repoRootCache = cwd;
      return this.repoRootCache;
    }

    throw new Error(result.stderr.trim() || 'Not a git repository');
  }

  private resolveWorkspaceRealPath(): string {
    const raw = this.getWorkspaceRoot() ?? '';
    const cached = this.workspaceRealPathCache;
    if (cached && cached.raw === raw) {
      return cached.resolved;
    }
    let resolved = raw;
    try {
      resolved = fs.realpathSync(raw);
    } catch {
      /* use raw */
    }
    this.workspaceRealPathCache = { raw, resolved };
    return resolved;
  }

  async listWorktrees(): Promise<Worktree[]> {
    const repoRoot = await this.getRepoRoot();
    const result = await this.run('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to list worktrees');
    }

    const currentRealPath = this.resolveWorkspaceRealPath();
    const partial = parsePorcelain(result.stdout, currentRealPath);

    const enrichTasks = partial.map(
      (wt) => async (): Promise<{ isDirty: boolean; aheadCount?: number; dotGit?: string }> => {
        if (!wt.pathExists || wt.bare) {
          return { isDirty: false };
        }

        // Resolve base branch for this specific worktree
        const baseRef = await this.resolveBaseRef(wt.path);

        const [statusRes, revParseRes, aheadRes] = await Promise.all([
          this.run('git', ['status', '--short'], { cwd: wt.path }),
          this.run('git', ['rev-parse', '--git-dir'], { cwd: wt.path }),
          this.run('git', ['rev-list', '--count', `${baseRef}..HEAD`], { cwd: wt.path }),
        ]);

        const isDirty = statusRes.status === 0 && statusRes.stdout.trim().length > 0;
        let aheadCount: number | undefined;
        if (aheadRes.status === 0) {
          aheadCount = parseInt(aheadRes.stdout.trim(), 10);
        }

        let dotGit: string | undefined;
        if (revParseRes.status === 0) {
          dotGit = revParseRes.stdout.trim();
          if (!path.isAbsolute(dotGit)) {
            dotGit = path.resolve(wt.path, dotGit);
          }
        }
        return { isDirty, aheadCount, dotGit };
      }
    );

    const enrichResults = await Promise.all(enrichTasks.map((t) => t()));
    const freshWorktrees = partial.map((wt, i) => ({
      ...wt,
      isDirty: enrichResults[i].isDirty,
      aheadCount: enrichResults[i].aheadCount,
      dotGit: enrichResults[i].dotGit,
    }));

    // Add virtual default branch if not already present in worktree list
    const defaultBranch = await this.getDefaultBranch();
    const hasDefault = freshWorktrees.some((wt) => wt.branch === defaultBranch);
    if (!hasDefault) {
      const headRes = await this.run('git', ['rev-parse', defaultBranch], { cwd: repoRoot });
      if (headRes.status === 0) {
        freshWorktrees.push({
          path: `VIRTUAL:${defaultBranch}`,
          branch: defaultBranch,
          head: headRes.stdout.trim(),
          isCurrent: false,
          isMain: false,
          isDirty: false,
          pathExists: false, // Virtual items don't have a path
          locked: false,
          bare: false,
          isVirtual: true,
          aheadCount: undefined,
          dotGit: undefined,
        });
      }
    }

    this.pruneBranchChangesCache(freshWorktrees);
    this.cachedWorktrees = freshWorktrees;
    return freshWorktrees;
  }

  /**
   * Local branch names, most recently committed first — the order a "pick a base
   * branch" list wants, since the branch you just worked on is the likely answer.
   * Returns [] rather than throwing: a picker with no suggestions is still usable
   * because it falls back to free text.
   */
  public async listBranches(): Promise<string[]> {
    const repoRoot = await this.getRepoRoot();
    const res = await this.run(
      'git',
      ['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads'],
      { cwd: repoRoot }
    );
    if (res.status !== 0) {
      return [];
    }
    return res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  public async getDefaultBranch(): Promise<string> {
    const repoRoot = await this.getRepoRoot();

    // 1. Try configured base branch
    const configured = this.getBaseBranch();
    if (configured) {
      return configured;
    }

    // 2. Try origin/HEAD
    const res = await this.run('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], {
      cwd: repoRoot,
    });
    if (res.status === 0) {
      const branch = res.stdout.trim();
      return branch.startsWith('origin/') ? branch.slice('origin/'.length) : branch;
    }

    // 3. Fallback to common defaults
    const mainExists = await this.run('git', ['rev-parse', '--verify', 'main'], { cwd: repoRoot });
    if (mainExists.status === 0) {
      return 'main';
    }
    return 'master';
  }

  async addWorktree(wtPath: string, branch: string, isNew: boolean): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const args = isNew
      ? ['worktree', 'add', '-b', branch, wtPath]
      : ['worktree', 'add', wtPath, branch];
    const result = await this.run('git', args, { cwd: repoRoot });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim());
    }
  }

  async removeWorktree(wtPath: string): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const result = await this.run('git', ['worktree', 'remove', wtPath], { cwd: repoRoot });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim());
    }
    this.branchChangesCache.delete(wtPath);
  }

  async pruneWorktrees(): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const result = await this.run('git', ['worktree', 'prune'], { cwd: repoRoot });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim());
    }
  }

  async getWorktreeStatus(worktreePath: string): Promise<FileStatus[]> {
    try {
      const result = await this.run('git', ['status', '--porcelain'], { cwd: worktreePath });
      if (result.status !== 0) {
        return [];
      }
      return result.stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => parseStatusLine(line))
        .filter((item): item is FileStatus => item !== null);
    } catch {
      return [];
    }
  }

  private async resolveBaseRef(worktreePath: string): Promise<string> {
    const configured = this.getBaseBranch(worktreePath);
    if (configured) {
      return configured;
    }
    const result = await this.run('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
      cwd: worktreePath,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    return 'main';
  }

  async getWorktreeBranchChanges(
    worktreePath: string
  ): Promise<{ files: FileStatus[]; baseSha: string; baseRef: string }> {
    const baseRef = await this.resolveBaseRef(worktreePath);

    const mergeBaseResult = await this.run('git', ['merge-base', 'HEAD', baseRef], {
      cwd: worktreePath,
    });
    if (mergeBaseResult.status !== 0) {
      throw new Error(`Cannot find merge base with '${baseRef}': ${mergeBaseResult.stderr.trim()}`);
    }
    const baseSha = mergeBaseResult.stdout.trim();

    const [diffResult, cachedResult, statusResult] = await Promise.all([
      this.run('git', ['diff', '--name-status', baseSha], { cwd: worktreePath }),
      this.run('git', ['diff', '--name-status', '--cached', baseSha], { cwd: worktreePath }),
      // `--untracked-files=all` matters: the default collapses a wholly
      // untracked directory to a single `?? src/` entry, which the tree builder
      // then split into a folder plus a phantom leaf named after the folder
      // (`src` containing `src`). Listing untracked files individually gives the
      // tree real leaves to nest.
      this.run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: worktreePath }),
    ]);

    const committed = parseDiffNameStatus(diffResult.status === 0 ? diffResult.stdout : '');
    const staged = parseDiffNameStatus(cachedResult.status === 0 ? cachedResult.stdout : '');
    const untracked =
      statusResult.status === 0
        ? statusResult.stdout
            .split('\n')
            .filter((line) => line.startsWith('??'))
            .map((line) => parseStatusLine(line))
            .filter((f): f is FileStatus => f !== null)
        : [];

    // Strict Merge Strategy: Priority Staged > Committed > Untracked
    const merged = new Map<string, FileStatus>();

    // Lower priority first, so higher priority overwrites
    for (const f of committed) {
      merged.set(f.relativePath, f);
    }
    for (const f of staged) {
      merged.set(f.relativePath, f);
    }
    for (const f of untracked) {
      merged.set(f.relativePath, f);
    }

    const result = { files: Array.from(merged.values()), baseSha, baseRef };
    this.branchChangesCache.set(worktreePath, result);
    return result;
  }

  private pruneBranchChangesCache(fresh: Worktree[]): void {
    const live = new Set(fresh.map((wt) => wt.path));
    for (const key of this.branchChangesCache.keys()) {
      if (!live.has(key)) {
        this.branchChangesCache.delete(key);
      }
    }
  }

  invalidateCache(): void {
    this.repoRootCache = undefined;
    this.workspaceRealPathCache = undefined;
    // We keep cachedWorktrees to allow SWR (Stale-While-Revalidate) rendering in the provider.
    // The provider will return this stale cache instantly and then trigger a background refresh.
  }
}
