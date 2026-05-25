# Phase 2 — Worktree Dirty-File Explorer & Diff Preview

**Date:** 2026-05-25
**Project:** yggdrasil
**Status:** Approved

---

## Overview

Phase 2 makes each worktree item in the Activity Bar panel collapsible. Expanding a worktree reveals its dirty files (working-tree changes only, from `git status --porcelain`). Clicking a dirty file opens a read-only diff tab (HEAD ↔ working tree) in VS Code's built-in diff editor, in preview mode.

Untracked files are included: they produce an empty-left ↔ full-file-right diff, matching the "added" appearance of standard git diffs.

**Out of scope for Phase 2:** committed-but-not-merged changes, branch diff vs. merge-base, file editing through the diff view, caching of status results.

---

## Delta from Phase 1

| File | Change |
|---|---|
| `src/git/GitService.ts` | Add `FileStatus` type + `getWorktreeStatus()` method |
| `src/tree/WorktreeProvider.ts` | Add `WorktreeFileItem`; make `WorktreeItem` collapsible; union-type `getChildren` |
| `src/content/YggContentProvider.ts` | **New** — `TextDocumentContentProvider` for `ygg-git:` scheme |
| `src/commands/CommandRegistry.ts` | Add `ygg.openDiff` command handler |
| `src/extension.ts` | Register content provider; open welcome page on Activity Bar selection |
| `package.json` | Add `ygg.openDiff` command; suppress from Command Palette |

---

## Architecture

```
WorktreeItem (collapsible)
└── WorktreeFileItem (leaf)  ← git status --porcelain per worktree
    └── on click → ygg.openDiff
                    ├── headUri: ygg-git:///diff?side=HEAD&wt=...&file=...
                    └── workUri: ygg-git:///diff?side=WORK&wt=...&file=...
                         ↓
                    YggContentProvider.provideTextDocumentContent()
                    HEAD: git show HEAD:<file>  ('' on error or binary)
                    WORK: fs.readFile(...)       ('' on ENOENT or error)
                         ↓
                    vscode.diff(headUri, workUri, title, { preview: true })
```

`YggContentProvider` is stateless — it derives content on every call from the live filesystem and git.

---

## Data Model

### `FileStatus` (new, in `GitService.ts`)

```ts
export interface FileStatus {
  relativePath: string;  // forward-slash separated, relative to worktree root
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '?';
  isUntracked: boolean;  // true when status === '?'
}
```

**XY-collapse rule:** `git status --porcelain` emits two-char XY codes. Collapse: if X is non-space, use X; else use Y. `??` → `?`.

**Renamed files:** porcelain v1 format is `R  old -> new`. Use the new path (the portion after ` -> `).

**Quoted filenames:** git quotes filenames containing spaces, tabs, or non-ASCII chars as `"escaped"` with octal sequences (`\NNN`) and standard C escapes (`\t`, `\\`, etc.). The parser must dequote: strip surrounding `"`, unescape octal sequences, unescape `\t` → tab, `\\` → backslash.

---

## GitService Changes

### New method: `getWorktreeStatus(worktreePath: string): Promise<FileStatus[]>`

- Runs `git status --porcelain` with `cwd: worktreePath`
- Returns `[]` on any error, on non-zero exit, or when the worktree is clean
- Parses each output line:
  1. Chars 0–1 = XY status; char 2 = space; remainder = path (possibly quoted)
  2. Apply XY-collapse → `status`
  3. Apply dequote pass if remainder starts with `"`
  4. For `R` lines: extract new path from `old -> new` format
  5. Normalize path separators to forward slashes (Windows safety)

---

## WorktreeProvider Changes

### `WorktreeItem`

Two changes only:

1. `collapsibleState`:
   - `TreeItemCollapsibleState.Collapsed` when `wt.pathExists && !wt.bare`
   - `TreeItemCollapsibleState.None` when `!wt.pathExists || wt.bare`
2. Remove `this.command` — the expand arrow is the primary interaction; the welcome-page command is no longer appropriate on a collapsible item.

### New: `WorktreeFileItem`

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

### `WorktreeProvider` — updated `getChildren`

```ts
async getChildren(element?: WorktreeItem | WorktreeFileItem): Promise<(WorktreeItem | WorktreeFileItem)[]>
```

- `element === undefined` → existing logic (returns `WorktreeItem[]`)
- `element instanceof WorktreeItem` → call `git.getWorktreeStatus(element.worktree.path)`
  - Non-empty → return `WorktreeFileItem[]`
  - Empty → return single informational item (label: `"Clean — no changes"`, no icon, no command, no `contextValue`)
- `element instanceof WorktreeFileItem` → return `[]` (leaves have no children)

Status is always re-queried on expand — no caching. Freshness is the priority for a status view.

---

## YggContentProvider (new file)

**Location:** `src/content/YggContentProvider.ts`

**URI format:**

```
ygg-git:///diff?side=HEAD&wt=<worktreePath>&file=<relativePath>
ygg-git:///diff?side=WORK&wt=<worktreePath>&file=<relativePath>
```

- `path` is always `/diff` — stable, human-readable, VS Code uses it for tab labelling
- All variable data lives in `query` via `URLSearchParams` to avoid `%2F`-decode corruption in `uri.path`
- `wt` and `file` are not additionally encoded — `URLSearchParams` handles encoding

**URI construction (in `CommandRegistry`):**

```ts
function makeUri(side: 'HEAD' | 'WORK', wt: string, file: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'ygg-git',
    path: '/diff',
    query: new URLSearchParams({ side, wt, file }).toString(),
  });
}
```

**`provideTextDocumentContent(uri: vscode.Uri): string`:**

```ts
const params = new URLSearchParams(uri.query);
const side = params.get('side') as 'HEAD' | 'WORK';
const wt   = params.get('wt')!;
const file = params.get('file')!;

if (side === 'HEAD') {
  // forward slashes required by git on all platforms
  const gitPath = file.split(path.sep).join('/');
  const result = await execFileNoThrow('git', ['show', `HEAD:${gitPath}`], { cwd: wt });
  if (result.status !== 0) { return ''; }
  // binary detection: null byte in first 8000 bytes
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
```

**Note:** `provideTextDocumentContent` is synchronous in the interface type but VS Code accepts a `Thenable<string>` return. Use `async` for the `git show` call.

---

## `ygg.openDiff` Command

Registered in `CommandRegistry.register()`:

```ts
disposables.push(vscode.commands.registerCommand(
  'ygg.openDiff',
  (item?: WorktreeFileItem) => this.openDiff(item)
));
```

Handler:

```ts
private async openDiff(item?: WorktreeFileItem): Promise<void> {
  if (!item) { return; }
  const { file, worktreePath, branch } = item;
  const headUri = makeUri('HEAD', worktreePath, file.relativePath);
  const workUri = makeUri('WORK', worktreePath, file.relativePath);
  const title   = `${branch} — ${file.relativePath} (HEAD ↔ Working Tree)`;
  await vscode.commands.executeCommand('vscode.diff', headUri, workUri, title, { preview: true });
}
```

Both sides go through `YggContentProvider` → entire diff tab is read-only.

---

## Extension Registration

In `extension.ts`, alongside existing registrations:

```ts
const contentProvider = new YggContentProvider(git);
context.subscriptions.push(
  vscode.workspace.registerTextDocumentContentProvider('ygg-git', contentProvider)
);
```

### Welcome page on Activity Bar selection

When the user selects the Yggdrasil icon in the Activity Bar, the welcome page opens (or focuses if already open). This replaces the Phase 1 behaviour where clicking a `WorktreeItem` label triggered the welcome command directly.

Use `treeView.onDidChangeVisibility`:

```ts
context.subscriptions.push(
  treeView.onDidChangeVisibility(({ visible }) => {
    if (visible) { showWelcome(context); }
  })
);
```

`showWelcome` already implements singleton panel behaviour (reuses the existing panel if open, creates it if not), so repeated Activity Bar clicks do not stack panels.

No additional `activationEvents` needed — `onView:ygg.worktrees` already covers activation before any worktree item is expanded.

---

## package.json Changes

Add to `"commands"` array:

```json
{ "command": "ygg.openDiff", "title": "Open Diff" }
```

Add `"commandPalette"` suppression (prevents confusing palette entry with no-arg invocation):

```json
"commandPalette": [
  { "command": "ygg.openDiff", "when": "false" }
]
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `getWorktreeStatus` fails (any error) | Returns `[]` → "Clean — no changes" informational leaf |
| Worktree missing (`pathExists === false`) | `collapsibleState = None` — no expand arrow |
| Bare worktree | `collapsibleState = None` — no expand arrow |
| `git show HEAD:<file>` non-zero exit | Returns `''` → empty left side (untracked file "added" appearance) |
| Binary file (null byte detected) | Returns `"(binary file — diff not available)"` |
| `fs.readFile` fails (ENOENT or other) | Returns `''` → empty right side (deleted file appearance) |
| `ygg.openDiff` called with no arguments | Early return — no crash, no side effect |

---

## Testing

### `GitService.getWorktreeStatus`

- Clean output → `[]`
- Single `M` line → `[{ relativePath, status: 'M', isUntracked: false }]`
- `??` line → `[{ ..., status: '?', isUntracked: true }]`
- `R` line with `old -> new` → uses new path
- Quoted filename with space → dequoted correctly
- Non-zero exit → `[]`

### `WorktreeProvider`

- `getChildren(worktreeItem)` with dirty files → returns `WorktreeFileItem[]`
- `getChildren(worktreeItem)` with clean worktree → returns single "Clean" leaf
- Missing worktree (`pathExists === false`) → `collapsibleState = None`
- Bare worktree → `collapsibleState = None`
- `WorktreeItem` has no `.command` property

### `YggContentProvider`

- HEAD side: calls `git show HEAD:<file>` with correct `cwd`
- HEAD side: non-zero exit → `''`
- HEAD side: binary content (null byte) → `"(binary file — diff not available)"`
- WORK side: reads file from disk
- WORK side: ENOENT → `''`
- URI round-trip: encode → decode → same `wt` and `file` values (especially paths with spaces)

### `CommandRegistry.ygg.openDiff`

- Called with `WorktreeFileItem` → `vscode.diff` invoked with two `ygg-git:` URIs and `{ preview: true }`
- Diff title format: `"<branch> — <relativePath> (HEAD ↔ Working Tree)"`
- Called with no arguments → no `vscode.diff` call, no crash

### Activity Bar welcome trigger (`extension.ts`)

- `treeView.onDidChangeVisibility` fires with `visible: true` → `showWelcome` called
- `treeView.onDidChangeVisibility` fires with `visible: false` → `showWelcome` not called
- Repeated `visible: true` events → `showWelcome` called each time (singleton panel handles dedup)

---

## File Structure After Phase 2

```
src/
├── extension.ts
├── commands/
│   └── CommandRegistry.ts     (+ ygg.openDiff)
├── content/
│   └── YggContentProvider.ts  (new)
├── git/
│   └── GitService.ts          (+ FileStatus, getWorktreeStatus)
├── tree/
│   └── WorktreeProvider.ts    (+ WorktreeFileItem, collapsible WorktreeItem)
├── welcome/
│   └── WelcomePage.ts
└── utils/
    └── execFileNoThrow.ts
```
