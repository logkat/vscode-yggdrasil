# VS Code Git Worktree Extension — Design Spec

**Date:** 2026-05-25
**Project:** yggdrasil
**Status:** Approved (post-reality-check revision)

---

## Overview

A VS Code extension that surfaces all git worktrees in a dedicated Explorer panel and lets the user switch between them via a WebStorm-style GUI dialog. Scope is v1 only; v2 (sneak-peek explorer view) and v3 (AI-generated insights) are out of scope.

**Minimum VS Code version:** `^1.74.0` (required for `RelativePattern` with `vscode.Uri` base)

---

## Architecture

Layered services pattern. Three focused modules coordinated by `extension.ts`. The UI layer has no git knowledge; all git I/O goes through `GitService` via `execFileNoThrow`.

```
yggdrasil/
├── src/
│   ├── extension.ts               ← activate/deactivate, wires everything together
│   ├── git/
│   │   └── GitService.ts          ← all git worktree commands
│   ├── tree/
│   │   └── WorktreeProvider.ts    ← TreeDataProvider + WorktreeItem
│   ├── commands/
│   │   └── CommandRegistry.ts     ← registers all commands, switch-prompt logic
│   └── utils/
│       └── execFileNoThrow.ts     ← safe process runner (no shell, structured output)
├── package.json
├── tsconfig.json
├── .vscodeignore                  ← excludes src/, docs/, node_modules/, test/ from package
└── README.md
```

---

## Components

### execFileNoThrow (`src/utils/execFileNoThrow.ts`)

Thin wrapper around Node's `child_process.execFile` (not `exec` — no shell interpolation). All git calls go through this; no code elsewhere calls Node process APIs.

```ts
interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;  // -1 when the binary is not found (ENOENT)
}

async function execFileNoThrow(
  cmd: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecResult>
```

**ENOENT handling:** If `execFile` throws with `code === 'ENOENT'` (binary not found), catch and return `{ status: -1, stderr: error.message, stdout: '' }`. Callers check `status === -1` to distinguish "git not on PATH" from other errors.

**cwd is required** whenever a git command must run in a specific worktree's directory (e.g. `git status --short` for dirty detection).

---

### GitService (`src/git/GitService.ts`)

**`Worktree` type:**
```ts
interface Worktree {
  path: string;        // absolute path (the `worktree` field from porcelain)
  branch: string;      // display name: short branch (refs/heads/ stripped), "(detached HEAD)", or "(bare)"
  head: string;        // full 40-char SHA
  isCurrent: boolean;  // true when this worktree's path matches the active workspace root (symlink-resolved)
  isDirty: boolean;    // false when pathExists is false
  pathExists: boolean; // false if the directory no longer exists on disk
  locked: boolean;     // true when porcelain emits a `locked` line
}
```

**`git worktree list --porcelain` format** (verified against git 2.50.1):

Each worktree record is separated by a blank line. Fields per record:
```
worktree /absolute/path          ← always present
HEAD <40-char-sha>               ← always present
branch refs/heads/<name>         ← present ONLY when on a branch
detached                         ← standalone keyword; present ONLY when HEAD is detached (no branch line)
bare                             ← standalone keyword; present for bare repos
locked [optional reason text]    ← standalone keyword; present when worktree is locked
prunable [optional reason text]  ← standalone keyword; present when worktree can be pruned
```

**Parsing rules:**
- Split output on `\n\n` to get per-record blocks
- Per block: iterate lines, match prefix to populate fields
- `branch` line present → short name = strip `refs/heads/` prefix
- `detached` line present (no `branch` line) → display as `"(detached HEAD)"`
- `bare` line present → display as `"(bare)"`, `isDirty = false`
- `locked` line present → set `locked: true`
- If `worktree` path does not exist on disk (`fs.existsSync(path) === false`) → set `pathExists: false`, `isDirty = false`

**`isCurrent` detection:**
- Do NOT compare against `vscode.workspace.workspaceFolders` URIs directly (symlink mismatch on macOS: `/tmp` vs `/private/tmp`)
- Use `fs.realpath()` to resolve both the worktree `path` field and `workspaceFolders[0].uri.fsPath`, then compare the resolved strings
- Multi-root workspaces: use `workspaceFolders[0]` as the active root

**Methods:**

`listWorktrees(): Promise<Worktree[]>`
- Runs `git worktree list --porcelain` with `cwd` set to the repo root
- Calls `getRepoRoot()` first to establish cwd
- After parsing, runs dirty checks for all non-bare, non-missing worktrees concurrently, capped at 4 parallel processes (inline semaphore — no external library; 20-line implementation):
  ```ts
  // Semaphore: run tasks with max N concurrent
  async function withConcurrency<T>(tasks: (() => Promise<T>)[], max: number): Promise<T[]>
  ```
  The number 4 was chosen as the default git concurrency limit for fetch operations; balances responsiveness against process-table pressure.

`getRepoRoot(): Promise<string>`
- Runs `git rev-parse --show-toplevel` with `cwd` set to `workspaceFolders[0].uri.fsPath`
- Result is cached for the lifetime of the provider

`addWorktree(path: string, branch: string, isNew: boolean): Promise<void>`
- `isNew === true` → `git worktree add -b <branch> <path>`
- `isNew === false` → `git worktree add <path> <branch>`

`removeWorktree(path: string): Promise<void>`
- Runs `git worktree remove <path>`

---

### WorktreeProvider (`src/tree/WorktreeProvider.ts`)

Implements `vscode.TreeDataProvider<WorktreeItem>`. Calls `GitService.listWorktrees()` (dirty checks consolidated there, not here).

**`WorktreeItem` display:**
| State | Label | Icon |
|---|---|---|
| Normal | branch short name | branch icon |
| Dirty | branch short name | branch icon + dot badge |
| Current | branch short name | branch icon + checkmark overlay |
| Missing path | branch short name | warning icon, tooltip: "Path not found — run `git worktree prune`" |
| Locked | branch short name + ` (locked)` | lock icon overlay |
| Bare | `(bare)` | archive icon |

Description field: relative path from repo root (computed as `path.relative(repoRoot, worktree.path)`).

**`contextValue` values:**
- `"worktreeItem"` — linked worktree, not current
- `"worktreeItemCurrent"` — current worktree (Switch + Remove suppressed)
- `"worktreeItemMissing"` — path does not exist (Switch + Remove suppressed)

**Refresh triggers:**
1. Extension activation
2. `vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(repoRoot), '.git/worktrees/**'))` — covers linked worktree add/remove
3. `vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(repoRoot), '.git/HEAD'))` — covers current-worktree changes
4. Both watchers use `vscode.Uri`-based `RelativePattern` (not plain glob strings) so VS Code's `files.watcherExclude` for `.git/` does not suppress them
5. Manual refresh command

Edge case — empty worktree list: when a repo has no linked worktrees, `git worktree list --porcelain` returns exactly one record (the main worktree). Show it normally. The list is never empty for a valid git repo.

---

### CommandRegistry (`src/commands/CommandRegistry.ts`)

**Switch flow:**
1. Check `globalState.get("yggdrasil.switchMode")`. If set, skip dialog.
2. If not set, create WebView panel via a factory function injected at construction (enables unit testing without a live VS Code instance).
3. WebView posts `{ action, mode, remember }` back via `acquireVsCodeApi().postMessage(...)`.
4. Extension host dispatches on `mode`:
   - `"newWindow"` → `vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(worktree.path), { forceNewWindow: true })`
   - `"replace"` → `vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(worktree.path), { forceNewWindow: false })`
   - `"addWorkspace"` → `vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: vscode.Uri.file(worktree.path) })`
5. `action: "cancel"` → dispose panel, do nothing.
6. Unrecognized `action` or `mode` → silently ignored.
7. `remember === true` → `globalState.update("yggdrasil.switchMode", mode)`, create/update status bar item.
8. Status bar item text: `"Worktree: New Window ×"` (or Replace/Workspace). Clicking × calls `globalState.update("yggdrasil.switchMode", undefined)` and hides the item.
9. **On activation**: if `globalState.get("yggdrasil.switchMode")` is already set, immediately create the status bar item.

**Add flow:**
1. `showQuickPick(["Existing branch", "New branch"])` → sets `isNew`
2. `showInputBox({ prompt: "Branch name" })`
3. `showInputBox({ prompt: "Worktree path", value: "../" + branchName })`
4. `GitService.addWorktree(path, branch, isNew)` then tree refresh

**Remove flow:**
1. `showWarningMessage("Remove worktree '<branch>'?", { modal: true }, "Remove")` 
2. On confirm: `GitService.removeWorktree(worktree.path)` then tree refresh
3. Only available when `contextValue === "worktreeItem"`

**copyPath:** `vscode.env.clipboard.writeText(worktree.path)`

**revealInOs:** `vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(worktree.path))`

---

## Switch Dialog (WebView)

Implemented as a **regular `createWebviewPanel` tab** — VS Code has no OS-level modal API. The panel is titled "Switch Worktree" and opens in `ViewColumn.Active`.

```
┌─────────────────────────────────────────────┐
│  Open worktree: feature/login               │
│                                             │
│  ○  Open in New Window                      │
│  ○  Replace Current Window                  │
│  ○  Add to Workspace                        │
│                                             │
│  ☐  Remember my choice                      │
│                                             │
│              [ Cancel ]  [ Open ]           │
└─────────────────────────────────────────────┘
```

**Security requirements:**
- CSP meta tag (required for VS Code marketplace approval):
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`
- Nonce generated per panel creation: `crypto.randomBytes(16).toString('base64')`
- All inline `<script>` and `<style>` tags carry `nonce="${nonce}"`
- Branch name and path HTML-escaped before template injection via `escapeHtml()`:
  ```ts
  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  ```

**Styling:** VS Code CSS variables (`--vscode-button-background`, `--vscode-foreground`, `--vscode-input-background`) — matches user's theme automatically.

**Message schema** (WebView → host):
```ts
{ action: "open" | "cancel", mode: "newWindow" | "replace" | "addWorkspace", remember: boolean }
```

---

## Package Manifest (`package.json`)

```json
"engines": { "vscode": "^1.74.0" },
"activationEvents": ["onView:yggdrasil.worktrees"],
"contributes": {
  "views": {
    "explorer": [{ "id": "yggdrasil.worktrees", "name": "Git Worktrees" }]
  },
  "commands": [
    { "command": "yggdrasil.refresh",    "title": "Refresh",                    "icon": "$(refresh)" },
    { "command": "yggdrasil.switch",     "title": "Switch Worktree",            "icon": "$(arrow-swap)" },
    { "command": "yggdrasil.add",        "title": "Add Worktree",               "icon": "$(add)" },
    { "command": "yggdrasil.remove",     "title": "Remove Worktree",            "icon": "$(trash)" },
    { "command": "yggdrasil.copyPath",   "title": "Copy Path" },
    { "command": "yggdrasil.revealInOs", "title": "Reveal in Finder / Explorer" }
  ],
  "menus": {
    "view/title": [
      { "command": "yggdrasil.refresh", "when": "view == yggdrasil.worktrees", "group": "navigation" },
      { "command": "yggdrasil.add",     "when": "view == yggdrasil.worktrees", "group": "navigation" }
    ],
    "view/item/context": [
      { "command": "yggdrasil.switch",     "when": "viewItem == worktreeItem", "group": "inline" },
      { "command": "yggdrasil.switch",     "when": "viewItem == worktreeItem", "group": "1_actions" },
      { "command": "yggdrasil.remove",     "when": "viewItem == worktreeItem", "group": "2_actions" },
      { "command": "yggdrasil.copyPath",   "when": "viewItem =~ /^worktreeItem/", "group": "3_actions" },
      { "command": "yggdrasil.revealInOs", "when": "viewItem =~ /^worktreeItem/", "group": "3_actions" }
    ]
  }
}
```

`Switch` and `Remove` are suppressed for `worktreeItemCurrent` and `worktreeItemMissing` by the `when: "viewItem == worktreeItem"` exact match. `copyPath` and `revealInOs` use a `^worktreeItem` prefix regex to match all three variants.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Not a git repo | Tree shows "Not a git repository" item |
| `git` not on PATH (`status === -1`) | Error message: "Git not found. Install git and reload." |
| `listWorktrees` fails | "Failed to load worktrees" item with inline Retry button |
| `addWorktree` fails | `showErrorMessage` with stderr content |
| `removeWorktree` fails | `showErrorMessage` with stderr content |
| Worktree path missing on disk | Item with warning icon, tooltip "Path not found — run `git worktree prune`"; `contextValue: "worktreeItemMissing"` disables Switch and Remove |

---

## Testing

**`execFileNoThrow` unit tests:**
- Mock the underlying `child_process.execFile`
- Verify: success path returns `{ stdout, stderr, status: 0 }`, non-zero exit returns structured result, ENOENT throws map to `{ status: -1 }`

**`GitService` unit tests:**
- Mock `execFileNoThrow`
- Porcelain parser: normal branch, detached HEAD, bare, locked, missing path cases
- `isCurrent` detection: symlink resolution (mock `fs.realpath`)
- Dirty detection: clean vs dirty output
- `addWorktree`: `isNew=true` uses `-b` flag, `isNew=false` does not
- Error propagation: non-zero status surfaces correctly

**`WorktreeProvider` unit tests:**
- Assert labels, descriptions, icons, and all three `contextValue` variants for each worktree state

**`CommandRegistry` unit tests:**
- Inject a mock WebView factory; trigger `onDidReceiveMessage` with each message type
- `action: "open", mode: "newWindow"` → `executeCommand("vscode.openFolder", ..., { forceNewWindow: true })`
- `action: "open", mode: "addWorkspace"` → `updateWorkspaceFolders`
- `action: "cancel"` → no API call, panel disposed
- `remember: true` → `globalState.update` called with correct key and value
- Unrecognized `action` → no crash, no side effects
- Activation with existing `globalState` preference → status bar item created

**Test runner:** Mocha + `@vscode/test-electron`. No E2E tests in v1.

---

## README Structure

1. One-line description
2. Animated GIF placeholder (replace after first build)
3. Feature list (v1)
4. Installation
5. Commands table (no keybindings in v1)
6. Switch dialog behaviour explanation
7. Roadmap: v2 sneak-peek explorer, v3 AI insights
8. Contributing guide

---

## Roadmap (out of scope for v1)

| Version | Feature |
|---|---|
| v2 | Sneak-peek explorer view — browse worktree file tree without switching |
| v3 | AI-generated insights per worktree (branch summary, diff highlights) |

When v2 lands, `WorktreeProvider` promotes to emit events and a second `TreeDataProvider` subscribes.
