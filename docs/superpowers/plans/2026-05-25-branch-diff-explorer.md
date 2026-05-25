# Branch Diff Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the working-tree-only dirty file list in the worktree tree view with a combined list of all files changed on the branch (committed + staged + uncommitted) vs the branch's base.

**Architecture:** A new `getWorktreeBranchChanges()` method in `GitService` resolves the base ref (config → upstream → "main"), finds the merge base, runs three `git` calls to collect committed/unstaged/staged/untracked files, and returns them with the `baseSha`. `WorktreeFileItem` carries `baseSha`; `YggContentProvider` gains a `BASE` side that runs `git show <sha>:<file>` for the left side of every diff.

**Tech Stack:** TypeScript, VS Code Extension API, `execFileNoThrow` (project-local git wrapper), Mocha/assert (test suite run via `npm run compile && npm test`).

---

## File Map

| File | What changes |
|------|-------------|
| `src/git/GitService.ts` | Constructor gains `getBaseBranch` + `run` params; new `resolveBaseRef`, `getWorktreeBranchChanges`, `parseDiffNameStatus`; all internal `execFileNoThrow(...)` calls replaced with `this.run(...)` |
| `src/tree/WorktreeProvider.ts` | `WorktreeFileItem` gains `baseSha`; `getChildren` calls `getWorktreeBranchChanges` |
| `src/content/YggContentProvider.ts` | `makeUri` overloads; `HEAD` branch replaced with `BASE` |
| `src/commands/CommandRegistry.ts` | `openDiff` uses `baseSha` from item |
| `src/extension.ts` | `GitService` constructor call gains two new callbacks |
| `package.json` | `ygg.baseBranch` configuration key added |
| `src/test/suite/GitService.branchDiff.test.ts` | New — tests for `parseDiffNameStatus`, `resolveBaseRef`, `getWorktreeBranchChanges` |
| `src/test/suite/WorktreeProvider.test.ts` | Update all `WorktreeFileItem` constructor calls; update `getChildren` stubs |
| `src/test/suite/YggContentProvider.test.ts` | Replace `HEAD` tests with `BASE`; add sha assertions |
| `src/test/suite/CommandRegistry.openDiff.test.ts` | Update `makeFileItem`; update URI/title assertions |

---

## Task 1: `parseDiffNameStatus` pure function

**Files:**
- Modify: `src/git/GitService.ts`
- Create: `src/test/suite/GitService.branchDiff.test.ts`

- [ ] **Step 1: Create the test file with failing tests**

Create `src/test/suite/GitService.branchDiff.test.ts`:

```typescript
import * as assert from 'assert';
import { parseDiffNameStatus } from '../../git/GitService';

suite('parseDiffNameStatus', () => {
  test('empty input returns []', () => {
    assert.deepStrictEqual(parseDiffNameStatus(''), []);
    assert.deepStrictEqual(parseDiffNameStatus('   '), []);
  });

  test('M line — modified file', () => {
    const result = parseDiffNameStatus('M\tsrc/foo.ts');
    assert.deepStrictEqual(result, [{ relativePath: 'src/foo.ts', status: 'M', isUntracked: false }]);
  });

  test('A line — added file', () => {
    const result = parseDiffNameStatus('A\tsrc/new.ts');
    assert.deepStrictEqual(result, [{ relativePath: 'src/new.ts', status: 'A', isUntracked: false }]);
  });

  test('D line — deleted file', () => {
    const result = parseDiffNameStatus('D\tsrc/old.ts');
    assert.deepStrictEqual(result, [{ relativePath: 'src/old.ts', status: 'D', isUntracked: false }]);
  });

  test('R100 line — rename uses destination path', () => {
    const result = parseDiffNameStatus('R100\told/path.ts\tnew/path.ts');
    assert.deepStrictEqual(result, [{ relativePath: 'new/path.ts', status: 'R', isUntracked: false }]);
  });

  test('C085 line — copy uses destination path (same rule as rename)', () => {
    const result = parseDiffNameStatus('C085\toriginal.ts\tcopy/path.ts');
    assert.deepStrictEqual(result, [{ relativePath: 'copy/path.ts', status: 'C', isUntracked: false }]);
  });

  test('unknown status code is skipped', () => {
    const result = parseDiffNameStatus('X\tsrc/weird.ts');
    assert.deepStrictEqual(result, []);
  });

  test('multiple lines parsed correctly', () => {
    const input = 'M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts';
    const result = parseDiffNameStatus(input);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].status, 'M');
    assert.strictEqual(result[1].status, 'A');
    assert.strictEqual(result[2].status, 'D');
  });

  test('isUntracked is always false', () => {
    const result = parseDiffNameStatus('M\tsrc/foo.ts');
    assert.strictEqual(result[0].isUntracked, false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run compile && npm test
```

Expected: compile error — `parseDiffNameStatus` is not exported from `GitService`.

- [ ] **Step 3: Add `parseDiffNameStatus` to `GitService.ts`**

Add this exported function after the existing `parseStatusLine` function in `src/git/GitService.ts`:

```typescript
export function parseDiffNameStatus(output: string): FileStatus[] {
  if (!output.trim()) { return []; }
  return output.trim().split('\n').flatMap((line): FileStatus[] => {
    const parts = line.split('\t');
    if (parts.length < 2) { return []; }
    const letter = parts[0][0] as FileStatus['status'];
    if (!(['M', 'A', 'D', 'R', 'C'] as string[]).includes(letter)) { return []; }
    const rawPath = (letter === 'R' || letter === 'C') && parts.length >= 3
      ? parts[2]
      : parts[1];
    return [{ relativePath: rawPath, status: letter, isUntracked: false }];
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run compile && npm test
```

Expected: all `parseDiffNameStatus` suite tests PASS, all pre-existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git/GitService.ts src/test/suite/GitService.branchDiff.test.ts
git commit -m "feat: add parseDiffNameStatus for git diff --name-status output"
```

---

## Task 2: `GitService` constructor + `resolveBaseRef`

**Files:**
- Modify: `src/git/GitService.ts`
- Modify: `src/test/suite/GitService.branchDiff.test.ts`
- Modify: `src/extension.ts`

`GitService` must stay `vscode`-free. The config value and `execFileNoThrow` are injected as constructor callbacks so tests can stub them without mocking modules.

- [ ] **Step 1: Add failing tests for `resolveBaseRef` to `GitService.branchDiff.test.ts`**

Add this suite after the existing `parseDiffNameStatus` suite:

```typescript
import { parseDiffNameStatus, GitService } from '../../git/GitService';

// Helpers used across suites
type RunFn = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ status: number; stdout: string; stderr: string }>;

function makeRun(handler: (args: string[]) => { status: number; stdout: string; stderr: string }): RunFn {
  return async (_cmd, args) => handler(args);
}

suite('GitService.resolveBaseRef', () => {
  test('returns configured base branch immediately without calling git', async () => {
    const gitCalls: string[][] = [];
    const run = makeRun(args => { gitCalls.push(args); return { status: 0, stdout: '', stderr: '' }; });
    const git = new GitService(() => '/repo', () => 'my-base', run);
    const result = await (git as any).resolveBaseRef('/wt');
    assert.strictEqual(result, 'my-base');
    assert.strictEqual(gitCalls.length, 0, 'git should not be called when config is set');
  });

  test('returns upstream ref when configured base is not set and upstream resolves', async () => {
    const run = makeRun(args => {
      if (args.includes('@{upstream}')) { return { status: 0, stdout: 'origin/main\n', stderr: '' }; }
      return { status: 1, stdout: '', stderr: '' };
    });
    const git = new GitService(() => '/repo', () => undefined, run);
    const result = await (git as any).resolveBaseRef('/wt');
    assert.strictEqual(result, 'origin/main');
  });

  test('falls back to "main" when configured base is not set and upstream fails', async () => {
    const run = makeRun(() => ({ status: 128, stdout: '', stderr: 'fatal: no upstream' }));
    const git = new GitService(() => '/repo', () => undefined, run);
    const result = await (git as any).resolveBaseRef('/wt');
    assert.strictEqual(result, 'main');
  });
});
```

Update the import at the top of the file to include `GitService`:
```typescript
import { parseDiffNameStatus, GitService } from '../../git/GitService';
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run compile && npm test
```

Expected: compile errors — `GitService` constructor does not accept 3 arguments.

- [ ] **Step 3: Update `GitService.ts` — constructor, internal `run` usages, `resolveBaseRef`**

Replace the class definition start and all internal `execFileNoThrow(...)` calls. The full updated `GitService` class:

```typescript
export class GitService {
  private repoRootCache: string | undefined;

  constructor(
    public readonly getWorkspaceRoot: () => string | undefined,
    private readonly getBaseBranch: () => string | undefined = () => undefined,
    private readonly run: typeof execFileNoThrow = execFileNoThrow,
  ) {}

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
    const enrichTasks = partial.map((wt) => async (): Promise<{ isDirty: boolean; dotGit?: string }> => {
      if (!wt.pathExists || wt.bare) { return { isDirty: false }; }

      const [statusRes, revParseRes] = await Promise.all([
        self.run('git', ['status', '--short'], { cwd: wt.path }),
        self.run('git', ['rev-parse', '--git-dir'], { cwd: wt.path })
      ]);

      const isDirty = statusRes.status === 0 && statusRes.stdout.trim().length > 0;
      let dotGit: string | undefined;
      if (revParseRes.status === 0) {
        dotGit = revParseRes.stdout.trim();
        if (!path.isAbsolute(dotGit)) {
          dotGit = path.resolve(wt.path, dotGit);
        }
      }
      return { isDirty, dotGit };
    });

    const enrichResults = await withConcurrency(enrichTasks, 4);
    return partial.map((wt, i) => ({
      ...wt,
      isDirty: enrichResults[i].isDirty,
      dotGit: enrichResults[i].dotGit
    }));
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
    const configured = this.getBaseBranch();
    if (configured) { return configured; }
    const result = await this.run('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: worktreePath });
    if (result.status === 0 && result.stdout.trim()) { return result.stdout.trim(); }
    return 'main';
  }

  invalidateCache(): void {
    this.repoRootCache = undefined;
  }
}
```

- [ ] **Step 4: Update `extension.ts` to pass the `getBaseBranch` callback**

Replace the existing `new GitService(...)` call in `src/extension.ts`:

```typescript
const git = new GitService(
  () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  () => vscode.workspace.getConfiguration('ygg').get<string>('baseBranch') || undefined,
);
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm run compile && npm test
```

Expected: all `resolveBaseRef` suite tests PASS, all pre-existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/git/GitService.ts src/test/suite/GitService.branchDiff.test.ts src/extension.ts
git commit -m "feat: inject getBaseBranch+run into GitService, add resolveBaseRef"
```

---

## Task 3: `getWorktreeBranchChanges`

**Files:**
- Modify: `src/git/GitService.ts`
- Modify: `src/test/suite/GitService.branchDiff.test.ts`

- [ ] **Step 1: Add failing tests for `getWorktreeBranchChanges`**

Add this suite to `src/test/suite/GitService.branchDiff.test.ts` after the `resolveBaseRef` suite:

```typescript
suite('GitService.getWorktreeBranchChanges', () => {
  function makeGitWithRun(handler: (args: string[]) => { status: number; stdout: string; stderr: string }) {
    const run = makeRun(handler);
    return new GitService(() => '/repo', () => undefined, run);
  }

  const MERGE_BASE_SHA = 'deadbeef1234567890abcdef1234567890abcdef';

  function defaultHandler(args: string[]): { status: number; stdout: string; stderr: string } {
    if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
      return { status: 1, stdout: '', stderr: 'no upstream' };          // fall back to main
    }
    if (args[0] === 'merge-base') {
      return { status: 0, stdout: MERGE_BASE_SHA + '\n', stderr: '' };
    }
    if (args[0] === 'diff' && args.includes('--cached')) {
      return { status: 0, stdout: 'A\tstaged.ts\n', stderr: '' };       // staged file
    }
    if (args[0] === 'diff') {
      return { status: 0, stdout: 'M\tworking.ts\n', stderr: '' };      // committed + unstaged
    }
    if (args[0] === 'status') {
      return { status: 0, stdout: '?? untracked.ts\n', stderr: '' };    // untracked
    }
    return { status: 0, stdout: '', stderr: '' };
  }

  test('returns baseSha from merge-base output', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { baseSha } = await git.getWorktreeBranchChanges('/wt');
    assert.strictEqual(baseSha, MERGE_BASE_SHA);
  });

  test('includes committed/unstaged file from git diff', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.ok(files.some(f => f.relativePath === 'working.ts' && f.status === 'M'));
  });

  test('includes staged file from git diff --cached', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.ok(files.some(f => f.relativePath === 'staged.ts' && f.status === 'A'));
  });

  test('includes untracked file from git status ??', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.ok(files.some(f => f.relativePath === 'untracked.ts' && f.status === '?'));
  });

  test('deduplicates: file in both diff and --cached appears once', async () => {
    const git = makeGitWithRun(args => {
      if (args[0] === 'rev-parse') { return { status: 1, stdout: '', stderr: '' }; }
      if (args[0] === 'merge-base') { return { status: 0, stdout: MERGE_BASE_SHA + '\n', stderr: '' }; }
      if (args[0] === 'diff' && args.includes('--cached')) { return { status: 0, stdout: 'M\tsame.ts\n', stderr: '' }; }
      if (args[0] === 'diff') { return { status: 0, stdout: 'M\tsame.ts\n', stderr: '' }; }
      if (args[0] === 'status') { return { status: 0, stdout: '', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    });
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.strictEqual(files.filter(f => f.relativePath === 'same.ts').length, 1);
  });

  test('throws when merge-base fails', async () => {
    const git = makeGitWithRun(args => {
      if (args[0] === 'rev-parse') { return { status: 1, stdout: '', stderr: '' }; }
      if (args[0] === 'merge-base') { return { status: 1, stdout: '', stderr: 'no common ancestor' }; }
      return { status: 0, stdout: '', stderr: '' };
    });
    await assert.rejects(
      () => git.getWorktreeBranchChanges('/wt'),
      /no common ancestor/
    );
  });

  test('passes merge-base SHA as arg to both diff calls', async () => {
    const diffArgs: string[][] = [];
    const git = makeGitWithRun(args => {
      if (args[0] === 'rev-parse') { return { status: 1, stdout: '', stderr: '' }; }
      if (args[0] === 'merge-base') { return { status: 0, stdout: MERGE_BASE_SHA + '\n', stderr: '' }; }
      if (args[0] === 'diff') { diffArgs.push([...args]); return { status: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'status') { return { status: 0, stdout: '', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    });
    await git.getWorktreeBranchChanges('/wt');
    assert.strictEqual(diffArgs.length, 2, 'git diff should be called twice');
    assert.ok(diffArgs.every(a => a.includes(MERGE_BASE_SHA)), 'both diff calls must include baseSha');
    assert.ok(diffArgs.some(a => a.includes('--cached')), 'one diff call must include --cached');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run compile && npm test
```

Expected: compile error — `getWorktreeBranchChanges` does not exist on `GitService`.

- [ ] **Step 3: Implement `getWorktreeBranchChanges` in `GitService.ts`**

Add this method inside the `GitService` class, after `resolveBaseRef`:

```typescript
async getWorktreeBranchChanges(worktreePath: string): Promise<{ files: FileStatus[]; baseSha: string }> {
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

  const fromDiff   = parseDiffNameStatus(diffResult.status === 0   ? diffResult.stdout   : '');
  const fromCached = parseDiffNameStatus(cachedResult.status === 0 ? cachedResult.stdout : '');
  const fromStatus = statusResult.status === 0
    ? statusResult.stdout
        .split('\n')
        .filter(line => line.startsWith('??'))
        .map(line => parseStatusLine(line))
        .filter((f): f is FileStatus => f !== null)
    : [];

  const seen = new Set(fromDiff.map(f => f.relativePath));
  for (const f of fromCached) {
    if (!seen.has(f.relativePath)) { seen.add(f.relativePath); fromDiff.push(f); }
  }
  for (const f of fromStatus) {
    if (!seen.has(f.relativePath)) { fromDiff.push(f); }
  }

  return { files: fromDiff, baseSha };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run compile && npm test
```

Expected: all `getWorktreeBranchChanges` suite tests PASS, all pre-existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git/GitService.ts src/test/suite/GitService.branchDiff.test.ts
git commit -m "feat: add getWorktreeBranchChanges to GitService"
```

---

## Task 4: `WorktreeFileItem` gains `baseSha` — fix all callers atomically

Adding a required `baseSha` parameter breaks every existing `WorktreeFileItem` construction. Do all changes in one step so the codebase stays compilable.

**Files:**
- Modify: `src/tree/WorktreeProvider.ts`
- Modify: `src/test/suite/WorktreeProvider.test.ts`
- Modify: `src/test/suite/CommandRegistry.openDiff.test.ts`

- [ ] **Step 1: Update `WorktreeFileItem` constructor in `WorktreeProvider.ts`**

Replace the `WorktreeFileItem` constructor signature (the `constructor(` line and public fields only — leave the body and other methods unchanged):

```typescript
export class WorktreeFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileStatus,
    public readonly worktreePath: string,
    public readonly branch: string,
    public readonly baseSha: string,
  ) {
```

- [ ] **Step 2: Fix `WorktreeProvider.test.ts` — all `WorktreeFileItem` constructor calls**

Every call to `new WorktreeFileItem(...)` in this file needs a `baseSha` argument. Replace the affected lines:

Line 17:
```typescript
const item = new WorktreeFileItem(makeFileStatus({ relativePath: 'src/bar.ts' }), '/repo/wt', 'feature/x', 'abc123');
```

Line 22:
```typescript
const item = new WorktreeFileItem(makeFileStatus({ status: 'M' }), '/repo/wt', 'main', 'abc123');
```

Line 27:
```typescript
const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'abc123');
```

Line 32:
```typescript
const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'abc123');
```

Line 37:
```typescript
const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'abc123');
```

Line 43–44:
```typescript
const file = makeFileStatus();
const item = new WorktreeFileItem(file, '/repo/wt', 'feature/y', 'abc123');
```

Line 55 (inside the icon loop):
```typescript
const item = new WorktreeFileItem(makeFileStatus({ status }), '/repo/wt', 'main', 'abc123');
```

Line 99–100 (leaf test):
```typescript
const file: FileStatus = { relativePath: 'foo.ts', status: 'M', isUntracked: false };
const leaf = new WorktreeFileItem(file, '/repo', 'main', 'abc123');
```

Also add a test that `baseSha` is stored (add after the `stores file, worktreePath, branch` test at line 43):
```typescript
test('stores baseSha as public property', () => {
  const file = makeFileStatus();
  const item = new WorktreeFileItem(file, '/repo/wt', 'feature/y', 'deadbeef');
  assert.strictEqual(item.baseSha, 'deadbeef');
});
```

- [ ] **Step 3: Fix `CommandRegistry.openDiff.test.ts` — `makeFileItem` function**

Replace the `makeFileItem` helper (line 38–41) to include `baseSha`:

```typescript
function makeFileItem(relativePath: string, status: FileStatus['status'], worktreePath: string, branch: string, baseSha = 'testsha123'): WorktreeFileItem {
  const file: FileStatus = { relativePath, status, isUntracked: false };
  return new WorktreeFileItem(file, worktreePath, branch, baseSha);
}
```

- [ ] **Step 4: Confirm it compiles**

```bash
npm run compile
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests PASS (WorktreeFileItem tests now include `baseSha`; openDiff tests still pass because the `HEAD` side code still exists — that is updated in Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/tree/WorktreeProvider.ts src/test/suite/WorktreeProvider.test.ts src/test/suite/CommandRegistry.openDiff.test.ts
git commit -m "feat: WorktreeFileItem gains baseSha field"
```

---

## Task 5: `WorktreeProvider.getChildren` switches to `getWorktreeBranchChanges`

**Files:**
- Modify: `src/tree/WorktreeProvider.ts`
- Modify: `src/test/suite/WorktreeProvider.test.ts`

- [ ] **Step 1: Update the `getChildren` tests in `WorktreeProvider.test.ts`**

Replace the entire `WorktreeProvider.getChildren — branch dispatch` suite (lines 97–136) with:

```typescript
suite('WorktreeProvider.getChildren — branch dispatch', () => {
  test('returns [] for WorktreeFileItem (leaf)', async () => {
    const file: FileStatus = { relativePath: 'foo.ts', status: 'M', isUntracked: false };
    const leaf = new WorktreeFileItem(file, '/repo', 'main', 'abc');
    const git = {} as any;
    const provider = new WorktreeProvider(git);
    const children = await provider.getChildren(leaf);
    assert.deepStrictEqual(children, []);
  });

  test('returns WorktreeFileItem[] with baseSha when worktree has branch changes', async () => {
    const file: FileStatus = { relativePath: 'src/index.ts', status: 'M', isUntracked: false };
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isDirty: true, pathExists: true, locked: false, bare: false };
    const git = { getWorktreeBranchChanges: async () => ({ files: [file], baseSha: 'sha999' }) } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo');
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof WorktreeFileItem);
    const child = children[0] as WorktreeFileItem;
    assert.strictEqual(child.file.relativePath, 'src/index.ts');
    assert.strictEqual(child.worktreePath, '/repo/feat');
    assert.strictEqual(child.branch, 'feat');
    assert.strictEqual(child.baseSha, 'sha999');
  });

  test('returns single "No changes on branch" TreeItem when branch has no changes', async () => {
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isDirty: false, pathExists: true, locked: false, bare: false };
    const git = { getWorktreeBranchChanges: async () => ({ files: [], baseSha: 'sha000' }) } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo');
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const clean = children[0] as vscode.TreeItem;
    assert.strictEqual(clean.label, 'No changes on branch');
    assert.ok(!(clean instanceof WorktreeFileItem));
  });

  test('returns error TreeItem when getWorktreeBranchChanges throws', async () => {
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isDirty: false, pathExists: true, locked: false, bare: false };
    const git = { getWorktreeBranchChanges: async () => { throw new Error('no common ancestor'); } } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo');
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const errItem = children[0] as vscode.TreeItem;
    assert.ok((errItem.label as string).includes('no common ancestor'));
  });
});
```

- [ ] **Step 2: Run to confirm the updated tests fail**

```bash
npm run compile && npm test
```

Expected: the new `getChildren` tests FAIL because the implementation still calls `getWorktreeStatus`.

- [ ] **Step 3: Update `WorktreeProvider.getChildren` in `WorktreeProvider.ts`**

Replace the `WorktreeItem` branch inside `getChildren` (the block that starts at `// Expanding a worktree item → show dirty files`):

```typescript
// Expanding a worktree item → show branch changes vs base
if (element instanceof WorktreeItem) {
  try {
    const { files, baseSha } = await this.git.getWorktreeBranchChanges(element.worktree.path);
    if (files.length === 0) {
      const clean = new vscode.TreeItem('No changes on branch', vscode.TreeItemCollapsibleState.None);
      return [clean];
    }
    return files.map(f => new WorktreeFileItem(f, element.worktree.path, element.worktree.branch, baseSha));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [new vscode.TreeItem(`Error: ${msg}`, vscode.TreeItemCollapsibleState.None)];
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run compile && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tree/WorktreeProvider.ts src/test/suite/WorktreeProvider.test.ts
git commit -m "feat: WorktreeProvider uses getWorktreeBranchChanges for branch diff"
```

---

## Task 6: `YggContentProvider` — overloads + `BASE` side, remove `HEAD`

**Files:**
- Modify: `src/content/YggContentProvider.ts`
- Modify: `src/test/suite/YggContentProvider.test.ts`

- [ ] **Step 1: Update `YggContentProvider.test.ts` — replace `HEAD` tests with `BASE`**

Replace the entire file content with:

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';
import { YggContentProvider, makeUri } from '../../content/YggContentProvider';

suite('YggContentProvider', () => {
  suite('makeUri', () => {
    test('BASE side encodes side, wt, file, sha into query string', () => {
      const uri = makeUri('BASE', '/repo/my worktree', 'src/foo bar.ts', 'abc123sha');
      assert.strictEqual(uri.scheme, 'ygg-git');
      assert.strictEqual(uri.path, '/diff');
      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get('side'), 'BASE');
      assert.strictEqual(params.get('wt'), '/repo/my worktree');
      assert.strictEqual(params.get('file'), 'src/foo bar.ts');
      assert.strictEqual(params.get('sha'), 'abc123sha');
    });

    test('WORK side encodes side, wt, file (no sha)', () => {
      const uri = makeUri('WORK', '/repo/my worktree', 'src/foo.ts');
      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get('side'), 'WORK');
      assert.strictEqual(params.get('sha'), null);
    });

    test('round-trips wt with slashes intact', () => {
      const wt = '/home/user/projects/my-feature';
      const file = 'src/components/Button.tsx';
      const uri = makeUri('WORK', wt, file);
      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get('wt'), wt);
      assert.strictEqual(params.get('file'), file);
    });
  });

  suite('provideTextDocumentContent', () => {
    test('BASE side: returns stdout on success', async () => {
      const run = async (_cmd: string, _args: string[], _opts: any) =>
        ({ status: 0, stdout: 'hello world\n', stderr: '' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo', 'src/index.ts', 'deadbeef');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, 'hello world\n');
    });

    test('BASE side: returns "" on non-zero exit', async () => {
      const run = async () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repo' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo', 'missing.ts', 'deadbeef');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '');
    });

    test('BASE side: returns binary message when null byte in first 8000 bytes', async () => {
      const binaryContent = 'PNG\x89' + '\0' + 'rest';
      const run = async () => ({ status: 0, stdout: binaryContent, stderr: '' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo', 'image.png', 'deadbeef');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '(binary file — diff not available)');
    });

    test('BASE side: passes sha to git show as <sha>:<file>', async () => {
      let capturedArgs: string[] = [];
      let capturedCwd = '';
      const run = async (_cmd: string, args: string[], opts: any) => {
        capturedArgs = args;
        capturedCwd = opts?.cwd ?? '';
        return { status: 0, stdout: 'file content', stderr: '' };
      };
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo/worktree', 'src/module.ts', 'abc123');
      await provider.provideTextDocumentContent(uri);
      assert.deepStrictEqual(capturedArgs, ['show', 'abc123:src/module.ts']);
      assert.strictEqual(capturedCwd, '/repo/worktree');
    });

    test('WORK side: reads from disk', async () => {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ygg-test-'));
      const tmpFile = path.join(tmpDir, 'test.ts');
      fs.writeFileSync(tmpFile, 'const x = 1;\n', 'utf8');
      try {
        const run = async () => ({ status: 0, stdout: '', stderr: '' });
        const provider = new YggContentProvider(run as any);
        const uri = makeUri('WORK', tmpDir, 'test.ts');
        const content = await provider.provideTextDocumentContent(uri);
        assert.strictEqual(content, 'const x = 1;\n');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('WORK side: returns "" on ENOENT', async () => {
      const run = async () => ({ status: 0, stdout: '', stderr: '' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('WORK', '/nonexistent-dir-abc123', 'no-such-file.ts');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '');
    });

    test('unknown side returns ""', async () => {
      const run = async () => ({ status: 0, stdout: '', stderr: '' });
      const provider = new YggContentProvider(run as any);
      const uri = vscode.Uri.from({
        scheme: 'ygg-git',
        path: '/diff',
        query: new URLSearchParams({ side: 'BOGUS', wt: '/repo', file: 'x.ts' }).toString(),
      });
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '');
    });
  });
});
```

- [ ] **Step 2: Run to confirm the updated tests fail**

```bash
npm run compile && npm test
```

Expected: `makeUri` overload tests FAIL (wrong signature), `BASE` tests FAIL (no BASE branch in provider).

- [ ] **Step 3: Replace `YggContentProvider.ts` with the updated implementation**

Replace the entire content of `src/content/YggContentProvider.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFileNoThrow } from '../utils/execFileNoThrow';

type RunFn = typeof execFileNoThrow;

export function makeUri(side: 'BASE', wt: string, file: string, sha: string): vscode.Uri;
export function makeUri(side: 'WORK', wt: string, file: string): vscode.Uri;
export function makeUri(side: 'BASE' | 'WORK', wt: string, file: string, sha?: string): vscode.Uri {
  const params: Record<string, string> = { side, wt, file };
  if (sha) { params.sha = sha; }
  return vscode.Uri.from({
    scheme: 'ygg-git',
    path: '/diff',
    query: new URLSearchParams(params).toString(),
  });
}

export class YggContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly run: RunFn = execFileNoThrow) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const side = params.get('side');
    const wt   = params.get('wt')!;
    const file = params.get('file')!;

    if (side === 'BASE') {
      const sha = params.get('sha')!;
      const gitPath = file.split(path.sep).join('/');
      const result = await this.run('git', ['show', `${sha}:${gitPath}`], { cwd: wt });
      if (result.status !== 0) { return ''; }
      if (result.stdout.slice(0, 8000).includes('\0')) {
        return '(binary file — diff not available)';
      }
      return result.stdout;
    }

    if (side === 'WORK') {
      try {
        return await fs.promises.readFile(path.join(wt, file), 'utf8');
      } catch {
        return '';
      }
    }

    return '';
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run compile && npm test
```

Expected: all tests PASS. Note: `CommandRegistry.openDiff` tests will still pass because `makeUri('HEAD', ...)` calls in that test file will now be compile errors — confirm the compile step catches this.

Actually, at this point `CommandRegistry.openDiff.test.ts` doesn't call `makeUri` directly — it only checks the URI side param at runtime. The `CommandRegistry.ts` source still calls `makeUri('HEAD', ...)` internally which will now be a compile error. This is expected and will be fixed in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/content/YggContentProvider.ts src/test/suite/YggContentProvider.test.ts
git commit -m "feat: YggContentProvider BASE side with sha, overloaded makeUri, remove HEAD"
```

---

## Task 7: `CommandRegistry.openDiff` — use `baseSha`

**Files:**
- Modify: `src/commands/CommandRegistry.ts`
- Modify: `src/test/suite/CommandRegistry.openDiff.test.ts`

- [ ] **Step 1: Update `CommandRegistry.openDiff.test.ts` — fix assertions**

Replace the three assertions that reference `'HEAD'` and the old title format:

In the first test (`calls vscode.diff with correct URIs...`), replace lines 67–75:
```typescript
const leftParams = new URLSearchParams(leftUri.query);
assert.strictEqual(leftParams.get('side'), 'BASE');
assert.strictEqual(leftParams.get('wt'), '/repo/feat');
assert.strictEqual(leftParams.get('file'), 'src/foo.ts');
assert.strictEqual(leftParams.get('sha'), 'testsha123');

const rightParams = new URLSearchParams(rightUri.query);
assert.strictEqual(rightParams.get('side'), 'WORK');

assert.strictEqual(title, 'feat — src/foo.ts (branch base ↔ working tree)');
assert.deepStrictEqual(opts, { preview: true });
```

In the third test (`diff title format`), replace the `assert.strictEqual(capturedTitle, ...)` line:
```typescript
assert.strictEqual(capturedTitle, 'feature/add-button — components/Button.tsx (branch base ↔ working tree)');
```

- [ ] **Step 2: Run to confirm the title assertion tests fail**

```bash
npm run compile && npm test
```

Expected: compile error in `CommandRegistry.ts` — `makeUri('HEAD', ...)` is no longer a valid overload.

- [ ] **Step 3: Update `CommandRegistry.ts` — `openDiff` method**

Replace the `openDiff` private method:

```typescript
private async openDiff(item?: WorktreeFileItem): Promise<void> {
  if (!item) { return; }
  const { file, worktreePath, branch, baseSha } = item;
  const baseUri = makeUri('BASE', worktreePath, file.relativePath, baseSha);
  const workUri = makeUri('WORK', worktreePath, file.relativePath);
  const title   = `${branch} — ${file.relativePath} (branch base ↔ working tree)`;
  await vscode.commands.executeCommand('vscode.diff', baseUri, workUri, title, { preview: true });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run compile && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/CommandRegistry.ts src/test/suite/CommandRegistry.openDiff.test.ts
git commit -m "feat: openDiff uses baseSha for branch-base diff"
```

---

## Task 8: `package.json` configuration key

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `ygg.baseBranch` to `package.json`**

Find the `"contributes"` → `"configuration"` → `"properties"` section in `package.json` and add:

```json
"ygg.baseBranch": {
  "type": "string",
  "default": "",
  "description": "Branch to compare worktrees against. Leave empty to auto-detect the tracking branch (falls back to 'main')."
}
```

- [ ] **Step 2: Run final full test suite**

```bash
npm run compile && npm test
```

Expected: all tests PASS, zero compile errors.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add ygg.baseBranch configuration setting"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `parseDiffNameStatus` — M/A/D/R/C, rename destination, copy same as rename, unknown skipped, empty → [] | Task 1 |
| `GitService` constructor gains `getBaseBranch` callback (no vscode import) | Task 2 |
| `resolveBaseRef` — config → upstream → main | Task 2 |
| `getWorktreeBranchChanges` — 3 git calls, merge, dedup, throw on failure | Task 3 |
| `WorktreeFileItem` gains `baseSha` | Task 4 |
| `WorktreeProvider.getChildren` calls new method, passes baseSha, error case | Task 5 |
| `YggContentProvider` overloads + `BASE` side + remove `HEAD` | Task 6 |
| `CommandRegistry.openDiff` uses baseSha | Task 7 |
| `ygg.baseBranch` config key in package.json | Task 8 |
| `extension.ts` wires `getBaseBranch` callback | Task 2 |
| Update YggContentProvider tests (×6 HEAD → BASE) | Task 6 |
| Update CommandRegistry.openDiff tests (side/sha/title) | Task 7 |

All spec requirements covered. ✓
