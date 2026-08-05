import * as vscode from 'vscode';
import { GitService } from '../git/GitService';
import { Worktree } from '../git/parsers';
import { sortWorktrees } from './sort';

const POOL = [
  'ygg.worktreeColor.1',
  'ygg.worktreeColor.2',
  'ygg.worktreeColor.3',
  'ygg.worktreeColor.4',
  'ygg.worktreeColor.5',
  'ygg.worktreeColor.6',
  'ygg.worktreeColor.7',
  'ygg.worktreeColor.8',
  'ygg.worktreeColor.9',
];
const CURRENT_COLOR = 'ygg.worktreeColor.current';
// `list.foreground` is not a registered VS Code color id; `foreground` is.
const BASE_COLOR = 'foreground';

// Worktree.path comes verbatim from `git worktree list --porcelain`, which always
// emits forward slashes (even on win32), while item paths are built with
// `path.join` in WorktreeProvider and therefore use platform separators. Normalize
// both sides to forward slashes before comparing so ownership matches on Windows.
function toComparablePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * `FileDecoration.badge` renders at most two characters, so the vocabulary is
 * deliberately tiny: `●` for uncommitted work, `↑n` for commits not yet in the
 * base branch, `●↑` when both are true and there is no room for the count.
 */
function badgeFor(wt: Worktree): string | undefined {
  const ahead = wt.aheadCount ?? 0;
  if (wt.isDirty && ahead > 0) {
    return '●↑';
  }
  if (wt.isDirty) {
    return '●';
  }
  if (ahead > 0) {
    return ahead < 10 ? `↑${ahead}` : '↑';
  }
  return undefined;
}

function worktreeRowTooltip(branch: string, wt: Worktree): string {
  const state: string[] = [];
  if (wt.isDirty) {
    state.push('uncommitted changes');
  }
  const ahead = wt.aheadCount ?? 0;
  if (ahead > 0) {
    state.push(`${ahead} commit${ahead === 1 ? '' : 's'} ahead of base`);
  }
  return state.length > 0 ? `Worktree: ${branch} — ${state.join(', ')}` : `Worktree: ${branch}`;
}

/**
 * Per-worktree colouring is off by default, but it is exactly the affordance a
 * high-contrast user wants, so an untouched setting follows the active theme:
 * on under High Contrast / High Contrast Light, off otherwise. An explicit value
 * — set either way, at any scope — always wins, so turning it off in a
 * high-contrast theme sticks.
 */
export function readWorktreeColorsSetting(): boolean {
  const config = vscode.workspace.getConfiguration('ygg');
  const inspected = config.inspect<boolean>('worktreeColors');
  const explicit =
    inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  if (explicit !== undefined) {
    return explicit;
  }
  return isHighContrastTheme();
}

function isHighContrastTheme(): boolean {
  const kind = vscode.window.activeColorTheme?.kind;
  return (
    kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight
  );
}

/**
 * Persistence for worktree → colour assignments. Without it the shuffle bag is
 * re-rolled on every window, so a worktree that was teal yesterday is orange
 * today — which defeats the point of colouring worktrees at all.
 */
export interface ColorAssignmentStore {
  get(): Record<string, string> | undefined;
  set(assignments: Record<string, string>): void;
}

const NULL_STORE: ColorAssignmentStore = {
  get: () => undefined,
  set: () => {},
};

export class WorktreeDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private assignments = new Map<string, string>(); // worktree.path → colorId (stable)
  private bag: string[] = [];

  private basePath?: string;
  private currentPath?: string;
  private colorsEnabled?: boolean;

  constructor(
    private readonly git: GitService,
    private readonly readColorsEnabled: () => boolean = readWorktreeColorsSetting,
    private readonly store: ColorAssignmentStore = NULL_STORE
  ) {
    const persisted = this.store.get();
    if (persisted) {
      this.assignments = new Map(Object.entries(persisted));
    }
  }

  provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    // Only the synthetic scheme is ever decorated. Real `file:` URIs are
    // deliberately not handled: a decoration follows a URI everywhere it appears
    // in the workbench, so matching real paths would tint the Explorer and the
    // editor tabs too.
    if (uri.scheme !== 'ygg-worktree') {
      return undefined;
    }

    // Parse branch from the SSP (opaque URI format)
    // Opaque URI format: ygg-worktree:branch:<branch-name>?path=<path>
    const ssp = uri.path;
    let branch: string | undefined;

    if (ssp.startsWith('branch:')) {
      branch = decodeURIComponent(ssp.slice(7));
    } else if (uri.authority) {
      branch = uri.authority;
    }

    if (!branch) {
      return undefined;
    }

    const worktrees = this.git.getCachedWorktrees();
    const itemPath = decodeURIComponent(new URLSearchParams(uri.query).get('path') ?? '');
    const comparableItemPath = toComparablePath(itemPath);

    // The owning worktree is needed for both the badge and the colour, so it is
    // resolved before the colour setting is consulted.
    let owner: Worktree | undefined;
    if (worktrees && itemPath) {
      // Find the owning worktree by longest prefix match
      owner = worktrees
        .filter((w) => {
          const comparableWorktreePath = toComparablePath(w.path);
          return (
            comparableItemPath === comparableWorktreePath ||
            comparableItemPath.startsWith(comparableWorktreePath + '/')
          );
        })
        .sort((a, b) => b.path.length - a.path.length)[0];
    }

    // Badges are only used on worktree rows, for dirty / ahead state. File rows
    // do NOT get a status badge: VS Code renders a TreeView badge in its own
    // default colour and ignores `FileDecoration.color` for it, so a status
    // letter here came out grey next to a green or orange icon. The status
    // colour lives on the row icon instead, and the letter rides in the
    // TreeItem description.
    const isWorktreeRow = !!owner && comparableItemPath === toComparablePath(owner.path);
    const badge = isWorktreeRow ? badgeFor(owner!) : undefined;

    const colorId = this.colorsOn()
      ? this.colorIdFor(owner, worktrees, itemPath, branch)
      : undefined;

    if (!colorId && !badge) {
      return undefined;
    }

    return {
      color: colorId ? new vscode.ThemeColor(colorId) : undefined,
      badge,
      tooltip: isWorktreeRow ? worktreeRowTooltip(branch, owner!) : `Worktree: ${branch}`,
    };
  }

  /**
   * The colour assigned to a worktree, or undefined when the colour feature is
   * off. Exposed so the tree can paint the same colour onto the row's *icon*.
   *
   * This exists because of a VS Code rule we cannot opt out of: on the focused
   * row, `list.activeSelectionForeground` overrides a FileDecoration's label
   * colour, so the selected worktree went colourless exactly when the user was
   * looking at it. An icon carries its own colour and is not overridden, so the
   * worktree stays identifiable while selected.
   */
  public colorIdForWorktree(worktreePath: string, branch: string): string | undefined {
    if (!this.colorsOn()) {
      return undefined;
    }
    const worktrees = this.git.getCachedWorktrees();
    if (!worktrees) {
      return this.getRandomColorForWorktree(branch, false);
    }
    const comparable = toComparablePath(worktreePath);
    const owner = worktrees.find((w) => toComparablePath(w.path) === comparable);
    return this.colorIdFor(owner, worktrees, worktreePath, branch);
  }

  private colorIdFor(
    owner: Worktree | undefined,
    worktrees: Worktree[] | undefined,
    itemPath: string,
    branch: string
  ): string {
    if (!worktrees || !itemPath) {
      // No worktree list is available at all here (e.g. during startup, before
      // GitService.getCachedWorktrees() has resolved), so there's no way to map
      // itemPath back to an owning worktree root. itemPath itself is unusable as
      // a shared key: it varies per row (worktree root vs. a nested file/folder
      // path) and may be forward- or back-slashed depending on how the caller
      // built it — keying on it would put a worktree's own row and its files in
      // different `assignments` entries. `branch` is the one value guaranteed
      // identical for every row under the same worktree (it's already validated
      // non-empty by the caller), so use it directly.
      return this.getRandomColorForWorktree(branch, false);
    }

    const { basePath, currentPath } = this.resolveBaseAndCurrent(worktrees);

    if (owner && owner.path === currentPath) {
      return CURRENT_COLOR;
    }
    if (owner && owner.path === basePath) {
      return BASE_COLOR;
    }
    return this.getRandomColorForWorktree(toComparablePath(owner?.path ?? itemPath));
  }

  private resolveBaseAndCurrent(worktrees: Worktree[]) {
    if (this.basePath === undefined || this.currentPath === undefined) {
      this.currentPath = worktrees.find((w) => w.isCurrent)?.path || '';
      const sorted = sortWorktrees(worktrees);
      this.basePath = sorted[0]?.path || '';
    }
    return { basePath: this.basePath, currentPath: this.currentPath };
  }

  private colorsOn(): boolean {
    if (this.colorsEnabled === undefined) {
      this.colorsEnabled = this.readColorsEnabled();
    }
    return this.colorsEnabled;
  }

  /**
   * Drops assignments for worktrees that no longer exist. Without this the map
   * only ever grows: once nine dead entries have accumulated, every colour in
   * the pool counts as "used", the refill below falls back to the whole pool,
   * and colours start repeating between live worktrees — the exact property
   * persisting the map was meant to protect.
   */
  public pruneAssignments(worktrees: Worktree[]): void {
    const live = new Set(worktrees.map((w) => toComparablePath(w.path)));
    let removed = false;
    for (const key of [...this.assignments.keys()]) {
      if (!live.has(key)) {
        this.assignments.delete(key);
        removed = true;
      }
    }
    if (removed) {
      this.store.set(Object.fromEntries(this.assignments));
    }
  }

  /**
   * `persist` is false for the startup fallback that keys on branch name rather
   * than path. That key is a stand-in until the worktree list resolves; writing
   * it would leave a second permanent entry for a worktree that already has one
   * under its real path, so it would consume two slots out of the nine.
   */
  private getRandomColorForWorktree(wtPath: string, persist = true): string {
    const existing = this.assignments.get(wtPath);
    if (existing) {
      return existing;
    }

    if (this.bag.length === 0) {
      // Restored assignments have already claimed part of the pool, so refill
      // from what is left. That keeps "every colour is used before any repeats"
      // true across sessions, not just within one.
      const used = new Set(this.assignments.values());
      const unused = POOL.filter((id) => !used.has(id));
      this.bag = this.shuffle(unused.length > 0 ? unused : [...POOL]);
    }

    const id = this.bag.pop()!;
    this.assignments.set(wtPath, id);
    if (persist) {
      this.store.set(Object.fromEntries(this.assignments));
    }
    return id;
  }

  private shuffle(a: string[]): string[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  public refresh(uri?: vscode.Uri | vscode.Uri[]): void {
    this.basePath = undefined;
    this.currentPath = undefined;
    this.colorsEnabled = undefined;
    this._onDidChangeFileDecorations.fire(uri);
  }
}
