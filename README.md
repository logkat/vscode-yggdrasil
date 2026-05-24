# Yggdrasil — Git Worktree Explorer

Explore and switch git worktrees directly from the VS Code sidebar.

<!-- Replace this line with an animated GIF after the first working build -->
> *Screenshot coming soon*

---

## Features

- **Worktree panel** in the Explorer sidebar — lists all worktrees with branch name, relative path, dirty/clean indicator, and a current-worktree badge
- **Switch dialog** — WebStorm-style modal with three open modes and a "Remember my choice" checkbox
- **Add worktree** — create a new worktree for an existing or new branch without leaving VS Code
- **Remove worktree** — remove a linked worktree with a confirmation prompt
- **Copy path** — copy the worktree's absolute path to the clipboard
- **Reveal in Finder / Explorer** — open the worktree folder in the OS file manager
- **Auto-refresh** — the list updates automatically when worktrees are added or removed

---

## Installation

1. Install from the [VS Code Marketplace](#) *(link added after publish)*
2. Open a git repository
3. The **Git Worktrees** panel appears in the Explorer sidebar

---

## Commands

| Command | Description |
|---|---|
| `yggdrasil.refresh` | Refresh the worktree list |
| `yggdrasil.switch` | Switch to the selected worktree |
| `yggdrasil.add` | Add a new worktree |
| `yggdrasil.remove` | Remove the selected worktree |
| `yggdrasil.copyPath` | Copy the worktree path to clipboard |
| `yggdrasil.revealInOs` | Reveal the worktree in Finder / Explorer |

No default keybindings are assigned. Bind any command via **Preferences → Keyboard Shortcuts**.

---

## Switch Dialog

When you click **Switch Worktree**, a dialog asks how to open the worktree:

| Option | Behaviour |
|---|---|
| Open in New Window | Opens the worktree in a fresh VS Code window |
| Replace Current Window | Reopens the current window at the worktree root |
| Add to Workspace | Adds the worktree as a folder in the current multi-root workspace |

Check **Remember my choice** to skip the dialog in future. A status bar item appears showing the saved mode — click the **×** to clear it.

---

## Roadmap

| Version | Feature |
|---|---|
| v2 | Sneak-peek explorer — browse a worktree's files without switching |
| v3 | AI-generated insights per worktree (branch summary, diff highlights) |

---

## Contributing

1. Clone the repo and `npm install`
2. Open in VS Code and press `F5` to launch the Extension Development Host
3. Run `npm test` to execute the test suite
4. Open a PR — please include a test for any new behaviour

Issues and feature requests welcome via GitHub Issues.
