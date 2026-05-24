# VS Code Git Worktree Extension — Design Spec

**Date:** 2026-05-25
**Project:** yggdrasil
**Status:** Approved (post-review revision)

---

## Overview

A VS Code extension that surfaces all git worktrees in a dedicated Explorer panel and lets the user switch between them via a WebStorm-style GUI dialog. Scope is v1 only; v2 (sneak-peek explorer view) and v3 (AI-generated insights) are out of scope and noted only as roadmap.

---

## Architecture

Layered services pattern. Three focused modules coordinated by a thin `extension.ts` entry point. The UI layer has no git knowledge; git I/O is isolated in `GitService`.

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

Thin wrapper around Node's `child_process.execFile` — no shell interpolation, safe against injection. All git calls go through this; nothing in the codebase calls Node's process APIs directly.

```ts
interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

async function execFileNoThrow(
  cmd: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecResult>
```

Callers inspect `status !== 0` or non-empty `stderr` rather than catching exceptions, keeping error handling explicit. `cwd` is required whenever a git command must run in a specific worktree's directory.

---

### GitService (`src/git/GitService.ts`)

Responsible for all git I/O. Delegates process execution to `execFileNoThrow`.

**Methods:**
- `listWorktrees(): Promise<Worktree[]>` — runs `git worktree list --porcelain` from the repo root, parses into `Worktree[]`. Dirty check is batched here (max 4 concurrent via a semaphore) by calling `git -C <path> status --short` per worktree.
- `getRepoGitDir(): Promise<string>` — runs `git rev-parse --absolute-git-dir` from the active workspace root; used to set `isCurrent` reliably.
- `addWorktree(path: string, branch: string, isNew: boolean): Promise<void>` — runs `git worktree add <path> <branch>` (existing branch) or `git worktree add -b <branch> <path>` (new branch), depending on `isNew`.
- `removeWorktree(path: string): Promise<void>` — runs `git worktree remove <path>`.

**`Worktree` type:**
```ts
interface Worktree {
  path: string;        // absolute path
  branch: string;      // display name: short branch name, or "(detached HEAD)"
  head: string;        // SHA
  gitDir: string;      // absolute path to this worktree's .git dir (from porcelain)
  isCurrent: boolean;  // gitDir matches getRepoGitDir() result
  isDirty: boolean;
  pathExists: boolean; // false if directory has been deleted from disk
}
```

**Parsing notes:**
- The porcelain format emits `branch (missing)` for detached HEAD — display as `(detached HEAD)`.
- `gitdir` field in porcelain output gives the worktree's `.git` dir; compare against `getRepoGitDir()` for `isCurrent` (path-equality on symlink-resolved paths). Do not compare workspace folder URIs directly.
- If `path` does not exist on disk, set `pathExists: false`; `isDirty` defaults to `false`.

---

### WorktreeProvider (`src/tree/WorktreeProvider.ts`)

Implements `vscode.TreeDataProvider<WorktreeItem>`. Calls `GitService.listWorktrees()` to build the tree (dirty checks are consolidated inside `listWorktrees`, not called separately here).

**`WorktreeItem` display:**
- Label: `branch` field (already short-name + detached HEAD handled by `GitService`)
- Description: relative path from repo root
- Icon: branch icon; `isDirty` adds a dot badge; `isCurrent` adds a checkmark overlay; `pathExists === false` adds a warning icon and tooltip "Path not found — run `git worktree prune`"
- `contextValue`:
  - `"worktreeItem"` — linked worktree, not current
  - `"worktreeItemCurrent"` — current worktree (suppress Remove and Switch in menus)
  - `"worktreeItemMissing"` — path does not exist on disk (suppress Switch and Remove)

**Refresh triggers:**
1. Extension activation
2. File system watcher on absolute URI `<repoRoot>/.git/worktrees/**` — covers linked worktree add/remove
3. File system watcher on absolute URI `<repoRoot>/.git/HEAD` — covers current worktree changes
4. Both watchers are created even if `.git/worktrees/` does not yet exist; VS Code handles non-existent parent directories gracefully
5. Manual refresh command

---

### CommandRegistry (`src/commands/CommandRegistry.ts`)

Registers all six commands against the VS Code extension context.

| Command | ID | Trigger |
|---|---|---|
| Refresh | `yggdrasil.refresh` | View toolbar button |
| Switch Worktree | `yggdrasil.switch` | Context menu + inline icon |
| Add Worktree | `yggdrasil.add` | View toolbar button |
| Remove Worktree | `yggdrasil.remove` | Context menu |
| Copy Path | `yggdrasil.copyPath` | Context menu |
| Reveal in OS Explorer | `yggdrasil.revealInOs` | Context menu |

**Switch flow:**
1. Check `globalState.get("yggdrasil.switchMode")`. If set, skip dialog and use stored mode directly.
2. If not set, open a WebView panel (modal style) showing the switch dialog.
3. WebView posts `{ action, mode, remember }` back to extension host via `acquireVsCodeApi().postMessage(...)`.
4. Extension host handles each mode with the correct API call:
   - `"newWindow"` → `vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true })`
   - `"replace"` → `vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: false })`
   - `"addWorkspace"` → `vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri })`
5. `action: "cancel"` — dispose the panel, do nothing.
6. Any unrecognized `action` or `mode` value is silently ignored (defensive guard).
7. If `remember === true`, write `mode` to `globalState.update("yggdrasil.switchMode", mode)`.
8. A status bar item "Worktree: \<mode\> ×" is created/updated when the preference is saved; clicking × calls `globalState.update("yggdrasil.switchMode", undefined)` and hides the item.
9. **On activation**: if `globalState.get("yggdrasil.switchMode")` is already set, immediately create the status bar item so the user can see and clear the preference.

**Add flow:**
1. `showQuickPick` with options "Existing branch" / "New branch" — determines which git flags to use.
2. `showInputBox` for branch name.
3. `showInputBox` for path (default derived from branch name, e.g. `../<branchname>`).
4. `GitService.addWorktree(path, branch, isNew)` then tree refresh.

**Remove flow:**
1. `showWarningMessage` modal with "Remove" / "Cancel" buttons.
2. On confirm: `GitService.removeWorktree(path)` then tree refresh.
3. Remove is only available when `contextValue === "worktreeItem"` (not current, not missing).

---

## Switch Dialog (WebView)

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
- The WebView HTML must include a CSP meta tag: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`
- A cryptographic nonce is generated per panel creation: `crypto.randomBytes(16).toString('base64')`
- Branch name and path are HTML-escaped before injection into the template (e.g. via an `escapeHtml()` utility that replaces `&`, `<`, `>`, `"`, `'`)
- Inline `<script>` and `<style>` tags carry the nonce attribute

**Styling:** VS Code CSS variables (`--vscode-button-background`, `--vscode-foreground`, `--vscode-input-background`, etc.) — automatically matches the user's theme.

**Message schema** (WebView → host):
```ts
{ action: "open" | "cancel", mode: "newWindow" | "replace" | "addWorkspace", remember: boolean }
```

---

## Package Manifest (`package.json`)

```json
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
      { "command": "yggdrasil.switch",     "when": "viewItem == worktreeItem",        "group": "inline" },
      { "command": "yggdrasil.remove",     "when": "viewItem == worktreeItem" },
      { "command": "yggdrasil.copyPath",   "when": "viewItem =~ /worktreeItem/" },
      { "command": "yggdrasil.revealInOs", "when": "viewItem =~ /worktreeItem/" }
    ]
  }
}
```

Note: `Switch` and `Remove` are suppressed for `worktreeItemCurrent` and `worktreeItemMissing` via the `when` clauses. `copyPath` and `revealInOs` use a regex match to cover all three `contextValue` variants.

Activation is lazy (`onView:...`) — the extension does not load on every VS Code launch.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Not a git repo | Tree shows single "Not a git repository" item |
| `git` not on PATH | Error message with link to git install docs |
| `listWorktrees` fails | "Failed to load worktrees" item with inline Retry button |
| `addWorktree` fails | `showErrorMessage` with stderr content |
| `removeWorktree` fails | `showErrorMessage` with stderr content |
| Worktree path missing on disk | Item shown with warning icon and tooltip "Path not found — run `git worktree prune`"; Switch and Remove actions disabled via `contextValue: "worktreeItemMissing"` |

---

## Testing

- **`execFileNoThrow` unit tests** — mock the underlying Node process; verify structured output, `cwd` forwarding, and Windows compatibility.
- **`GitService` unit tests** — mock `execFileNoThrow`; cover porcelain parser (including detached HEAD and missing-path cases), dirty detection, add/remove happy paths, error propagation, and `isCurrent` detection via `gitDir` comparison.
- **`WorktreeProvider` unit tests** — assert tree item labels, descriptions, icons, and all three `contextValue` variants.
- **`CommandRegistry` unit tests** — mock the WebView panel's `onDidReceiveMessage`; verify: correct VS Code API called per mode, `action: "cancel"` does nothing, `remember: true` writes to `globalState`, unrecognized values are silently ignored, status bar item created on activation when preference is already set.
- Test runner: Mocha + `@vscode/test-electron`.
- No E2E/headless VS Code tests in v1.

---

## README Structure

1. One-line description
2. Animated GIF placeholder (replace after first working build)
3. Feature list (v1)
4. Installation
5. Commands table (no keybindings defined in v1)
6. Switch dialog behaviour explanation
7. Roadmap: v2 sneak-peek explorer, v3 AI insights
8. Contributing guide

---

## Roadmap (out of scope for v1)

| Version | Feature |
|---|---|
| v2 | Sneak-peek explorer view — browse worktree file tree without switching |
| v3 | AI-generated insights per worktree (branch summary, diff highlights) |

When v2 lands, `WorktreeProvider` will be promoted to emit events and a second `TreeDataProvider` will subscribe — the event-driven pattern applies at that point.
