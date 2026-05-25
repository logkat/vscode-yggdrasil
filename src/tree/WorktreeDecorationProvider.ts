import * as vscode from 'vscode';

export class WorktreeDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  // High-contrast VS Code theme colors that are legible across all themes.
  // Replaced deep blue with brighter cyan for better visibility in dark mode.
  private readonly colors = [
    'charts.cyan',
    'charts.purple',
    'charts.red',
    'charts.orange',
    'charts.green',
    'terminal.ansiCyan',
    'terminal.ansiMagenta',
    'terminal.ansiGreen',
    'terminal.ansiBrightRed',
    'terminal.ansiBrightCyan'
  ];

  provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== 'ygg-worktree') { return undefined; }
    
    // Opaque URI format: ygg-worktree:branch:<branch-name>?path=<path>
    // In opaque URIs, the part after the colon is in uri.path
    const ssp = uri.path;
    let branch: string | undefined;

    if (ssp.startsWith('branch:')) {
      branch = decodeURIComponent(ssp.slice(7));
    } else if (uri.authority) {
      // Fallback for authority-based URIs if any exist
      branch = uri.authority;
    }
    
    if (!branch) { 
      return undefined; 
    }

    const colorId = this.getColorForIdentity(branch);

    return {
      color: new vscode.ThemeColor(colorId),
      tooltip: `Worktree: ${branch}`,
    };
  }


  private getColorForIdentity(identity: string): string {
    // DJB2 hash for better distribution
    let hash = 5381;
    for (let i = 0; i < identity.length; i++) {
      hash = ((hash << 5) + hash) + identity.charCodeAt(i);
    }
    const index = Math.abs(hash) % this.colors.length;
    return this.colors[index];
  }

  public refresh(uri?: vscode.Uri | vscode.Uri[]): void {
    this._onDidChangeFileDecorations.fire(uri);
  }
}
