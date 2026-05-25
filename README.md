# Yggdrasil — Git Worktree Explorer

VS Code extension that surfaces all git worktrees in a dedicated Activity Bar panel and lets you switch between them with a single click.

---

## Architecture

Three focused modules coordinated by `extension.ts`. The UI layer has no git knowledge; all git I/O flows through `GitService` via `execFileNoThrow`.

```
src/
├── extension.ts               — activate/deactivate, wires everything together
├── welcome/
│   └── WelcomePage.ts         — first-install webview; also the yggdrasil.welcome command
├── git/
│   └── GitService.ts          — parsePorcelain(), listWorktrees(), addWorktree(), removeWorktree()
├── tree/
│   └── WorktreeProvider.ts    — TreeDataProvider + WorktreeItem, file watchers
├── commands/
│   └── CommandRegistry.ts     — all commands, switch/mode dialog, status bar
└── utils/
    └── execFileNoThrow.ts     — safe child_process wrapper (no shell interpolation)
```

### Data flow

```
activate()
  └─ GitService        (reads workspace root, runs git commands)
  └─ WorktreeProvider  (calls GitService, drives the tree view)
  └─ CommandRegistry   (registers commands, calls GitService + WorktreeProvider)
  └─ WelcomePage       (shown once on first install)
```

### Key design decisions

| Decision | Rationale |
|---|---|
| `execFileNoThrow` (no shell) | Prevents shell injection; args are always passed as arrays |
| `realpathSync` for `isCurrent` | macOS resolves `/tmp` → `/private/tmp`; raw path comparison fails |
| Semaphore (max 4) for dirty checks | Matches git's own fetch concurrency default |
| `RelativePattern(Uri, '.git/...')` | Avoids `files.watcherExclude` suppressing `.git/` watchers |
| Activity Bar container | Dedicated panel is discoverable; Explorer view is hidden by default |
| `globalState` for switch mode | Persists across sessions; cleared via Command Palette or status bar |
| `workspaceState` for base branch | Remembers per-worktree comparison bases without cluttering global config |

---

## Features

- **Activity Bar Explorer:** At-a-glance view of all linked worktrees.
- **Branch Diff Explorer:** Expand a worktree to see every file changed since the merge-base (committed, staged, and untracked).
- **Ahead/Dirty Indicators:** Distinct icons for "ahead of base" (blue commit icon) and "working tree dirty" (amber dot).
- **Flexible Switching:** Open worktrees in a new window, replace current, or add to workspace.
- **Custom Bases:** Set a specific comparison base branch per-worktree to track changes accurately in complex repos.
- **Git Pruning:** Integrated UI to clean up stale worktree entries.

---

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- VS Code ≥ 1.74.0
- git ≥ 2.5 (worktree support)

---

## Getting Started

```bash
git clone <repo>
cd yggdrasil
npm install
```

Open the folder in VS Code, then press **F5**. This compiles the extension and opens an **Extension Development Host** window with Yggdrasil loaded.

The Extension Development Host must be opened with a git repository that has worktrees for the panel to populate. Create worktrees with:

```bash
git worktree add ../my-feature feature/my-feature
```

---

## Build

```bash
npm run compile      # one-shot TypeScript compile → out/
npm run watch        # incremental watch mode (use with F5 for fast iteration)
```

Output goes to `out/`. The `main` field in `package.json` points to `out/extension.js`.

---

## Tests

```bash
npm test
```

Runs the Mocha suite via `@vscode/test-electron`. Tests spin up a real VS Code instance in headless mode. There are no E2E tests — the suite covers unit-level behaviour (porcelain parsing, command guards, stored-mode logic).

Test files live alongside source in `src/test/suite/`.

---

## Commands

| Command ID | Title | Trigger |
|---|---|---|
| `ygg.switch` | Switch Worktree | Inline button on tree item |
| `ygg.selectAndSwitch` | Switch Worktree… | Command Palette |
| `ygg.add` | Add Worktree | Toolbar + Command Palette |
| `ygg.prune` | Prune Missing Worktrees | Toolbar + Context menu |
| `ygg.setBaseBranch` | Set Base Branch... | Context menu |
| `ygg.remove` | Remove Worktree | Context menu |
| `ygg.refresh` | Refresh | Toolbar button |
| `ygg.copyPath` | Copy Path | Context menu |
| `ygg.revealInOs` | Reveal in Finder / Explorer | Context menu |
| `ygg.clearSwitchMode` | Clear Remembered Switch Mode | Command Palette |
| `ygg.welcome` | Welcome | Command Palette |

### Switch mode behaviour

- **Inline button** — uses stored mode preference; opens mode picker on first use.
- **`selectAndSwitch`** — always shows worktree picker then mode picker. Pin button stores the preference.
- **`clearSwitchMode`** — forgets stored preference; also reachable via status bar `×` button.

---

## Adding a New Command

1. Implement the handler method in `CommandRegistry.ts`.
2. Register it in `register()` and include it in the returned `Disposable[]`.
3. Add a `commands` entry in `package.json` (and a `menus` entry if it needs a toolbar or context menu slot).
4. Add a test in `src/test/suite/CommandRegistry.test.ts`.

---

## Roadmap

| Version | Feature |
|---|---|
| v2 | Sneak-peek explorer — browse a worktree's files without switching |
| v3 | AI-generated insights per worktree (branch summary, diff highlights) |
