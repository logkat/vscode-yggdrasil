import * as fs from 'fs';
import { execFileNoThrow } from '../utils/execFileNoThrow';

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isCurrent: boolean;
  isDirty: boolean;
  pathExists: boolean;
  locked: boolean;
  bare: boolean;
}

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  max: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(max, tasks.length) }, () => worker())
  );
  return results;
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

  constructor(private readonly getWorkspaceRoot: () => string | undefined) {}

  async getRepoRoot(): Promise<string> {
    if (this.repoRootCache) { return this.repoRootCache; }
    const cwd = this.getWorkspaceRoot();
    if (!cwd) { throw new Error('No workspace folder open'); }
    const result = await execFileNoThrow('git', ['rev-parse', '--show-toplevel'], { cwd });
    if (result.status === -1) { throw new Error('git not found on PATH'); }
    if (result.status !== 0) { throw new Error(result.stderr.trim() || 'Not a git repository'); }
    this.repoRootCache = result.stdout.trim();
    return this.repoRootCache;
  }

  async listWorktrees(): Promise<Worktree[]> {
    const repoRoot = await this.getRepoRoot();
    const result = await execFileNoThrow(
      'git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to list worktrees');
    }

    const wsPath = this.getWorkspaceRoot() ?? '';
    let currentRealPath = wsPath;
    try { currentRealPath = fs.realpathSync(wsPath); } catch { /* use raw */ }

    const partial = parsePorcelain(result.stdout, currentRealPath);

    const dirtyTasks = partial.map((wt) => async (): Promise<boolean> => {
      if (!wt.pathExists || wt.bare) { return false; }
      const r = await execFileNoThrow('git', ['status', '--short'], { cwd: wt.path });
      return r.status === 0 && r.stdout.trim().length > 0;
    });

    const dirtyResults = await withConcurrency(dirtyTasks, 4);
    return partial.map((wt, i) => ({ ...wt, isDirty: dirtyResults[i] }));
  }

  async addWorktree(wtPath: string, branch: string, isNew: boolean): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const args = isNew
      ? ['worktree', 'add', '-b', branch, wtPath]
      : ['worktree', 'add', wtPath, branch];
    const result = await execFileNoThrow('git', args, { cwd: repoRoot });
    if (result.status !== 0) { throw new Error(result.stderr.trim()); }
  }

  async removeWorktree(wtPath: string): Promise<void> {
    const repoRoot = await this.getRepoRoot();
    const result = await execFileNoThrow(
      'git', ['worktree', 'remove', wtPath], { cwd: repoRoot }
    );
    if (result.status !== 0) { throw new Error(result.stderr.trim()); }
  }

  invalidateCache(): void {
    this.repoRootCache = undefined;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
