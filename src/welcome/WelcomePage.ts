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

export function showWelcome(context: vscode.ExtensionContext): void {
  if (activePanel) {
    return;
  }
  activePanel = vscode.window.createWebviewPanel(
    'ygg.welcome',
    'Welcome — Yggdrasil',
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  // Without this the branded page sits behind a generic file glyph in the tab.
  activePanel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
  activePanel.webview.html = buildHtml(crypto.randomBytes(16).toString('base64'));
  activePanel.onDidDispose(() => {
    activePanel = undefined;
  });
}

/**
 * Line icons in the same family as the header mark: 24×24, 1.5 stroke, no fill.
 * The page used emoji here, which read as a different visual language from the
 * codicons the rest of the extension is built out of.
 */
const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6"/><line x1="20" y1="20" x2="15.5" y2="15.5"/>',
  commit:
    '<line x1="2" y1="12" x2="8.5" y2="12"/><line x1="15.5" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3.5"/>',
  pin: '<line x1="12" y1="14" x2="12" y2="21"/><path d="M8.5 3.5h7l-1.2 6.6 2.2 3.1H7.5l2.2-3.1z"/>',
  refresh:
    '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><polyline points="18.5 2.5 18.5 6.5 14.5 6.5"/>',
};

function icon(name: keyof typeof ICONS | string, className = 'icon'): string {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
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
      line-height: 1.5;
    }

    /* Centred measure. The page previously clamped to 760px without centring,
       so it clung to the left edge of any wide editor. */
    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 56px 40px 80px;
    }

    /* ── Header ── */
    .header { display: flex; align-items: center; gap: 18px; margin-bottom: 48px; }
    .header-icon {
      width: 52px; height: 52px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      padding: 10px;
    }
    .header-icon svg { width: 100%; height: 100%; }
    h1 { font-size: 1.9em; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
    .tagline { color: var(--vscode-descriptionForeground); margin-top: 4px; }

    /* ── Sections ── */
    section { margin-bottom: 44px; }
    section:last-child { margin-bottom: 0; }
    h2 {
      font-size: 0.72em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 18px;
    }

    /* ── Steps ── */
    .steps { display: flex; flex-direction: column; gap: 14px; }
    .step { display: flex; align-items: flex-start; gap: 14px; }
    .step-num {
      width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 0.75em; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-text { padding-top: 2px; }
    .step-text strong { color: var(--vscode-foreground); font-weight: 600; }

    /* ── Commands table ── */
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      font-size: 0.75em; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      padding: 0 12px 8px 0;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    td {
      padding: 10px 12px 10px 0;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      vertical-align: top;
    }
    tr:last-child td { border-bottom: none; }
    td:last-child { color: var(--vscode-descriptionForeground); }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.88em;
      background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
      padding: 2px 6px;
      border-radius: 4px;
      /* A long command name wraps inside its table cell; without this the pill
         background is sliced flat on the break instead of rounding both parts. */
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }

    /* ── Tips ──
       Nested enclosure: an outer tray holds each inner card, so the tips read as
       one machined block rather than four floating slabs. */
    .tips {
      display: flex; flex-direction: column; gap: 6px;
      padding: 6px;
      background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.06));
      border-radius: 14px;
    }
    .tip {
      display: flex; gap: 12px; align-items: flex-start;
      padding: 14px 16px;
      background: var(--vscode-editor-background);
      border-radius: 9px;
    }
    .tip strong { font-weight: 600; }
    .icon {
      width: 17px; height: 17px;
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--vscode-textLink-foreground);
    }
    /* Inline icon used mid-sentence, sized to sit on the text baseline. */
    .icon-inline {
      width: 14px; height: 14px;
      display: inline-block;
      vertical-align: -2px;
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
    }

    /* Entry motion: one gentle staggered settle on open, disabled for anyone who
       asked the OS to stop animating things. */
    .header, section { animation: rise 620ms cubic-bezier(0.22, 0.75, 0.15, 1) both; }
    section:nth-of-type(1) { animation-delay: 70ms; }
    section:nth-of-type(2) { animation-delay: 140ms; }
    section:nth-of-type(3) { animation-delay: 210ms; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .header, section { animation: none; }
    }

    @media (max-width: 620px) {
      .page { padding: 32px 20px 48px; }
      .header { gap: 14px; margin-bottom: 36px; }
      h1 { font-size: 1.6em; }
    }
  </style>
</head>
<body>
<div class="page">

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
        <div class="step-text">Click the <strong>switch button</strong> on any worktree to open it — choose new window, replace, or add to workspace.</div>
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
          <td><code>ygg: Set Base Branch…</code></td>
          <td>Choose the branch a worktree is compared against</td>
        </tr>
        <tr>
          <td><code>ygg: Clear Remembered Switch Mode</code></td>
          <td>Forget the pinned open mode so the dialog shows again</td>
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
        ${icon('search')}
        <span><strong>Branch Diff Explorer:</strong> Expand any worktree to see every change — committed, staged, and untracked — relative to its base branch.</span>
      </div>
      <div class="tip">
        ${icon('commit')}
        <span><strong>Ahead of base:</strong> A blue commit icon ${icon('commit', 'icon-inline')} means the branch is clean but has commits your base branch doesn't. A badge on the row shows how many.</span>
      </div>
      <div class="tip">
        ${icon('pin')}
        <span><strong>Pin an open mode:</strong> Use the pin button in the switch dialog and the inline switch button will skip the dialog from then on.</span>
      </div>
      <div class="tip">
        ${icon('refresh')}
        <span><strong>Stays current:</strong> The panel auto-refreshes when worktrees or branches change. Use <strong>Refresh</strong> in the panel toolbar if you want to force it.</span>
      </div>
    </div>
  </section>

</div>
</body>
</html>`;
}
