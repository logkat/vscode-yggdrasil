import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { GitService, escapeHtml } from '../git/GitService';
import { WorktreeItem, WorktreeProvider } from '../tree/WorktreeProvider';

type SwitchMode = 'newWindow' | 'replace' | 'addWorkspace';
const STATE_KEY = 'yggdrasil.switchMode';

export type WebviewPanelFactory = (
  title: string,
  html: string,
  onMessage: (msg: unknown) => void
) => vscode.Disposable;

export class CommandRegistry {
  private statusBarItem: vscode.StatusBarItem | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitService,
    private readonly provider: WorktreeProvider,
    private readonly createWebviewPanel: WebviewPanelFactory = defaultWebviewFactory
  ) {}

  register(): vscode.Disposable[] {
    this.restoreStatusBar();

    return [
      vscode.commands.registerCommand('yggdrasil.refresh', () => {
        this.git.invalidateCache();
        this.provider.refresh();
      }),

      vscode.commands.registerCommand('yggdrasil.switch', (item: WorktreeItem) =>
        this.switchWorktree(item)
      ),

      vscode.commands.registerCommand('yggdrasil.add', () => this.addWorktree()),

      vscode.commands.registerCommand('yggdrasil.remove', (item: WorktreeItem) =>
        this.removeWorktree(item)
      ),

      vscode.commands.registerCommand('yggdrasil.copyPath', (item: WorktreeItem) => {
        vscode.env.clipboard.writeText(item.worktree.path);
      }),

      vscode.commands.registerCommand('yggdrasil.revealInOs', (item: WorktreeItem) => {
        vscode.commands.executeCommand(
          'revealFileInOS',
          vscode.Uri.file(item.worktree.path)
        );
      }),
    ];
  }

  private async switchWorktree(item: WorktreeItem): Promise<void> {
    const stored = this.context.globalState.get<SwitchMode>(STATE_KEY);
    let mode: SwitchMode;

    if (stored) {
      mode = stored;
    } else {
      const result = await this.promptSwitchMode(item.worktree.branch, item.worktree.path);
      if (!result) { return; }
      mode = result.mode;
      if (result.remember) {
        await this.context.globalState.update(STATE_KEY, mode);
        this.showStatusBar(mode);
      }
    }

    const uri = vscode.Uri.file(item.worktree.path);
    switch (mode) {
      case 'newWindow':
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
        break;
      case 'replace':
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
        break;
      case 'addWorkspace':
        vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders?.length ?? 0,
          0,
          { uri }
        );
        break;
    }
  }

  private promptSwitchMode(
    branch: string,
    wtPath: string
  ): Promise<{ mode: SwitchMode; remember: boolean } | undefined> {
    return new Promise((resolve) => {
      const nonce = crypto.randomBytes(16).toString('base64');
      const html = buildSwitchHtml(nonce, branch, wtPath);

      const disposable = this.createWebviewPanel(
        `Switch Worktree: ${branch}`,
        html,
        (msg: unknown) => {
          if (!isWebviewMessage(msg)) { return; }
          disposable.dispose();
          if (msg.action === 'cancel') {
            resolve(undefined);
          } else if (msg.action === 'open' && isValidMode(msg.mode)) {
            resolve({ mode: msg.mode, remember: msg.remember === true });
          }
        }
      );
    });
  }

  private async addWorktree(): Promise<void> {
    const kind = await vscode.window.showQuickPick(
      ['Existing branch', 'New branch'],
      { placeHolder: 'Choose branch type' }
    );
    if (!kind) { return; }

    const isNew = kind === 'New branch';
    const branch = await vscode.window.showInputBox({ prompt: 'Branch name' });
    if (!branch) { return; }

    const defaultPath = `../${branch.replace(/\//g, '-')}`;
    const wtPath = await vscode.window.showInputBox({
      prompt: 'Worktree path',
      value: defaultPath,
    });
    if (!wtPath) { return; }

    try {
      await this.git.addWorktree(wtPath, branch, isNew);
      this.provider.refresh();
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Add worktree failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async removeWorktree(item: WorktreeItem): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `Remove worktree '${item.worktree.branch}'?`,
      { modal: true },
      'Remove'
    );
    if (answer !== 'Remove') { return; }

    try {
      await this.git.removeWorktree(item.worktree.path);
      this.provider.refresh();
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Remove worktree failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private restoreStatusBar(): void {
    const stored = this.context.globalState.get<SwitchMode>(STATE_KEY);
    if (stored) { this.showStatusBar(stored); }
  }

  private showStatusBar(mode: SwitchMode): void {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
      );
    }
    const labels: Record<SwitchMode, string> = {
      newWindow: 'New Window',
      replace: 'Replace Window',
      addWorkspace: 'Add to Workspace',
    };
    this.statusBarItem.text = `$(git-branch) Worktree: ${labels[mode]} ×`;
    this.statusBarItem.tooltip = 'Click to clear remembered worktree switch mode';
    this.statusBarItem.command = 'yggdrasil._clearSwitchMode';
    this.statusBarItem.show();

    vscode.commands.registerCommand('yggdrasil._clearSwitchMode', async () => {
      await this.context.globalState.update(STATE_KEY, undefined);
      this.statusBarItem?.hide();
      this.statusBarItem?.dispose();
      this.statusBarItem = undefined;
    });
  }
}

// --- helpers ---

interface WebviewMessage {
  action: string;
  mode?: string;
  remember?: boolean;
}

function isWebviewMessage(v: unknown): v is WebviewMessage {
  return typeof v === 'object' && v !== null && 'action' in v;
}

function isValidMode(v: string | undefined): v is SwitchMode {
  return v === 'newWindow' || v === 'replace' || v === 'addWorkspace';
}

function buildSwitchHtml(nonce: string, branch: string, wtPath: string): string {
  const safeBranch = escapeHtml(branch);
  const safePath = escapeHtml(wtPath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Switch Worktree</title>
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
      max-width: 480px;
    }
    h2 { margin-top: 0; font-size: 1.1em; }
    .path { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 20px; }
    .option { display: flex; align-items: center; gap: 10px; margin: 12px 0; cursor: pointer; }
    .option input[type=radio] { accent-color: var(--vscode-button-background); }
    .remember { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
    .remember input[type=checkbox] { accent-color: var(--vscode-button-background); }
    .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
    button {
      padding: 6px 16px;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
    }
    #btn-open {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #btn-open:hover { background: var(--vscode-button-hoverBackground); }
    #btn-cancel {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    #btn-cancel:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <h2>Open worktree: ${safeBranch}</h2>
  <div class="path">${safePath}</div>

  <label class="option">
    <input type="radio" name="mode" value="newWindow" checked>
    Open in New Window
  </label>
  <label class="option">
    <input type="radio" name="mode" value="replace">
    Replace Current Window
  </label>
  <label class="option">
    <input type="radio" name="mode" value="addWorkspace">
    Add to Workspace
  </label>

  <label class="remember">
    <input type="checkbox" id="remember">
    Remember my choice
  </label>

  <div class="actions">
    <button id="btn-cancel">Cancel</button>
    <button id="btn-open">Open</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('btn-open').addEventListener('click', () => {
      const mode = document.querySelector('input[name=mode]:checked').value;
      const remember = document.getElementById('remember').checked;
      vscode.postMessage({ action: 'open', mode, remember });
    });
    document.getElementById('btn-cancel').addEventListener('click', () => {
      vscode.postMessage({ action: 'cancel' });
    });
  </script>
</body>
</html>`;
}

function defaultWebviewFactory(
  title: string,
  html: string,
  onMessage: (msg: unknown) => void
): vscode.Disposable {
  const panel = vscode.window.createWebviewPanel(
    'yggdrasil.switch',
    title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false }
  );
  panel.webview.html = html;
  const sub = panel.webview.onDidReceiveMessage(onMessage);
  return {
    dispose: () => {
      sub.dispose();
      panel.dispose();
    },
  };
}
