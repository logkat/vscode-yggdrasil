# yggdrasil — VS Code Git Worktree Extension

Sidebar tree view for exploring and switching git worktrees.
Entry point: `src/extension.ts` → registers GitService, WorktreeProvider, CommandRegistry.

## Commands

```bash
npm run compile          # TypeScript → out/
npm run watch            # compile in watch mode
npm test                 # run extension tests (node ./out/test/runTests.js)
npm run package          # build .vsix for distribution (vsce package)
npm run release          # bump version, generate changelog, and tag (used by CI or manual override)
npm run release:dry-run  # dry run release (does not write files or tag)
```

## Architecture

| File | Role |
|------|------|
| `src/git/parsers.ts` | pure git output parsers: `parsePorcelain`, `parseStatusLine`, `parseDiffNameStatus` |
| `src/git/GitService.ts` | git operations (worktree list/add/remove/prune, branch changes, caching) |
| `src/tree/items.ts` | `WorktreeItem`, `WorktreeFolderItem`, `WorktreeFileItem` tree-item classes |
| `src/tree/WorktreeProvider.ts` | VS Code `TreeDataProvider` — builds the sidebar tree with SWR caching |
| `src/tree/WorktreeDecorationProvider.ts` | file decorations (per-branch colour coding) |
| `src/commands/StatusBarManager.ts` | status-bar items and `sanitizeBranchForPath` helper |
| `src/commands/CommandRegistry.ts` | registers all `ygg.*` VS Code commands |
| `src/content/YggContentProvider.ts` | virtual `ygg-git:` scheme for diff views |
| `src/welcome/WelcomePage.ts` | one-time welcome webview |

## Development workflow

1. `npm run watch` — keep a compile watcher running
2. Press **F5** in VS Code to launch Extension Development Host
3. The `.vscode/launch.json` and `.vscode/tasks.json` wire this up automatically
4. Tests: `npm test` (requires compiled output — run compile first)
