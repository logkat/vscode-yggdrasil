# Branch Diff Explorer — Design Spec

**Date:** 2026-05-25  
**Branch:** feature/phase2-diff-explorer  
**Status:** Approved (rev 2 — post-review fixes applied)

## Problem

The current worktree tree view shows only **working-tree dirty files** when a worktree node is expanded — i.e. `git status --porcelain` output. Files committed on the branch but not yet dirty are invisible, giving an incomplete picture of what the branch contains.

## Goal

When a worktree node is expanded, show **all files changed on the branch** compared to its base — committed changes, staged (index) changes, and uncommitted working-tree changes combined — in a single flat list. Clicking any file opens a diff of **branch-base version ↔ current working tree file**.

## Scope

Six files change; no other files are touched. `getWorktreeStatus` is **retained unchanged** — it is not removed or replaced; `getWorktreeBranchChanges` is a new, additive method.

| File | Change |
|------|--------|
| `src/git/GitService.ts` | New `getWorktreeBranchChanges()` + `resolveBaseRef()` + `parseDiffNameStatus()`; constructor gains `getBaseBranch` callback |
| `src/tree/WorktreeProvider.ts` | `getChildren()` calls new method; `WorktreeFileItem` gains `baseSha` |
| `src/content/YggContentProvider.ts` | `BASE` side replaces `HEAD`; `makeUri` uses overloads |
| `src/commands/CommandRegistry.ts` | `openDiff` uses `BASE` URI + updated diff title |
| `package.json` | New `ygg.baseBranch` configuration key |
| Tests | New unit tests for `parseDiffNameStatus`, `resolveBaseRef`; updated existing tests (see Testing section) |

## Architecture

### Data flow on expand

```
getChildren(WorktreeItem)
  → git.getWorktreeBranchChanges(wt.path)
      → resolveBaseRef(path)            // getBaseBranch() → @{upstream} → "main"
      → git merge-base HEAD <baseRef>   // → baseSha
      → git diff --name-status <sha>    // committed + unstaged changes (tracked files)
      → git diff --name-status --cached <sha>  // staged (index) changes
      → git status --porcelain          // ?? lines only (untracked files)
      → merge all three + deduplicate by path
      → return { files, baseSha }
  → files.map(f => new WorktreeFileItem(f, wt.path, wt.branch, baseSha))
```

### Data flow on file click

```
openDiff(WorktreeFileItem)
  → makeUri('BASE', wt, file, baseSha)  // left: base version via git show <sha>:<file>
  → makeUri('WORK', wt, file)           // right: current working tree file
  → vscode.diff(leftUri, rightUri, title)
```

## GitService Changes

### Constructor — `getBaseBranch` injection

`GitService` must remain free of `vscode` imports to stay unit-testable. The `ygg.baseBranch` configuration value is injected via a new optional constructor callback, alongside the existing `getWorkspaceRoot`:

```ts
constructor(
  public readonly getWorkspaceRoot: () => string | undefined,
  private readonly getBaseBranch: () => string | undefined = () => undefined,
) {}
```

`extension.ts` provides:
```ts
new GitService(
  () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  () => vscode.workspace.getConfiguration('ygg').get<string>('baseBranch') || undefined,
)
```

### `resolveBaseRef(worktreePath: string): Promise<string>` (private)

Resolution order:
1. `this.getBaseBranch()` — if non-empty/non-undefined, return it immediately (no git call).
2. `git rev-parse --abbrev-ref @{upstream}` in `worktreePath` — if exit 0 and non-empty, return the result.
3. Fall back to `"main"`.

**Note on detached HEAD:** on a detached HEAD, step 2 exits non-zero and falls through to `"main"` — this is correct and requires no special handling.

**Note on main-as-worktree:** when the expanded worktree IS the base branch (e.g. `main` is open as a worktree and `resolveBaseRef` returns `"main"`), `git merge-base HEAD main` returns the tip of main. `git diff --name-status <tip>` returns empty output. The tree correctly shows "No changes on branch" — this is the intended behaviour.

### `getWorktreeBranchChanges(worktreePath: string): Promise<{ files: FileStatus[]; baseSha: string }>` (public)

1. Call `resolveBaseRef(worktreePath)` → `baseRef`.
2. Run `git merge-base HEAD <baseRef>` → capture `baseSha` from stdout. If `result.status !== 0`, throw `new Error(\`Cannot find merge base with '${baseRef}': ${result.stderr.trim()}\`)`. (`execFileNoThrow` never throws; the caller must inspect `result.status` explicitly.)
3. Run `git diff --name-status <baseSha>` → parse with `parseDiffNameStatus` → `workingAndCommitted`.
4. Run `git diff --name-status --cached <baseSha>` → parse with `parseDiffNameStatus` → `staged`.
5. Run `git status --porcelain` → filter to lines starting with `??` → parse with existing `parseStatusLine` → `untracked`.
6. Merge all three lists: start with `workingAndCommitted`, then add any entry from `staged` whose `relativePath` is not already present, then add any entry from `untracked` whose `relativePath` is not already present. (No double-counting is possible between `workingAndCommitted` and `untracked` since `git diff` never emits untracked files, but the Set guard makes the intent explicit.)
7. Return `{ files: merged, baseSha }`.

**Deleted files:** when `file.status === 'D'`, the WORK side of the diff returns `''` (file does not exist on disk). The diff viewer shows "base version ↔ empty document" — this is correct and the accepted behaviour for deleted files. The diff title does not add special labelling for this case.

### `parseDiffNameStatus(output: string): FileStatus[]` (exported, pure)

Parses tab-delimited `git diff --name-status` output:

```
M\tpath/file.ts
A\tpath/new.ts
D\tpath/deleted.ts
R100\told/path.ts\tnew/path.ts
C085\told/path.ts\tcopy/path.ts
```

Rules:
- Split each line on `\t`.
- The first field is the raw status code, which may include a numeric score suffix (e.g. `R100`, `C085`). Strip the score: `rawCode[0]` gives the single-letter status.
- **For `R` (rename) and `C` (copy):** the line has three tab-separated fields; use the **third field** (destination path) as `relativePath`.
- **For all other statuses (`M`, `A`, `D`):** the line has two fields; use the **second field** as `relativePath`.
- Normalise path separators: replace all `/` with `path.sep` so `relativePath` is consistent with the rest of the codebase on all platforms.
- Skip lines whose single-letter code is not in `['M', 'A', 'D', 'R', 'C']`.
- `isUntracked` is always `false` (diff output never contains untracked files).
- Empty input returns `[]`.

## WorktreeFileItem Changes

Constructor signature adds `baseSha`:

```ts
constructor(
  public readonly file: FileStatus,
  public readonly worktreePath: string,
  public readonly branch: string,
  public readonly baseSha: string,
)
```

All other fields (icon logic, `contextValue`, command binding to `ygg.openDiff`) are unchanged.

The empty-state label changes from `'Clean — no changes'` to `'No changes on branch'`. This is intentional — the new wording accurately reflects that the check covers the full branch, not just the working tree.

## WorktreeProvider Changes

`getChildren` — `WorktreeItem` branch replaces the existing `getWorktreeStatus` call:

```ts
try {
  const { files, baseSha } = await this.git.getWorktreeBranchChanges(element.worktree.path);
  if (files.length === 0) {
    return [new vscode.TreeItem('No changes on branch', vscode.TreeItemCollapsibleState.None)];
  }
  return files.map(f =>
    new WorktreeFileItem(f, element.worktree.path, element.worktree.branch, baseSha)
  );
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return [new vscode.TreeItem(`Error: ${msg}`, vscode.TreeItemCollapsibleState.None)];
}
```

**`WorktreeItem` dirty icon:** The `isDirty` flag and its amber source-control icon continue to reflect working-tree dirty state only (populated by `listWorktrees`). After this change, a worktree with committed-but-clean files will show the plain `git-branch` icon even though expanding it reveals branch changes. Updating the icon to reflect committed-ahead state is **out of scope** for this phase.

## YggContentProvider Changes

`makeUri` uses two overloads to enforce at compile time that `BASE` always receives a SHA:

```ts
export function makeUri(side: 'BASE', wt: string, file: string, sha: string): vscode.Uri;
export function makeUri(side: 'WORK', wt: string, file: string): vscode.Uri;
export function makeUri(side: 'BASE' | 'WORK', wt: string, file: string, sha?: string): vscode.Uri {
  const params: Record<string, string> = { side, wt, file };
  if (sha) { params.sha = sha; }
  return vscode.Uri.from({ scheme: 'ygg-git', path: '/diff', query: new URLSearchParams(params).toString() });
}
```

`provideTextDocumentContent` replaces the `HEAD` branch with `BASE`:

```ts
if (side === 'BASE') {
  const sha = params.get('sha')!;
  const gitPath = file.split(path.sep).join('/');
  const result = await this.run('git', ['show', `${sha}:${gitPath}`], { cwd: wt });
  if (result.status !== 0) { return ''; }
  if (result.stdout.slice(0, 8000).includes('\0')) { return '(binary file — diff not available)'; }
  return result.stdout;
}
```

**`HEAD` branch is removed.** The following existing callers must be updated:

| File | Location | Change |
|------|----------|--------|
| `src/commands/CommandRegistry.ts` | `openDiff` | `makeUri('HEAD', ...)` → `makeUri('BASE', ..., baseSha)` |
| `src/test/suite/YggContentProvider.test.ts` | Lines with `makeUri('HEAD', ...)` (×6) | Replace `'HEAD'` with `'BASE'` and add a `sha` argument |
| `src/test/suite/CommandRegistry.openDiff.test.ts` | `params.get('side') === 'HEAD'` assertion | Update to `'BASE'`; add assertion for `sha` param; update title string from `(HEAD ↔ Working Tree)` to `(branch base ↔ working tree)` |

## CommandRegistry Changes

`openDiff`:

```ts
private async openDiff(item?: WorktreeFileItem): Promise<void> {
  if (!item) { return; }
  const { file, worktreePath, branch, baseSha } = item;
  const baseUri = makeUri('BASE', worktreePath, file.relativePath, baseSha);
  const workUri = makeUri('WORK', worktreePath, file.relativePath);
  const title   = `${branch} — ${file.relativePath} (branch base ↔ working tree)`;
  await vscode.commands.executeCommand('vscode.diff', baseUri, workUri, title, { preview: true });
}
```

## Configuration

`package.json` contribution under `contributes.configuration.properties`:

```json
"ygg.baseBranch": {
  "type": "string",
  "default": "",
  "description": "Branch to compare worktrees against. Leave empty to auto-detect the tracking branch (falls back to 'main')."
}
```

## Testing

| Area | What to test |
|------|-------------|
| `parseDiffNameStatus` (unit) | `M`/`A`/`D` lines (two-field); `R100` rename — destination path extracted; `C085` copy — destination path extracted (same logic as rename); unknown status skipped; empty input → `[]` |
| `getWorktreeBranchChanges` (unit, stub `execFileNoThrow`) | Three git commands called with correct args; staged file (only in `--cached` output) appears in result; working-tree file (only in non-cached diff) appears; untracked file (only in `??` porcelain) appears; a path in both cached and non-cached diffs is deduplicated; throws on `merge-base` non-zero exit |
| `resolveBaseRef` (unit) | `getBaseBranch()` returns value → returned immediately, no git call; `getBaseBranch()` returns undefined, upstream resolves → upstream returned; upstream fails → `"main"` returned |
| `YggContentProvider` (update existing ×6) | `BASE` side: `sha` query param passed to `git show <sha>:<file>`; `WORK` side: unchanged |
| `CommandRegistry.openDiff` (update existing ×3) | `side` param is `'BASE'`; `sha` param equals `item.baseSha`; title contains `(branch base ↔ working tree)` |
| `WorktreeProvider` (update existing) | `getChildren` on `WorktreeItem` returns `WorktreeFileItem[]` with `baseSha` field populated |

## Out of Scope

- Showing commit count or commit list per worktree.
- Grouping files by committed vs. staged vs. uncommitted in the tree.
- `ygg.baseBranch` being set per-worktree (global setting only).
- Updating the `WorktreeItem` dirty icon to reflect committed-ahead state.
- Caching `baseSha` across expands (currently re-resolved on every expand; deferring to a future performance pass).
