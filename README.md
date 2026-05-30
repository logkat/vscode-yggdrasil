# Yggdrasil — Git Worktree Explorer

Explore and switch git worktrees directly from the VS Code sidebar with a dedicated Activity Bar panel.

## Key Features

### 🌲 Activity Bar Explorer
Visualize all git worktrees for your project root in a dedicated sidebar panel. Yggdrasil stays in sync with your local git state automatically.

### 🔍 Branch Diff Explorer
Expand any worktree in the tree view to browse all changes on the branch compared to its base.
- **Unified Status**: View committed, staged, and untracked changes at a glance.
- **Side-by-Side Diffs**: Double-click any file to open a native VS Code diff view.
- **Status Icons**: Distinct icons for Modified (M), Added (A), Deleted (D), and Renamed (R) files.

### ⚡ Smart Switching
Switch context quickly via a GUI dialog with three flexible modes:
- **New Window**: Launch the worktree in a fresh VS Code instance.
- **Replace Current**: Pivot the current window to the new worktree.
- **Add to Workspace**: Create a Multi-root Workspace by adding the worktree.

### 🎯 Custom Comparison Bases
Set a custom **Base Branch** per worktree to track changes against `develop`, `staging`, or specific release branches. Yggdrasil will auto-detect your tracking branch or fall back to `main` if not specified.

## Installation

1. Install Yggdrasil from the VS Code Marketplace.
2. Open a Git Repository.
3. Click the Yggdrasil icon in the Activity Bar.

## Commands Reference

| Command | Title | Description |
|---|---|---|
| `ygg.selectAndSwitch` | Switch Worktree... | Search for a worktree and choose how to open it. |
| `ygg.add` | Add Worktree | Create a new git worktree for a branch. |
| `ygg.remove` | Remove Worktree | Remove a linked worktree from disk and git metadata. |
| `ygg.prune` | Prune Missing Worktrees | Clean up stale worktree metadata for deleted paths. |
| `ygg.refresh` | Refresh | Manually reload the worktree list. |
| `ygg.setBaseBranch` | Set Base Branch... | Set the comparison target for diffs on the selected branch. |
| `ygg.clearSwitchMode` | Clear Remembered Switch Mode | Reset your remembered "Always open in..." preference. |

## Switch Dialog Behaviour
When switching, you can choose to "Remember my choice". This preference is stored in your global settings and adds a status bar item for quick resetting. You can clear this anytime via the `ygg.clearSwitchMode` command.

## Extension Settings
- `ygg.baseBranch`: Default branch to compare all worktrees against (e.g., `main`).
- `ygg.showInExplorer`: Mirror the Yggdrasil panel at the bottom of the standard File Explorer (default: `true`).

## Requirements
- **VS Code**: `^1.74.0`
- **Git**: `^2.5.0` (with worktree support)

## Contributing
Found a bug or have a request? Please open an issue on our [GitHub Repository](https://github.com/prakharsingh007/yggdrasil).

---
**Published by logKat-yggdrasil**
