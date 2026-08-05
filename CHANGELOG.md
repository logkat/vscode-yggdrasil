# Changelog

All notable changes to the "yggdrasil" extension will be documented in this file.

## [0.2.1](https://github.com/logkat/vscode-yggdrasil/compare/v0.2.0...v0.2.1) (2026-08-05)


### Bug Fixes

* support bare repositories with linked worktrees ([#42](https://github.com/logkat/vscode-yggdrasil/issues/42)) ([f594a1c](https://github.com/logkat/vscode-yggdrasil/commit/f594a1c0918b07dd3672798ef6cea20f1fefb106))

## [0.2.0](https://github.com/logkat/vscode-yggdrasil/compare/v0.1.5...v0.2.0) (2026-08-05)

### ⚠ BREAKING CHANGES

- **Per-worktree colours are now off by default.** Rows in the worktree tree
  no longer get a colour unless you opt in. Set `ygg.worktreeColors` to `true`
  to restore them. VS Code's built-in `explorer.decorations.colors` must also
  be enabled, or no colours appear.

### Features

- **Opt-in worktree colours** via the new `ygg.worktreeColors` setting. Toggling
  it recolours the tree immediately — no window reload.
- The colour of a worktree now applies consistently to the files and folders
  nested inside it on Windows as well as macOS and Linux.

### Bug Fixes

- **Every palette colour now meets WCAG AA contrast** against the background it
  renders on, in Light, Dark and both High Contrast themes — including the
  tinted backgrounds VS Code draws behind hovered and selected rows. Previously
  9 of 10 dark values and 3 of 10 light values fell below the 4.5:1 threshold,
  and each High Contrast variant reused a single colour for both the black and
  white backgrounds, which cannot pass on both.
- **Files and folders inherit their worktree's colour on Windows.** Item paths
  were built with platform separators while worktree paths come from git with
  forward slashes, so no owner ever matched and every file was assigned its own
  colour, exhausting the palette.
- The base worktree row used an unregistered theme colour id (`list.foreground`)
  and so silently received no colour at all. It now uses `foreground`.

### Miscellaneous

- The published package no longer ships the compiled test suite, source maps, or
  development tooling — 117 files down to 26, and 76 KB down to 53 KB.
- All 14 outstanding dependency advisories in the build toolchain are resolved.
  None were ever reachable from the published extension, which declares no
  runtime dependencies.
- Releases are now versioned and tagged automatically from conventional commits.

## [0.1.1] - 2026-05-30

### Changed

- Refactored README for production users.
- Updated publisher ID to `logKat-yggdrasil`.

## [0.1.0] - 2026-05-30

### Added

- **Initial Release** with full Git Worktree Explorer capabilities.
- **Branch Diff Explorer**: View all changes on a branch compared to its base directly from the worktree explorer.
- **Diff View Integration**: Double-click files to open a diff view showing changes against the base branch.
- **Status Icons**: Integrated status icons (Modified, Added, Deleted, etc.) for files in the diff explorer.
- **Virtual Branch Entries**: Support for viewing changes on branches that are not currently checked out.
- **Base Branch Configuration**: Ability to configure the base branch for comparisons (defaults to tracking branch or `main`).
- **Worktree Management**: Support for listing, switching, adding, and pruning git worktrees.
