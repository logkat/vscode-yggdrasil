import * as fs from 'fs';
import * as path from 'path';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { TaskQueue } from '../utils/TaskQueue';

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isCurrent: boolean;
  isDirty: boolean;
  pathExists: boolean;
  locked: boolean;
  bare: boolean;
  dotGit?: string;
  baseRef?: string;
  aheadCount?: number;
}

export interface FileStatus {
  relativePath: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | 'T' | '?';
  isUntracked: boolean;
}

function dequotePath(raw: string): string {
  if (!raw.startsWith('"')) { return raw; }
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  let result = '';
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (/[0-7]/.test(next) && i + 3 < inner.length) {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
        i += 4;
        continue;
      }
      if (bytes.length > 0) {
        result += Buffer.from(bytes).toString('utf8');
        bytes.length = 0;
      }
      if (next === 'n')  { result += '\n'; i += 2; }
      else if (next === 't')  { result += '\t'; i += 2; }
      else if (next === '"')  { result += '"';  i += 2; }
      else if (next === '\\') { result += '\\'; i += 2; }
      else { result += inner[i]; i++; }
    } else {
      if (bytes.length > 0) {
        result += Buffer.from(bytes).toString('utf8');
        bytes.length = 0;
      }
      result += inner[i];
      i++;
    }
  }
  if (bytes.length > 0) { result += Buffer.from(bytes).toString('utf8'); }
  return result;
}

export function parseStatusLine(line: string): FileStatus | null {
  if (line.length < 4) { return null; }
  const x = line[0];
  const y = line[1];
  const rawStatus = (x !== ' ' ? x : y) as FileStatus['status'];
  if (!['M', 'A', 'D', 'R', 'C', 'U', 'T', '?'].includes(rawStatus)) { return null; }

  let rest = line.slice(3);

  // Renamed/copied: extract new path after last ' -> '
  if ((rawStatus === 'R' || rawStatus === 'C') && rest.includes(' -> ')) {
    rest = rest.slice(rest.lastIndexOf(' -> ') + 4);
  }

  return {
    relativePath: dequotePath(rest),
    status: rawStatus,
    isUntracked: rawStatus === '?',
  };
}

export function parseDiffNameStatus(output: string): FileStatus[] {
  if (!output.trim()) { return []; }
  return output.trim().split('\n').flatMap((line): FileStatus[] => {
    const parts = line.split('\t');
    if (parts.length < 2) { return []; }
    const letter = parts[0][0] as FileStatus['status'];
    if (!(['M', 'A', 'D', 'R', 'C', 'U', 'T'] as string[]).includes(letter)) { return []; }
    const rawPath = (letter === 'R' || letter === 'C') && parts.length >= 3
      ? parts[2]
      : parts[1];
    const dequoted = dequotePath(rawPath);
    // Normalise path separators to forward slashes for internal consistency
    const normalizedPath = dequoted.split(path.win32.sep).join('/').split(path.posix.sep).join('/');
    return [{ relativePath: normalizedPath, status: letter, isUntracked: false }];
  });
}

export function parsePorcelain(
  output: string,
  currentRealPath: string
): Omit<Worktree, 'isDirty'>[] {
  const blocks = output.trim().split(/\n\n+/);
  const worktrees: Omit<Worktree, 'isDirty'>[] = [];

  for (const block of blocks) {
    if (!block.trim()) { continue; }
    const lines = block.split('\n');
    let wtPath = '';
    let head = '';
    let branch = '';
    let locked = false;
    let bare = false;
    let detached = false;

    for (const line of lines) {
      if (line.startsWith('worktree '))      { wtPath = line.slice('worktree '.length); }
      else if (line.startsWith('HEAD '))     { head = line.slice('HEAD '.length); }
      else if (line.startsWith('branch '))   {
        const ref = line.slice('branch '.length);
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      }
      else if (line === 'detached')          { detached = true; }
      else if (line === 'bare')              { bare = true; }
      else if (line.startsWith('locked'))    { locked = true; }
    }

    if (!wtPath) { continue; }

    // Fallback for branch if not provided by git
    if (!branch && !bare && !detached) {
      branch = path.basename(wtPath) || 'unknown';
    }

    if (bare)           { branch = '(bare)'; }
    else if (detached)  { branch = '(detached HEAD)'; }

    let resolvedWt = wtPath;
    try { resolvedWt = fs.realpathSync(wtPath); } catch { /* use raw path */ }

    worktrees.push({
      path: wtPath,
      branch,
      head,
      isCurrent: resolvedWt === currentRealPath,
      pathExists: fs.existsSync(wtPath),
      locked,
      bare,
    });
  }

  return worktrees;
}

export class GitService {
  private repoRootCache: string | undefined;
  private cachedWorktrees: Worktree[] | undefined;
  private branchChangesCache = new Map<string, { files: FileStatus[]; baseSha: string; baseRef: string }>();
  private readonly queue = new TaskQueue(4);

  constructor(
    public readonly getWorkspaceRoot: () => string | undefined,
    private readonly getBaseBranch: (worktreePath?: string) => string | undefined = () => undefined,
    private readonly runRaw: typeof execFileNoThrow = execFileNoThrow,
  ) {}

  public getCachedRepoRoot(): string | undefined {
    return this.repoRootCache;
  }

  public getCachedWorktrees(): Worktree[] | undefined {
    return this.cachedWorktrees;
  }

  public getCachedBranchChanges(worktreePath: string): { files: FileStatus[]; baseSha: string; baseRef: string } | undefined {
    return this.branchChangesCache.get(worktreePath);
  }

  private async run(cmd: string, args: string[], options?: import('../utils/execFileNoThrow').ExecOptions): Promise<import('../utils/execFileNoThrow').ExecResult> {
    return this.queue.run(() => this.runRaw(cmd, args, options));
  }

  async getRepoRoot(): Promise<string> {
    if (this.repoRootCache) { return this.repoRootCache; }
    const cwd = this.getWorkspaceRoot();
    if (!cwd) { throw new Error('No workspace folder open'); }
    const result = await this.run('git', ['rev-parse', '--show-toplevel'], { cwd });
    if (result.status === -1) { throw new Error('git not found on PATH'); }
    if (result.status !== 0) { throw new Error(result.stderr.trim() || 'Not a git repository'); }
    this.repoRootCache = result.stdout.trim();
    return this.repoRootCache;
  }

  async listWorktrees(): Promise<Worktree[]> {
    const repoRoot = await this.getRepoRoot();
    const result = await this.run(
      'git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to list worktrees');
    }

    const wsPath = this.getWorkspaceRoot() ?? '';
    let currentRealPath = wsPath;
    try { currentRealPath = fs.realpathSync(wsPath); } catch { /* use raw */ }

    const partial = parsePorcelain(result.stdout, currentRealPath);

    const self = this;
    const enrichTasks = partial.map((wt) => async (): Promise<{ isDirty: boolean; aheadCount?: number; dotGit?: string }> => {
      if (!wt.pathExists || wt.bare) { return { isDirty: false }; }

      // Resolve base branch for this specific worktree
      const baseRef = await self.resolveBaseRef(wt.path);

      const [statusRes, revParseRes, aheadRes] = await Promise.all([
        self.run('git', ['status', '--short'], { cwd: wt.path }),
        self.run('git', ['rev-parse', '--git-dir'], { cwd: wt.path }),
        self.run('git', ['rev-list', '--count', `${baseRef}..HEAD`], { cwd: wt.path })
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
    });

    const enrichResults = await Promise.all(enrichTasks.map(t => t()));
    const freshWorktrees = partial.map((wt, i) => ({
      ...wt,
      isDirty: enrichResults[i].isDirty,
      aheadCount: enrichResults[i].aheadCount,
      dotGit: enrichResults[i].dotGit
    }));

    this.cachedWorktrees = freshWorktrees;
    return freshWorktrees;
  }

  async addWorktree(wtPath: string, branch: string, isNew: boolean): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const args = isNew
      ? ['worktree', 'add', '-b', branch, wtPath]
      : ['worktree', 'add', wtPath, branch];
    const result = await this.run('git', args, { cwd: repoRoot });
    if (result.status !== 0) { throw new Error(result.stderr.trim()); }
  }

  async removeWorktree(wtPath: string): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const result = await this.run(
      'git', ['worktree', 'remove', wtPath], { cwd: repoRoot }
    );
    if (result.status !== 0) { throw new Error(result.stderr.trim()); }
  }

  async pruneWorktrees(): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const result = await this.run(
      'git', ['worktree', 'prune'], { cwd: repoRoot }
    );
    if (result.status !== 0) { throw new Error(result.stderr.trim()); }
  }

  async getWorktreeStatus(worktreePath: string): Promise<FileStatus[]> {
    try {
      const result = await this.run('git', ['status', '--porcelain'], { cwd: worktreePath });
      if (result.status !== 0) { return []; }
      return result.stdout
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => parseStatusLine(line))
        .filter((item): item is FileStatus => item !== null);
    } catch {
      return [];
    }
  }

  private async resolveBaseRef(worktreePath: string): Promise<string> {
    const configured = this.getBaseBranch(worktreePath);
    if (configured) { return configured; }
    const result = await this.run('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: worktreePath });
    if (result.status === 0 && result.stdout.trim()) { return result.stdout.trim(); }
    return 'main';
  }

  async getWorktreeBranchChanges(worktreePath: string): Promise<{ files: FileStatus[]; baseSha: string; baseRef: string }> {
    const baseRef = await this.resolveBaseRef(worktreePath);

    const mergeBaseResult = await this.run('git', ['merge-base', 'HEAD', baseRef], { cwd: worktreePath });
    if (mergeBaseResult.status !== 0) {
      throw new Error(`Cannot find merge base with '${baseRef}': ${mergeBaseResult.stderr.trim()}`);
    }
    const baseSha = mergeBaseResult.stdout.trim();

    const [diffResult, cachedResult, statusResult] = await Promise.all([
      this.run('git', ['diff', '--name-status', baseSha], { cwd: worktreePath }),
      this.run('git', ['diff', '--name-status', '--cached', baseSha], { cwd: worktreePath }),
      this.run('git', ['status', '--porcelain'], { cwd: worktreePath }),
    ]);

    const committed = parseDiffNameStatus(diffResult.status === 0 ? diffResult.stdout : '');
    const staged    = parseDiffNameStatus(cachedResult.status === 0 ? cachedResult.stdout : '');
    const untracked = statusResult.status === 0
      ? statusResult.stdout
          .split('\n')
          .filter(line => line.startsWith('??'))
          .map(line => parseStatusLine(line))
          .filter((f): f is FileStatus => f !== null)
      : [];

    // Strict Merge Strategy: Priority Staged > Committed > Untracked
    const merged = new Map<string, FileStatus>();

    // Lower priority first, so higher priority overwrites
    for (const f of committed) { merged.set(f.relativePath, f); }
    for (const f of staged)    { merged.set(f.relativePath, f); }
    for (const f of untracked) { merged.set(f.relativePath, f); }

    const result = { files: Array.from(merged.values()), baseSha, baseRef };
    this.branchChangesCache.set(worktreePath, result);
    return result;
  }

  invalidateCache(): void {
    this.repoRootCache = undefined;
    // We keep cachedWorktrees to allow SWR (Stale-While-Revalidate) rendering in the provider.
    // The provider will return this stale cache instantly and then trigger a background refresh.
  }
}
