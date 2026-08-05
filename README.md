# Yggdrasil Git Worktrees

Explore and switch git worktrees directly from the VS Code sidebar with a dedicated Activity Bar panel.

[![VS Marketplace](https://badgen.net/vs-marketplace/v/LogKat.git-yggdrasil?icon=visualstudio&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=LogKat.git-yggdrasil)
[![VS Marketplace Installs](https://badgen.net/vs-marketplace/i/LogKat.git-yggdrasil?label=installs)](https://marketplace.visualstudio.com/items?itemName=LogKat.git-yggdrasil)
[![Open VSX](https://img.shields.io/open-vsx/v/LogKat/git-yggdrasil?style=flat&label=Open%20VSX&color=C160EF)](https://open-vsx.org/extension/LogKat/git-yggdrasil)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/LogKat/git-yggdrasil?style=flat&label=downloads&color=C160EF)](https://open-vsx.org/extension/LogKat/git-yggdrasil)
[![CI](https://badgen.net/github/checks/logkat/vscode-yggdrasil/main?label=CI)](https://github.com/logkat/vscode-yggdrasil/actions/workflows/ci.yml)
[![License: MIT](https://badgen.net/github/license/logkat/vscode-yggdrasil)](LICENSE)
[![GitHub Stars](https://badgen.net/github/stars/logkat/vscode-yggdrasil)](https://github.com/logkat/vscode-yggdrasil/stargazers)

**[yggdrasil.logkat.dev](http://yggdrasil.logkat.dev/)**

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

### 🎨 Per-Worktree Colours
Give every worktree its own colour so you can tell at a glance which one a file belongs to. The colour applies to the worktree's row and to every file and folder nested inside it. Your current worktree is always green, and your base worktree stays the default text colour.

Colours are **off by default**. Turn them on with:

```jsonc
"ygg.worktreeColors": true,
// VS Code's own decoration colours must also be enabled (they are by default):
"explorer.decorations.colors": true
```

Every colour meets WCAG AA contrast against the background it renders on, in Light, Dark, and both High Contrast themes — including the tinted backgrounds VS Code draws behind hovered and selected rows. To override one, set the `ygg.worktreeColor.*` IDs under `workbench.colorCustomizations`.

## Installation

Visit **[yggdrasil.logkat.dev](http://yggdrasil.logkat.dev/)** for full documentation, or install directly from:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=LogKat.git-yggdrasil)
- [Open VSX](https://open-vsx.org/extension/LogKat/git-yggdrasil) (Cursor and other Open VSX clients)

Then open a Git repository and click the Yggdrasil icon in the Activity Bar.

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
- `ygg.worktreeColors`: Colour each worktree's rows, and the files and folders inside it, with a distinct colour (default: `false`). Requires VS Code's built-in `explorer.decorations.colors` setting to also be enabled, or no colours will appear.

## Requirements
- **VS Code**: `^1.74.0`
- **Git**: `^2.5.0` (with worktree support)

## Contributing
Found a bug or have a request? Please open an issue on the [GitHub repository](https://github.com/logkat/vscode-yggdrasil).

## Contributors

<a href="https://github.com/prakharsingh"><img src="https://avatars.githubusercontent.com/u/6357228?v=4" width="64" height="64" alt="Prakhar Singh" title="Prakhar Singh" /></a>
<a href="https://github.com/Abhi347"><img src="https://avatars.githubusercontent.com/u/1445581?v=4" width="64" height="64" alt="Abhishek Jain" title="Abhishek Jain" /></a>

---
**Published by [LogKat](https://marketplace.visualstudio.com/publishers/LogKat)**
