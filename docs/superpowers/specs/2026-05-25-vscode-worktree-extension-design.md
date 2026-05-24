# VS Code Git Worktree Extension — Design Spec

**Date:** 2026-05-25
**Project:** yggdrasil
**Status:** Approved

---

## Overview

A VS Code extension that surfaces all git worktrees in a dedicated Explorer panel and lets the user switch between them via a WebStorm-style GUI dialog. Scope is v1 only; v2 (sneak-peek explorer view) and v3 (AI-generated insights) are out of scope and noted only as roadmap.

---

## Architecture

Layered services pattern (Approach B). Three focused modules coordinated by a thin `extension.ts` entry point. The UI layer has no git knowledge; git I/O is isolated in `GitService`.

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
├── .vscodeignore
└── README.md
```

---

## Components

### execFileNoThrow (`src/utils/execFileNoThrow.ts`)

A thin wrapper around Node's `child_process.execFile` (not `exec` — no shell interpolation, safe against injection). Returns structured output instead of throwing.

```ts
interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

async function execFileNoThrow(
  cmd: string,
  args: string[]
): Promise<ExecResult>
```

All git calls go through this utility. Callers inspect `status !== 0` or non-empty `stderr` rather than catching exceptions, keeping error handling explicit.

---

### GitService (`src/git/GitService.ts`)

Responsible for all git I/O. Delegates process execution to `execFileNoThrow`.

**Methods:**
- `listWorktrees(): Promise<Worktree[]>` — runs `git worktree list --porcelain`, parses into `Worktree[]`
- `isDirty(path: string): Promise<boolean>` — runs `git status --short`, returns true if output is non-empty
- `addWorktree(path: string, branch: string): Promise<void>` — runs `git worktree add`
- `removeWorktree(path: string): Promise<void>` — runs `git worktree remove`

**`Worktree` type:**
```ts
interface Worktree {
  path: string;        // absolute path
  branch: string;      // e.g. "refs/heads/feature/login"
  head: string;        // SHA
  isCurrent: boolean;  // matched against vscode.workspace.workspaceFolders
  isDirty: boolean;
}
```

All calls surface `stderr` to the caller as a structured error; nothing is silently swallowed.

---

### WorktreeProvider (`src/tree/WorktreeProvider.ts`)

Implements `vscode.TreeDataProvider<WorktreeItem>`. Calls `GitService.listWorktrees()` + `GitService.isDirty()` in parallel via `Promise.all` to build the tree.

**`WorktreeItem` display:**
- Label: branch short name (strip `refs/heads/`)
- Description: relative path from repo root
- Icon: branch icon; dirty state adds a dot badge; current worktree gets a checkmark overlay
- `contextValue: "worktreeItem"` — used by menu `when` clauses

**Refresh triggers:**
1. Extension activation
2. File system watcher on `.git/worktrees/**`
3. Manual refresh command

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
1. Check `globalState.get("yggdrasil.switchMode")`. If set, skip dialog and use stored mode.
2. If not set, open a WebView panel (modal style) showing the switch dialog.
3. WebView posts `{ action, mode, remember }` back to extension host via `vscode.postMessage`.
4. Extension host calls `vscode.commands.executeCommand("vscode.openFolder", ...)` with the appropriate options.
5. If `remember === true`, persist `mode` to `globalState`.
6. A status bar item "Worktree: \<mode\> ×" appears when a preference is saved; clicking × clears it.

**Add flow:**
1. `showInputBox` for branch name.
2. `showInputBox` for path (default derived from branch name).
3. `GitService.addWorktree(path, branch)` then tree refresh.

**Remove flow:**
1. `showWarningMessage` modal with "Remove" / "Cancel" buttons.
2. On confirm: `GitService.removeWorktree(path)` then tree refresh.

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

- Styled with VS Code CSS variables (`--vscode-button-background`, `--vscode-foreground`, etc.) — automatically matches the user's theme.
- Message schema from WebView to host: `{ action: "open" | "cancel", mode: "newWindow" | "replace" | "addWorkspace", remember: boolean }`

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
      { "command": "yggdrasil.switch",     "when": "viewItem == worktreeItem", "group": "inline" },
      { "command": "yggdrasil.remove",     "when": "viewItem == worktreeItem" },
      { "command": "yggdrasil.copyPath",   "when": "viewItem == worktreeItem" },
      { "command": "yggdrasil.revealInOs", "when": "viewItem == worktreeItem" }
    ]
  }
}
```

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

---

## Testing

- **`execFileNoThrow` unit tests** — mock the underlying Node process; verify structured output and Windows compatibility.
- **`GitService` unit tests** — mock `execFileNoThrow`; cover porcelain parser, dirty detection, add/remove happy paths, and error propagation.
- **`WorktreeProvider` unit tests** — assert tree item labels, descriptions, icons, and `isCurrent` flag.
- Test runner: Mocha + `@vscode/test-electron`.
- No E2E/headless VS Code tests in v1.

---

## README Structure

1. One-line description
2. Animated GIF placeholder (replace after first working build)
3. Feature list (v1)
4. Installation
5. Commands and keyboard shortcuts table
6. Switch dialog behaviour explanation
7. Roadmap: v2 sneak-peek explorer, v3 AI insights
8. Contributing guide

---

## Roadmap (out of scope for v1)

| Version | Feature |
|---|---|
| v2 | Sneak-peek explorer view — browse worktree file tree without switching |
| v3 | AI-generated insights per worktree (branch summary, diff highlights) |

When v2 lands, `WorktreeProvider` will be promoted to emit events and a second `TreeDataProvider` will subscribe — the event-driven pattern (Approach C) applies at that point.
