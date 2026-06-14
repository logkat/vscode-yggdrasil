import * as crypto from 'crypto';
import * as vscode from 'vscode';

const WELCOMED_KEY = 'ygg.welcomed';
let shownInThisSession = false;

export async function maybeShowWelcome(context: vscode.ExtensionContext): Promise<void> {
  if (shownInThisSession) {
    return;
  }

  const alreadyWelcomed = context.globalState.get<boolean>(WELCOMED_KEY);
  if (!alreadyWelcomed) {
    shownInThisSession = true;
    await context.globalState.update(WELCOMED_KEY, true);
    showWelcome(context);
  }
}

let activePanel: vscode.WebviewPanel | undefined;

export function showWelcome(_context: vscode.ExtensionContext): void {
  if (activePanel) {
    return;
  }
  activePanel = vscode.window.createWebviewPanel(
    'ygg.welcome',
    'Welcome — Yggdrasil',
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  activePanel.webview.html = buildHtml(crypto.randomBytes(16).toString('base64'));
  activePanel.onDidDispose(() => {
    activePanel = undefined;
  });
}

function buildHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}';">
  <title>Welcome — Yggdrasil</title>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 48px 64px;
      max-width: 760px;
    }

    /* ── Header ── */
    .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
    .header-icon {
      width: 48px; height: 48px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      padding: 8px;
    }
    .header-icon svg { width: 100%; height: 100%; }
    h1 { font-size: 1.8em; font-weight: 600; letter-spacing: -0.02em; }
    .tagline { color: var(--vscode-descriptionForeground); margin-top: 2px; font-size: 0.95em; }

    /* ── Sections ── */
    section { margin-bottom: 36px; }
    h2 {
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 14px;
    }

    /* ── Steps ── */
    .steps { display: flex; flex-direction: column; gap: 12px; }
    .step { display: flex; align-items: flex-start; gap: 14px; }
    .step-num {
      width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 0.75em; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-text { padding-top: 3px; line-height: 1.5; }
    .step-text strong { color: var(--vscode-foreground); }

    /* ── Commands table ── */
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      font-size: 0.75em; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      padding: 6px 12px 6px 0;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    td {
      padding: 8px 12px 8px 0;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      vertical-align: top;
    }
    td:last-child { color: var(--vscode-descriptionForeground); }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.88em;
      background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
      padding: 2px 6px;
      border-radius: 3px;
    }

    /* ── Tips ── */
    .tips { display: flex; flex-direction: column; gap: 10px; }
    .tip {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 10px 14px;
      background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
      border-left: 3px solid var(--vscode-button-background);
      border-radius: 0 4px 4px 0;
      line-height: 1.5;
    }
    .tip-icon { flex-shrink: 0; margin-top: 1px; }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="12" y1="21" x2="12" y2="3"/>
      <line x1="12" y1="6" x2="18" y2="6"/>
      <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none"/>
      <line x1="12" y1="12" x2="6" y2="12"/>
      <circle cx="6" cy="12" r="2" fill="currentColor" stroke="none"/>
      <line x1="12" y1="18" x2="18" y2="18"/>
      <circle cx="18" cy="18" r="2" fill="currentColor" stroke="none"/>
    </svg></div>
    <div>
      <h1>Yggdrasil</h1>
      <div class="tagline">Git Worktree Explorer for VS Code</div>
    </div>
  </div>

  <section>
    <h2>Get Started</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">Open a folder that is a <strong>git repository</strong> — Yggdrasil reads your worktrees from it.</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">Click the <strong>Yggdrasil icon</strong> in the Activity Bar (left sidebar) to open the worktree panel.</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">Click the <strong>⇄ switch button</strong> on any worktree to open it — choose new window, replace, or add to workspace.</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Commands</h2>
    <table>
      <thead>
        <tr><th>Command</th><th>What it does</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><code>ygg: Switch Worktree…</code></td>
          <td>Pick a worktree and open mode from the Command Palette</td>
        </tr>
        <tr>
          <td><code>ygg: Add Worktree</code></td>
          <td>Create a new worktree for an existing or new branch</td>
        </tr>
        <tr>
          <td><code>ygg: Prune Missing Worktrees</code></td>
          <td>Run git worktree prune to clean up deleted worktree entries</td>
        </tr>
        <tr>
          <td><code>ygg: Set Base Branch...</code></td>
          <td>Configure a specific branch to compare a worktree against</td>
        </tr>
        <tr>
          <td><code>ygg: Clear Remembered Switch Mode</code></td>
          <td>Forget the remembered open mode so the dialog shows again</td>
        </tr>
        <tr>
          <td><code>ygg: Welcome</code></td>
          <td>Reopen this page</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Tips</h2>
    <div class="tips">
      <div class="tip">
        <span class="tip-icon">🔎</span>
        <span><strong>Branch Diff Explorer:</strong> Expand any worktree to see ALL changes (committed, staged, and untracked) relative to its base.</span>
      </div>
      <div class="tip">
        <span class="tip-icon">📊</span>
        <span><strong>Ahead-of-Base:</strong> A blue <span style="font-family: monospace;">$(git-commit)</span> icon means a branch is clean but has commits not yet in its base branch.</span>
      </div>
      <div class="tip">
        <span class="tip-icon">📌</span>
        <span>Pin your preferred open mode in the switch dialog — the inline button will skip the dialog from then on.</span>
      </div>
      <div class="tip">
        <span class="tip-icon">🔄</span>
        <span>The panel <strong>auto-refreshes</strong> when worktrees or branches change. Use <strong>Refresh</strong> in the panel toolbar if needed.</span>
      </div>
    </div>
  </section>

</body>
</html>`;
}
