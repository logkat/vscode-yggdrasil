# Contributing to Yggdrasil Git Worktrees

Thanks for your interest! This is a VS Code extension for exploring and switching git worktrees.

## Reporting bugs and requesting features

Use [GitHub Issues](https://github.com/logkat/vscode-yggdrasil/issues) and pick the appropriate template.

## Local development setup

**Prerequisites:** Node.js ≥18, npm, VS Code, Git ≥2.5

```bash
git clone https://github.com/logkat/vscode-yggdrasil.git
cd vscode-yggdrasil
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded.

To keep compilation running continuously:

```bash
npm run watch
```

## Running tests

```bash
npm run compile && npm test
```

Tests run in a VS Code extension host via `@vscode/test-electron`. The `compile` step is required before running.

## Submitting a pull request

1. Fork the repo and create a branch from `main`
2. Make your change — keep it focused on one thing
3. Run `npm run compile && npm test` and confirm all tests pass
4. Open a PR with a clear description of what changed and why

Keep PRs focused. Avoid bundling unrelated refactoring with a feature or fix.

## Code style

- TypeScript throughout — no JavaScript
- No unnecessary comments; only comment non-obvious constraints or workarounds
- Follow the patterns in the file you're modifying

### Architecture overview

| File | Role |
|------|------|
| `src/git/parsers.ts` | Pure git output parsers |
| `src/git/GitService.ts` | Git operations: worktree list/add/remove/prune, caching |
| `src/tree/items.ts` | Tree-item classes for the sidebar |
| `src/tree/WorktreeProvider.ts` | VS Code `TreeDataProvider` — builds the sidebar tree |
| `src/tree/WorktreeDecorationProvider.ts` | File decorations (per-branch colour coding) |
| `src/commands/CommandRegistry.ts` | Registers all `ygg.*` VS Code commands |
| `src/commands/StatusBarManager.ts` | Status-bar items |
| `src/content/YggContentProvider.ts` | Virtual `ygg-git:` scheme for diff views |

## Commit Messages & Releases

This project uses **Conventional Commits** to automate semantic versioning and changelog generation.

### Commit Guidelines

Commit messages must follow the conventional commits specification:
- `feat: <description>` - A new feature (bumps minor version)
- `fix: <description>` - A bug fix (bumps patch version)
- `docs: <description>` - Documentation changes (no version bump)
- `chore: <description>` - Miscellaneous chores and maintenance (no version bump)
- `refactor: <description>` - Code refactoring (no version bump)
- `perf: <description>` - Performance improvements (bumps patch version)

Breaking changes should contain a `!` after the type (e.g., `feat!: rewrite parser`) or `BREAKING CHANGE:` in the footer, which bumps the major version.

### Release Process

Releases are fully automated via the **Auto Release** GitHub Actions workflow:

1. **Automatic Bumping & Changelog**: When changes are merged or pushed to the `main` branch, the workflow:
   - Parses the commit history since the last tag using `commit-and-tag-version`.
   - Determines the next semantic version bump.
   - Updates `package.json` and `package-lock.json` with the new version.
   - Appends the release notes to `CHANGELOG.md`.
   - Creates a commit in the format `chore(release): vX.Y.Z [skip ci]` and a matching git tag.
   - Pushes the release commit and tag back to the `main` branch.
   - Triggers the extension publishing workflow.

> [!NOTE]
> While the project is in initial development (version `< 1.0.0`), `commit-and-tag-version` defaults to a patch bump for features.
> If you need to force a minor release or bypass the automated calculation, you can run the command locally before pushing:
> ```bash
> npm run release -- --release-as minor
> git push --follow-tags
> ```
> Pushing a commit with `[skip ci]` or manual tags will safely bypass the automated pipeline step, and trigger publishing directly.
