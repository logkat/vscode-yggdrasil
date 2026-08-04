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
const BASE_COLOR = 'list.foreground';

export function readWorktreeColorsSetting(): boolean {
  return vscode.workspace.getConfiguration('ygg').get<boolean>('worktreeColors', false);
}

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
    private readonly readColorsEnabled: () => boolean = readWorktreeColorsSetting
  ) {}

  provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
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

    if (!this.colorsOn()) {
      return undefined;
    }

    const worktrees = this.git.getCachedWorktrees();
    const itemPath = decodeURIComponent(new URLSearchParams(uri.query).get('path') ?? '');

    let colorId: string;
    if (worktrees && itemPath) {
      // Find the owning worktree by longest prefix match
      const owner = worktrees
        .filter((w) => itemPath === w.path || itemPath.startsWith(w.path + '/'))
        .sort((a, b) => b.path.length - a.path.length)[0];

      const { basePath, currentPath } = this.resolveBaseAndCurrent(worktrees);

      if (owner && owner.path === currentPath) {
        colorId = CURRENT_COLOR;
      } else if (owner && owner.path === basePath) {
        colorId = BASE_COLOR;
      } else {
        colorId = this.getRandomColorForWorktree(owner?.path ?? itemPath);
      }
    } else {
      colorId = this.getRandomColorForWorktree(itemPath || branch);
    }

    return {
      color: new vscode.ThemeColor(colorId),
      tooltip: `Worktree: ${branch}`,
    };
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

  private getRandomColorForWorktree(wtPath: string): string {
    const existing = this.assignments.get(wtPath);
    if (existing) {
      return existing;
    }

    if (this.bag.length === 0) {
      this.bag = this.shuffle([...POOL]);
    }

    const id = this.bag.pop()!;
    this.assignments.set(wtPath, id);
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
