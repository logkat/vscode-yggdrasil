# Phase 2 — Worktree Dirty-File Explorer & Diff Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each worktree item collapsible to reveal its dirty files; clicking a file opens a read-only HEAD↔working-tree diff tab in VS Code's built-in diff editor.

**Architecture:** Extend `WorktreeProvider` to union-type children (`WorktreeItem | WorktreeFileItem | vscode.TreeItem`); add `YggContentProvider` (`TextDocumentContentProvider` for `ygg-git:` scheme) to serve HEAD and WORK file content on demand; register a `ygg.openDiff` command that builds two `ygg-git:` URIs via `URLSearchParams` and calls `vscode.diff`; wire `treeView.onDidChangeVisibility` to show the welcome page when the Activity Bar icon is selected.

**Tech Stack:** TypeScript 5, VS Code Extension API (`TreeDataProvider`, `TextDocumentContentProvider`, `vscode.diff`), Node.js `fs`, git CLI via existing `execFileNoThrow`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/git/GitService.ts` | Add `FileStatus` type, `parseStatusLine`, `getWorktreeStatus` |
| Modify | `src/tree/WorktreeProvider.ts` | Add `WorktreeFileItem`; make `WorktreeItem` collapsible; union `getChildren` |
| **Create** | `src/content/YggContentProvider.ts` | `TextDocumentContentProvider` + `makeUri` helper |
| Modify | `src/commands/CommandRegistry.ts` | Add `ygg.openDiff` handler |
| Modify | `src/extension.ts` | Register content provider; wire `onDidChangeVisibility` |
| Modify | `package.json` | Add `ygg.openDiff` command; suppress from Command Palette |
| Modify | `src/test/suite/GitService.test.ts` | Tests for `parseStatusLine` |
| **Create** | `src/test/suite/WorktreeProvider.test.ts` | Tests for `WorktreeFileItem` + `getChildren` |
| **Create** | `src/test/suite/YggContentProvider.test.ts` | Tests for `provideTextDocumentContent` + `makeUri` |
| Modify | `src/test/suite/CommandRegistry.test.ts` | Tests for `ygg.openDiff` |

---

## Task 1: `FileStatus` type + `parseStatusLine` + `getWorktreeStatus`

**Files:**
- Modify: `src/git/GitService.ts`
- Modify: `src/test/suite/GitService.test.ts`

---

- [ ] **Step 1.1: Write failing tests for `parseStatusLine`**

Add to the bottom of `src/test/suite/GitService.test.ts`:

```ts
import { parseStatusLine } from '../../git/GitService';

suite('parseStatusLine', () => {
  test('modified tracked file', () => {
    const r = parseStatusLine(' M src/foo.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/foo.ts', status: 'M', isUntracked: false });
  });

  test('staged modified file (X non-space takes priority)', () => {
    const r = parseStatusLine('M  src/foo.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/foo.ts', status: 'M', isUntracked: false });
  });

  test('untracked file', () => {
    const r = parseStatusLine('?? src/new.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/new.ts', status: '?', isUntracked: true });
  });

  test('deleted file', () => {
    const r = parseStatusLine(' D src/old.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/old.ts', status: 'D', isUntracked: false });
  });

  test('added staged file', () => {
    const r = parseStatusLine('A  src/added.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/added.ts', status: 'A', isUntracked: false });
  });

  test('renamed file uses new path only', () => {
    const r = parseStatusLine('R  old/path.ts -> new/path.ts');
    assert.deepStrictEqual(r, { relativePath: 'new/path.ts', status: 'R', isUntracked: false });
  });

  test('quoted filename with space is dequoted', () => {
    const r = parseStatusLine(' M "src/my component/Button.tsx"');
    assert.deepStrictEqual(r, { relativePath: 'src/my component/Button.tsx', status: 'M', isUntracked: false });
  });

  test('quoted renamed file uses dequoted new path', () => {
    const r = parseStatusLine('R  "old name.ts" -> "new name.ts"');
    assert.deepStrictEqual(r, { relativePath: 'new name.ts', status: 'R', isUntracked: false });
  });

  test('returns null for short or empty line', () => {
    assert.strictEqual(parseStatusLine(''), null);
    assert.strictEqual(parseStatusLine('M '), null);
  });
});
```

- [ ] **Step 1.2: Compile and run — expect failures**

```bash
npm run compile && npm test
```

Expected: `parseStatusLine is not a function` (import error). Confirms tests are wired and failing.

- [ ] **Step 1.3: Add `FileStatus` type, `dequotePath`, and `parseStatusLine` to `GitService.ts`**

Add immediately after the existing `Worktree` interface (before `withConcurrency`):

```ts
export interface FileStatus {
  relativePath: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '?';
  isUntracked: boolean;
}

function dequotePath(raw: string): string {
  if (!raw.startsWith('"')) { return raw; }
  const inner = raw.slice(1, -1);
  return inner.replace(/\\([0-7]{3}|[\\nt])/g, (_: string, seq: string) => {
    if (seq.length === 3) { return String.fromCharCode(parseInt(seq, 8)); }
    if (seq === 'n') { return '\n'; }
    if (seq === 't') { return '\t'; }
    return '\\';
  });
}

export function parseStatusLine(line: string): FileStatus | null {
  if (line.length < 4) { return null; }
  const x = line[0];
  const y = line[1];
  const rawStatus = (x !== ' ' ? x : y) as FileStatus['status'];
  if (!['M', 'A', 'D', 'R', 'C', '?'].includes(rawStatus)) { return null; }

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
```

- [ ] **Step 1.4: Add `getWorktreeStatus` to the `GitService` class**

Add after `removeWorktree` (before `invalidateCache`):

```ts
async getWorktreeStatus(worktreePath: string): Promise<FileStatus[]> {
  try {
    const result = await execFileNoThrow('git', ['status', '--porcelain'], { cwd: worktreePath });
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
```

- [ ] **Step 1.5: Compile and run — expect tests to pass**

```bash
npm run compile && npm test
```

Expected: all `parseStatusLine` suite tests pass. Zero regressions in existing suites.

- [ ] **Step 1.6: Commit**

```bash
git add src/git/GitService.ts src/test/suite/GitService.test.ts
git commit -m "feat: add FileStatus type, parseStatusLine, and getWorktreeStatus to GitService"
```

---

## Task 2: `WorktreeFileItem` class

**Files:**
- Modify: `src/tree/WorktreeProvider.ts`
- Create: `src/test/suite/WorktreeProvider.test.ts`

---

- [ ] **Step 2.1: Create `WorktreeProvider.test.ts` with failing tests for `WorktreeFileItem`**

Create `src/test/suite/WorktreeProvider.test.ts`:

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorktreeFileItem } from '../../tree/WorktreeProvider';
import { FileStatus } from '../../git/GitService';

function makeFileStatus(overrides: Partial<FileStatus> = {}): FileStatus {
  return {
    relativePath: 'src/foo.ts',
    status: 'M',
    isUntracked: false,
    ...overrides,
  };
}

suite('WorktreeFileItem', () => {
  test('label is relativePath', () => {
    const item = new WorktreeFileItem(makeFileStatus({ relativePath: 'src/bar.ts' }), '/repo/wt', 'feature/x');
    assert.strictEqual(item.label, 'src/bar.ts');
  });

  test('description is the status code', () => {
    const item = new WorktreeFileItem(makeFileStatus({ status: 'M' }), '/repo/wt', 'main');
    assert.strictEqual(item.description, 'M');
  });

  test('contextValue is worktreeFile', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main');
    assert.strictEqual(item.contextValue, 'worktreeFile');
  });

  test('command is ygg.openDiff with item as argument', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main');
    assert.strictEqual(item.command?.command, 'ygg.openDiff');
    assert.deepStrictEqual(item.command?.arguments, [item]);
  });

  test('collapsible state is None (leaf)', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('stores file, worktreePath, branch as public properties', () => {
    const file = makeFileStatus();
    const item = new WorktreeFileItem(file, '/repo/wt', 'feature/y');
    assert.strictEqual(item.file, file);
    assert.strictEqual(item.worktreePath, '/repo/wt');
    assert.strictEqual(item.branch, 'feature/y');
  });

  suite('icon per status', () => {
    const cases: Array<[FileStatus['status'], string]> = [
      ['M', 'edit'],
      ['A', 'add'],
      ['?', 'add'],
      ['D', 'trash'],
      ['R', 'arrow-right'],
      ['C', 'copy'],
    ];
    for (const [status, expectedId] of cases) {
      test(`status '${status}' -> $(${expectedId})`, () => {
        const item = new WorktreeFileItem(makeFileStatus({ status }), '/repo/wt', 'main');
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, expectedId);
      });
    }
  });
});
```

- [ ] **Step 2.2: Compile and run — expect failures**

```bash
npm run compile && npm test
```

Expected: `WorktreeFileItem is not exported`. Confirms tests are live and failing.

- [ ] **Step 2.3: Add `WorktreeFileItem` to `WorktreeProvider.ts`**

Add the `FileStatus` import at the top:

```ts
import { GitService, Worktree, FileStatus } from '../git/GitService';
```

Add after the `WorktreeItem` class (before `WorktreeProvider`):

```ts
export class WorktreeFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileStatus,
    public readonly worktreePath: string,
    public readonly branch: string,
  ) {
    super(file.relativePath, vscode.TreeItemCollapsibleState.None);
    this.description = file.status;
    this.contextValue = 'worktreeFile';
    this.iconPath = WorktreeFileItem.iconFor(file.status);
    this.command = {
      command: 'ygg.openDiff',
      title: 'Open Diff',
      arguments: [this],
    };
  }

  private static iconFor(status: FileStatus['status']): vscode.ThemeIcon {
    switch (status) {
      case 'M': return new vscode.ThemeIcon('edit');
      case 'A': case '?': return new vscode.ThemeIcon('add');
      case 'D': return new vscode.ThemeIcon('trash');
      case 'R': return new vscode.ThemeIcon('arrow-right');
      case 'C': return new vscode.ThemeIcon('copy');
    }
  }
}
```

- [ ] **Step 2.4: Compile and run — expect tests to pass**

```bash
npm run compile && npm test
```

Expected: all `WorktreeFileItem` suite tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/tree/WorktreeProvider.ts src/test/suite/WorktreeProvider.test.ts
git commit -m "feat: add WorktreeFileItem tree node for dirty files"
```

---

## Task 3: Collapsible `WorktreeItem` + union `getChildren`

**Files:**
- Modify: `src/tree/WorktreeProvider.ts`
- Modify: `src/test/suite/WorktreeProvider.test.ts`

---

- [ ] **Step 3.1: Add failing tests for collapsible state and `getChildren`**

Append to `src/test/suite/WorktreeProvider.test.ts` (after existing suites):

```ts
import { WorktreeItem, WorktreeProvider } from '../../tree/WorktreeProvider';
import { GitService, Worktree } from '../../git/GitService';

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    path: '/repo/wt',
    branch: 'feature/x',
    head: 'abc123',
    isCurrent: false,
    isDirty: false,
    pathExists: true,
    locked: false,
    bare: false,
    ...overrides,
  };
}

function makeMockGit(statusFiles: FileStatus[] = []): GitService {
  return {
    getRepoRoot: async () => '/repo',
    listWorktrees: async () => [],
    getWorktreeStatus: async (_path: string) => statusFiles,
    addWorktree: async () => {},
    removeWorktree: async () => {},
    invalidateCache: () => {},
    getWorkspaceRoot: () => undefined,
  } as unknown as GitService;
}

suite('WorktreeItem collapsible state', () => {
  test('normal worktree (pathExists, not bare) is Collapsed', () => {
    const item = new WorktreeItem(makeWorktree({ pathExists: true, bare: false }), '/repo');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test('missing worktree (pathExists=false) is None', () => {
    const item = new WorktreeItem(makeWorktree({ pathExists: false }), '/repo');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('bare worktree is None', () => {
    const item = new WorktreeItem(makeWorktree({ bare: true }), '/repo');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('WorktreeItem has no command property', () => {
    const item = new WorktreeItem(makeWorktree(), '/repo');
    assert.strictEqual(item.command, undefined);
  });
});

suite('WorktreeProvider.getChildren for file items', () => {
  test('dirty worktree returns WorktreeFileItem children', async () => {
    const file = makeFileStatus({ relativePath: 'src/a.ts', status: 'M' });
    const provider = new WorktreeProvider(makeMockGit([file]));
    const parent = new WorktreeItem(makeWorktree(), '/repo');

    const children = await provider.getChildren(parent);

    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof WorktreeFileItem);
    assert.strictEqual((children[0] as WorktreeFileItem).file.relativePath, 'src/a.ts');
  });

  test('clean worktree returns single "Clean — no changes" leaf', async () => {
    const provider = new WorktreeProvider(makeMockGit([]));
    const parent = new WorktreeItem(makeWorktree(), '/repo');

    const children = await provider.getChildren(parent);

    assert.strictEqual(children.length, 1);
    assert.strictEqual((children[0] as vscode.TreeItem).label, 'Clean — no changes');
    assert.strictEqual((children[0] as vscode.TreeItem).command, undefined);
  });

  test('WorktreeFileItem element returns no children', async () => {
    const provider = new WorktreeProvider(makeMockGit());
    const fileItem = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main');

    const children = await provider.getChildren(fileItem);
    assert.strictEqual(children.length, 0);
  });
});
```

- [ ] **Step 3.2: Compile and run — expect failures**

```bash
npm run compile && npm test
```

Expected: collapsible state tests fail (`None` vs `Collapsed`); `getChildren` tests fail (wrong return types).

- [ ] **Step 3.3: Update `WorktreeItem` constructor in `WorktreeProvider.ts`**

Replace the existing `WorktreeItem` constructor body with:

```ts
constructor(
  public readonly worktree: Worktree,
  private readonly repoRoot: string
) {
  const collapsible = (worktree.pathExists && !worktree.bare)
    ? vscode.TreeItemCollapsibleState.Collapsed
    : vscode.TreeItemCollapsibleState.None;
  super(worktree.branch, collapsible);

  this.description = path.relative(repoRoot, worktree.path) || '.';
  this.tooltip = worktree.path;
  this.contextValue = WorktreeItem.contextValueFor(worktree);
  this.iconPath = WorktreeItem.iconFor(worktree);
  // No this.command — expand arrow is the primary interaction
}
```

- [ ] **Step 3.4: Update `WorktreeProvider` class declaration and `getChildren`**

Change the class declaration line:

```ts
export class WorktreeProvider implements vscode.TreeDataProvider<WorktreeItem | WorktreeFileItem | vscode.TreeItem> {
```

Change the `_onDidChangeTreeData` and `onDidChangeTreeData` declarations:

```ts
private readonly _onDidChangeTreeData = new vscode.EventEmitter<WorktreeItem | WorktreeFileItem | vscode.TreeItem | undefined | null | void>();
readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
```

Change `getTreeItem`:

```ts
getTreeItem(element: WorktreeItem | WorktreeFileItem | vscode.TreeItem): vscode.TreeItem {
  return element;
}
```

Replace the existing `getChildren` method entirely:

```ts
async getChildren(
  element?: WorktreeItem | WorktreeFileItem | vscode.TreeItem
): Promise<Array<WorktreeItem | WorktreeFileItem | vscode.TreeItem>> {
  // Leaf nodes have no children
  if (element instanceof WorktreeFileItem) { return []; }

  // Root: return worktree list (existing logic unchanged)
  if (!element) {
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

  // Worktree item: return its dirty files
  if (element instanceof WorktreeItem) {
    const files = await this.git.getWorktreeStatus(element.worktree.path);
    if (files.length === 0) {
      return [new vscode.TreeItem('Clean — no changes', vscode.TreeItemCollapsibleState.None)];
    }
    return files.map(f => new WorktreeFileItem(f, element.worktree.path, element.worktree.branch));
  }

  return [];
}
```

- [ ] **Step 3.5: Compile and run — expect tests to pass**

```bash
npm run compile && npm test
```

Expected: all `WorktreeItem collapsible state` and `WorktreeProvider.getChildren` tests pass. All prior suites unchanged.

- [ ] **Step 3.6: Commit**

```bash
git add src/tree/WorktreeProvider.ts src/test/suite/WorktreeProvider.test.ts
git commit -m "feat: make WorktreeItem collapsible and add union getChildren for dirty files"
```

---

## Task 4: `YggContentProvider` + `makeUri`

**Files:**
- Create: `src/content/YggContentProvider.ts`
- Create: `src/test/suite/YggContentProvider.test.ts`

---

- [ ] **Step 4.1: Create failing tests**

Create `src/test/suite/YggContentProvider.test.ts`:

```ts
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { YggContentProvider, makeUri } from '../../content/YggContentProvider';
import { ExecResult } from '../../utils/execFileNoThrow';

type RunFn = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<ExecResult>;

function makeRunFn(stdout: string, status = 0): RunFn {
  return async () => ({ stdout, stderr: '', status });
}

suite('makeUri', () => {
  test('round-trips wt and file with spaces through URLSearchParams', () => {
    const uri = makeUri('HEAD', '/Users/p/my project', 'src/foo bar.ts');
    const params = new URLSearchParams(uri.query);
    assert.strictEqual(params.get('side'), 'HEAD');
    assert.strictEqual(params.get('wt'), '/Users/p/my project');
    assert.strictEqual(params.get('file'), 'src/foo bar.ts');
  });

  test('scheme is ygg-git', () => {
    assert.strictEqual(makeUri('WORK', '/repo', 'f.ts').scheme, 'ygg-git');
  });

  test('path is always /diff', () => {
    assert.strictEqual(makeUri('HEAD', '/repo', 'f.ts').path, '/diff');
  });
});

suite('YggContentProvider — HEAD side', () => {
  test('returns stdout from git show on success', async () => {
    const provider = new YggContentProvider(makeRunFn('file content here'));
    const result = await provider.provideTextDocumentContent(makeUri('HEAD', '/repo/wt', 'src/foo.ts'));
    assert.strictEqual(result, 'file content here');
  });

  test('returns empty string when git show exits non-zero', async () => {
    const provider = new YggContentProvider(makeRunFn('', 1));
    const result = await provider.provideTextDocumentContent(makeUri('HEAD', '/repo/wt', 'src/new.ts'));
    assert.strictEqual(result, '');
  });

  test('returns binary notice when stdout contains null byte', async () => {
    const provider = new YggContentProvider(makeRunFn('PNG\x00IHDR'));
    const result = await provider.provideTextDocumentContent(makeUri('HEAD', '/repo/wt', 'image.png'));
    assert.strictEqual(result, '(binary file — diff not available)');
  });

  test('passes correct cwd and HEAD:<file> arg to git', async () => {
    let capturedArgs: string[] = [];
    let capturedCwd = '';
    const spy: RunFn = async (_cmd, args, opts) => {
      capturedArgs = args;
      capturedCwd = opts?.cwd ?? '';
      return { stdout: 'ok', stderr: '', status: 0 };
    };
    const provider = new YggContentProvider(spy);
    await provider.provideTextDocumentContent(makeUri('HEAD', '/repo/my-wt', 'src/bar.ts'));
    assert.deepStrictEqual(capturedArgs, ['show', 'HEAD:src/bar.ts']);
    assert.strictEqual(capturedCwd, '/repo/my-wt');
  });
});

suite('YggContentProvider — WORK side', () => {
  test('returns empty string for non-existent file', async () => {
    const provider = new YggContentProvider(makeRunFn(''));
    const result = await provider.provideTextDocumentContent(
      makeUri('WORK', '/nonexistent-wt-abc123', 'no-such-file.ts')
    );
    assert.strictEqual(result, '');
  });

  test('returns content of a real file', async () => {
    const provider = new YggContentProvider(makeRunFn(''));
    const repoRoot = path.resolve(__dirname, '../../../../');
    const result = await provider.provideTextDocumentContent(
      makeUri('WORK', repoRoot, 'package.json')
    );
    assert.ok(result.includes('"name"'), 'expected package.json content');
  });
});
```

- [ ] **Step 4.2: Compile and run — expect failures**

```bash
npm run compile && npm test
```

Expected: `Cannot find module '../../content/YggContentProvider'`.

- [ ] **Step 4.3: Create `src/content/YggContentProvider.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFileNoThrow, ExecOptions, ExecResult } from '../utils/execFileNoThrow';

type RunFn = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export function makeUri(side: 'HEAD' | 'WORK', wt: string, file: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'ygg-git',
    path: '/diff',
    query: new URLSearchParams({ side, wt, file }).toString(),
  });
}

export class YggContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly run: RunFn = execFileNoThrow) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const side = params.get('side') as 'HEAD' | 'WORK' | null;
    const wt   = params.get('wt');
    const file = params.get('file');

    if (!side || !wt || !file) { return ''; }

    if (side === 'HEAD') {
      const gitPath = file.split(path.sep).join('/');
      const result = await this.run('git', ['show', `HEAD:${gitPath}`], { cwd: wt });
      if (result.status !== 0) { return ''; }
      if (result.stdout.slice(0, 8000).includes('\0')) {
        return '(binary file — diff not available)';
      }
      return result.stdout;
    }

    if (side === 'WORK') {
      try {
        return fs.readFileSync(path.join(wt, file), 'utf8');
      } catch {
        return '';
      }
    }

    return '';
  }
}
```

- [ ] **Step 4.4: Compile and run — expect tests to pass**

```bash
npm run compile && npm test
```

Expected: all `makeUri` and `YggContentProvider` suite tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/content/YggContentProvider.ts src/test/suite/YggContentProvider.test.ts
git commit -m "feat: add YggContentProvider and makeUri for ygg-git: scheme"
```

---

## Task 5: `ygg.openDiff` command

**Files:**
- Modify: `src/commands/CommandRegistry.ts`
- Modify: `src/test/suite/CommandRegistry.test.ts`

---

- [ ] **Step 5.1: Add failing tests for `ygg.openDiff`**

Add inside the outer `suite('CommandRegistry', ...)` block in `src/test/suite/CommandRegistry.test.ts`, after the existing suites. Also add these imports at the top of the file:

```ts
import { WorktreeFileItem } from '../../tree/WorktreeProvider';
import { FileStatus } from '../../git/GitService';
```

Then append:

```ts
function makeFileItem(overrides: Partial<FileStatus> = {}): WorktreeFileItem {
  const file: FileStatus = {
    relativePath: 'src/foo.ts',
    status: 'M',
    isUntracked: false,
    ...overrides,
  };
  return new WorktreeFileItem(file, '/repo/wt', 'feature/x');
}

suite('ygg.openDiff', () => {
  test('calls vscode.diff with two ygg-git: URIs and preview:true', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    let diffCmd = '';
    let diffArgs: unknown[] = [];
    const originalExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (cmd: string, ...args: unknown[]) => {
      diffCmd = cmd; diffArgs = args;
    };
    try {
      await (reg as any).openDiff(makeFileItem());
      assert.strictEqual(diffCmd, 'vscode.diff');
      assert.strictEqual((diffArgs[0] as vscode.Uri).scheme, 'ygg-git');
      assert.strictEqual((diffArgs[1] as vscode.Uri).scheme, 'ygg-git');
      assert.ok((diffArgs[2] as string).includes('src/foo.ts'));
      assert.deepStrictEqual(diffArgs[3], { preview: true });
    } finally {
      (vscode.commands as any).executeCommand = originalExecute;
    }
  });

  test('HEAD URI has side=HEAD and correct wt and file', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    let headUri: vscode.Uri | undefined;
    const originalExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (_cmd: string, uri1: vscode.Uri) => {
      headUri = uri1;
    };
    try {
      await (reg as any).openDiff(makeFileItem({ relativePath: 'lib/util.ts' }));
      const params = new URLSearchParams(headUri!.query);
      assert.strictEqual(params.get('side'), 'HEAD');
      assert.strictEqual(params.get('file'), 'lib/util.ts');
      assert.strictEqual(params.get('wt'), '/repo/wt');
    } finally {
      (vscode.commands as any).executeCommand = originalExecute;
    }
  });

  test('WORK URI has side=WORK', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    let workUri: vscode.Uri | undefined;
    const originalExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (_cmd: string, _u1: unknown, uri2: vscode.Uri) => {
      workUri = uri2;
    };
    try {
      await (reg as any).openDiff(makeFileItem());
      assert.strictEqual(new URLSearchParams(workUri!.query).get('side'), 'WORK');
    } finally {
      (vscode.commands as any).executeCommand = originalExecute;
    }
  });

  test('diff title contains branch and relativePath', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    let title = '';
    const originalExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (_c: string, _u1: unknown, _u2: unknown, t: string) => {
      title = t;
    };
    try {
      await (reg as any).openDiff(makeFileItem());
      assert.ok(title.includes('feature/x'), `missing branch in title: ${title}`);
      assert.ok(title.includes('src/foo.ts'), `missing file in title: ${title}`);
    } finally {
      (vscode.commands as any).executeCommand = originalExecute;
    }
  });

  test('does nothing when item is undefined', async () => {
    const reg = new CommandRegistry(makeMockContext(), makeMockGit(), makeMockProvider());
    let called = false;
    const originalExecute = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (cmd: string) => {
      if (cmd === 'vscode.diff') { called = true; }
    };
    try {
      await (reg as any).openDiff(undefined);
      assert.strictEqual(called, false);
    } finally {
      (vscode.commands as any).executeCommand = originalExecute;
    }
  });
});
```

- [ ] **Step 5.2: Compile and run — expect failures**

```bash
npm run compile && npm test
```

Expected: `openDiff is not a function`.

- [ ] **Step 5.3: Add imports and `ygg.openDiff` to `CommandRegistry.ts`**

Add after existing imports at top of `src/commands/CommandRegistry.ts`:

```ts
import { makeUri } from '../content/YggContentProvider';
import { WorktreeFileItem } from '../tree/WorktreeProvider';
```

Inside `register()`, after the `ygg.revealInOs` disposable:

```ts
disposables.push(vscode.commands.registerCommand('ygg.openDiff', (item?: WorktreeFileItem) =>
  this.openDiff(item)
));
```

Add after `clearSwitchMode`:

```ts
private async openDiff(item?: WorktreeFileItem): Promise<void> {
  if (!item) { return; }
  const headUri = makeUri('HEAD', item.worktreePath, item.file.relativePath);
  const workUri = makeUri('WORK', item.worktreePath, item.file.relativePath);
  const title   = `${item.branch} — ${item.file.relativePath} (HEAD ↔ Working Tree)`;
  await vscode.commands.executeCommand('vscode.diff', headUri, workUri, title, { preview: true });
}
```

- [ ] **Step 5.4: Compile and run — expect tests to pass**

```bash
npm run compile && npm test
```

Expected: all `ygg.openDiff` tests pass. All prior suites unchanged.

- [ ] **Step 5.5: Commit**

```bash
git add src/commands/CommandRegistry.ts src/test/suite/CommandRegistry.test.ts
git commit -m "feat: add ygg.openDiff command for read-only diff preview"
```

---

## Task 6: `extension.ts` + `package.json` wiring

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

---

- [ ] **Step 6.1: Update `extension.ts` imports**

At the top of `src/extension.ts`, add (or verify already present):

```ts
import { YggContentProvider } from './content/YggContentProvider';
import { showWelcome } from './welcome/WelcomePage';
```

- [ ] **Step 6.2: Register content provider and `onDidChangeVisibility`**

Inside `activate()`, after `const registry = new CommandRegistry(...)` and before `context.subscriptions.push(...)`:

```ts
const contentProvider = new YggContentProvider();

context.subscriptions.push(
  treeView.onDidChangeVisibility(({ visible }) => {
    if (visible) { showWelcome(context); }
  })
);
```

Then update the `context.subscriptions.push(...)` call to include the content provider registration:

```ts
context.subscriptions.push(
  treeView,
  explorerView,
  welcomeCommand,
  vscode.workspace.registerTextDocumentContentProvider('ygg-git', contentProvider),
  ...commands,
  provider,
);
```

- [ ] **Step 6.3: Add `ygg.openDiff` to `package.json` commands array**

In `package.json`, inside `"contributes"."commands"`, append:

```json
{
  "command": "ygg.openDiff",
  "title": "Open Diff"
}
```

- [ ] **Step 6.4: Add Command Palette suppression to `package.json`**

Inside `"contributes"."menus"`, add a `"commandPalette"` key alongside the existing menu keys:

```json
"commandPalette": [
  { "command": "ygg.openDiff", "when": "false" }
]
```

- [ ] **Step 6.5: Compile and run full test suite**

```bash
npm run compile && npm test
```

Expected: all tests pass. Zero failures.

- [ ] **Step 6.6: Smoke-test in the Extension Development Host**

Press **F5** in VS Code to launch the Extension Development Host. In the host window:

1. Click the Yggdrasil icon in the Activity Bar — the welcome page opens.
2. Click the Yggdrasil icon again (deselect then reselect) — the welcome page comes to the foreground, no duplicate panels.
3. In a repo with multiple worktrees, expand a worktree that has dirty files — the sub-tree shows changed files with status badges (`M`, `A`, `D`, `?`, etc.).
4. Click a changed file — a diff tab opens in preview mode (italic tab title) showing HEAD on the left and working-tree on the right. Both sides are read-only.
5. Expand a clean worktree — the sub-tree shows "Clean — no changes".
6. Expand a missing or bare worktree — no expand arrow (none exists to click).
7. Open Command Palette (`Cmd+Shift+P`) and search "Open Diff" — `ygg.openDiff` does **not** appear.

- [ ] **Step 6.7: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: wire YggContentProvider, Activity Bar welcome trigger, and package.json for Phase 2"
```

---

## Done

Phase 2 is complete: six tasks, one commit each. Collapsible worktree items show dirty files; clicking a file opens a read-only HEAD↔working-tree diff tab; the welcome page opens when the Activity Bar icon is selected.
