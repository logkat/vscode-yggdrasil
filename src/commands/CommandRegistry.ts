import * as vscode from 'vscode';
import { GitService } from '../git/GitService';
import { WorktreeItem, WorktreeFileItem, WorktreeProvider } from '../tree/WorktreeProvider';
import { makeUri } from '../content/YggContentProvider';
import {
  StatusBarManager,
  SwitchMode,
  SWITCH_MODE_STATE_KEY,
  sanitizeBranchForPath,
} from './StatusBarManager';
import { AgentSession } from '../agents/IAgentProvider';
import { AgentSessionService } from '../agents/AgentSessionService';
import { readWorktreeColorsSetting } from '../tree/WorktreeDecorationProvider';

/**
 * Confirmation for actions whose result is already visible (a clipboard write, a
 * finished refresh). A notification toast demands dismissal and stacks up; the
 * status bar says the same thing and gets out of the way.
 */
function toast(message: string): void {
  vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
}

export class CommandRegistry implements vscode.Disposable {
  private readonly statusBar: StatusBarManager;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitService,
    private readonly provider: WorktreeProvider,
    private readonly agentService?: AgentSessionService
  ) {
    this.statusBar = new StatusBarManager(context, git);
  }

  register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    disposables.push(...this.statusBar.initialize());

    disposables.push(
      vscode.commands.registerCommand('ygg.refresh', () => {
        this.git.invalidateCache();
        this.provider.refresh();
        this.updateWorktreeStatusBar();
      })
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.switch', (item?: WorktreeItem) =>
        this.switchWorktree(item)
      )
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.selectAndSwitch', () => this.selectAndSwitch())
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.clearSwitchMode', () => this.clearSwitchMode())
    );

    disposables.push(vscode.commands.registerCommand('ygg.add', () => this.addWorktree()));

    disposables.push(vscode.commands.registerCommand('ygg.prune', () => this.pruneWorktrees()));

    disposables.push(
      vscode.commands.registerCommand('ygg.setBaseBranch', (item?: WorktreeItem) =>
        this.setBaseBranch(item)
      )
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.remove', (item?: WorktreeItem) =>
        this.removeWorktree(item)
      )
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.copyPath', (item?: WorktreeItem) => {
        if (!item || item.worktree.isVirtual) {
          return;
        }
        vscode.env.clipboard.writeText(item.worktree.path);
      })
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.revealInOs', (item?: WorktreeItem) => {
        if (!item || item.worktree.isVirtual) {
          return;
        }
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.worktree.path));
      })
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.openDiff', (item?: WorktreeFileItem) =>
        this.openDiff(item)
      )
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.copyAgentResumeCommand', (session: AgentSession) => {
        const text = session.resumeCommand ?? session.sessionId;
        vscode.env.clipboard.writeText(text);
        toast('Resume command copied');
      })
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.copyAgentSessionId', (session: AgentSession) => {
        vscode.env.clipboard.writeText(session.sessionId);
        toast('Session ID copied');
      })
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.detectAgentProviders', async () =>
        this.detectAgentProviders()
      )
    );

    disposables.push(
      vscode.commands.registerCommand('ygg.toggleWorktreeColors', async () =>
        this.toggleWorktreeColors()
      )
    );

    return disposables;
  }

  private async switchWorktree(item?: WorktreeItem): Promise<void> {
    if (!item) {
      return;
    }

    if (item.worktree.isVirtual) {
      const resp = await vscode.window.showInformationMessage(
        `Branch '${item.worktree.branch}' is not checked out.`,
        'Create Worktree...'
      );
      if (resp === 'Create Worktree...') {
        this.addWorktree(item.worktree.branch);
      }
      return;
    }

    const stored = this.context.globalState.get<SwitchMode>(SWITCH_MODE_STATE_KEY);
    let mode: SwitchMode;
    if (stored) {
      mode = stored;
    } else {
      const result = await this.promptSwitchMode(item.worktree.branch, item.worktree.path);
      if (!result) {
        return;
      }
      mode = result.mode;
      if (result.remember) {
        await this.context.globalState.update(SWITCH_MODE_STATE_KEY, mode);
        this.statusBar.showSwitchMode(mode);
      }
    }
    await this.openWorktree(item.worktree.path, mode);
  }

  private async selectAndSwitch(): Promise<void> {
    const all = await this.git.listWorktrees();
    // A bare repo has no working tree to open — offering it as a switch target
    // produced a dialog titled "Open worktree: (bare)".
    const candidates = all.filter(
      (wt) => !wt.isCurrent && wt.pathExists && !wt.isVirtual && !wt.bare
    );
    if (candidates.length === 0) {
      vscode.window.showInformationMessage('No other worktrees to switch to.');
      return;
    }
    const picks = candidates.map((wt) => ({ label: wt.branch, description: wt.path, wt }));
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select worktree to switch to',
    });
    if (!picked) {
      return;
    }

    const result = await this.promptSwitchMode(picked.wt.branch, picked.wt.path);
    if (!result) {
      return;
    }
    if (result.remember) {
      await this.context.globalState.update(SWITCH_MODE_STATE_KEY, result.mode);
      this.statusBar.showSwitchMode(result.mode);
    }
    await this.openWorktree(picked.wt.path, result.mode);
  }

  private async openWorktree(wtPath: string, mode: SwitchMode): Promise<void> {
    const uri = vscode.Uri.file(wtPath);
    try {
      switch (mode) {
        case 'newWindow':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
          break;
        case 'replace':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
          break;
        case 'addWorkspace':
          vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length ?? 0,
            0,
            { uri }
          );
          break;
      }
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `Failed to open worktree: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Three modes, each with a pin button that also saves the choice as the
   * default. The previous version listed all three twice — once to act, once to
   * "save as default" — and hard-space-padded the labels to fake column
   * alignment in a proportional font, which never actually aligned.
   */
  private promptSwitchMode(
    branch: string,
    wtPath: string
  ): Promise<{ mode: SwitchMode; remember: boolean } | undefined> {
    interface ModeItem extends vscode.QuickPickItem {
      mode: SwitchMode;
    }

    const pin: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('pin'),
      tooltip: 'Always use this mode and skip this dialog',
    };

    const items: ModeItem[] = [
      {
        label: '$(window) New Window',
        description: 'Open in a new VS Code window',
        mode: 'newWindow',
        buttons: [pin],
      },
      {
        label: '$(replace-all) Replace Window',
        description: 'Reuse this VS Code window',
        mode: 'replace',
        buttons: [pin],
      },
      {
        label: '$(add) Add to Workspace',
        description: 'Add folder to the current workspace',
        mode: 'addWorkspace',
        buttons: [pin],
      },
    ];

    return new Promise((resolve) => {
      const qp = vscode.window.createQuickPick<ModeItem>();
      qp.title = `Open worktree: ${branch}`;
      qp.placeholder = wtPath;
      qp.items = items;

      let settled = false;
      const settle = (result: { mode: SwitchMode; remember: boolean } | undefined): void => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
        qp.hide();
      };

      qp.onDidAccept(() => {
        const picked = qp.selectedItems[0];
        settle(picked ? { mode: picked.mode, remember: false } : undefined);
      });
      qp.onDidTriggerItemButton((e) => settle({ mode: e.item.mode, remember: true }));
      qp.onDidHide(() => {
        settle(undefined);
        qp.dispose();
      });

      qp.show();
    });
  }

  private async addWorktree(prefillBranch?: string): Promise<void> {
    const kind = prefillBranch
      ? 'Existing branch'
      : await vscode.window.showQuickPick(['Existing branch', 'New branch'], {
          placeHolder: 'Choose branch type',
        });
    if (!kind) {
      return;
    }

    const isNew = kind === 'New branch';
    const branch = prefillBranch || (await vscode.window.showInputBox({ prompt: 'Branch name' }));
    if (!branch) {
      return;
    }

    const safeBranch = sanitizeBranchForPath(branch);

    const locations = [
      { label: 'Parent directory', detail: `../${safeBranch}`, value: `../${safeBranch}` },
      {
        label: 'Nested (.worktrees)',
        detail: `.worktrees/${safeBranch}`,
        value: `.worktrees/${safeBranch}`,
      },
      {
        label: 'Agent (.agent/worktrees)',
        detail: `.agent/worktrees/${safeBranch}`,
        value: `.agent/worktrees/${safeBranch}`,
      },
      { label: 'Custom...', detail: 'Enter a custom path', value: 'custom' },
    ];

    const pickedLocation = await vscode.window.showQuickPick(locations, {
      placeHolder: 'Where to create the worktree?',
    });
    if (!pickedLocation) {
      return;
    }

    let wtPath: string | undefined;
    if (pickedLocation.value === 'custom') {
      wtPath = await vscode.window.showInputBox({
        prompt: 'Worktree path',
        value: `../${safeBranch}`,
      });
    } else {
      wtPath = pickedLocation.value;
    }

    if (!wtPath) {
      return;
    }

    try {
      // `git worktree add` does a full checkout, so this is the one command here
      // that can take real seconds. Without progress the window just sits there.
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating worktree '${branch}'…` },
        () => this.git.addWorktree(wtPath!, branch, isNew)
      );
      this.provider.refresh();
      toast(`Worktree '${branch}' created`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `Add worktree failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async pruneWorktrees(): Promise<void> {
    try {
      await vscode.window.withProgress({ location: { viewId: 'ygg.worktrees' } }, () =>
        this.git.pruneWorktrees()
      );
      this.provider.refresh();
      toast('Missing worktrees pruned');
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `Prune failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async setBaseBranch(item?: WorktreeItem): Promise<void> {
    if (item) {
      const wtPath = item.worktree.path;
      const currentBase = this.context.workspaceState.get<string>(`ygg.baseBranch:${wtPath}`);

      // The point of this command is choosing a branch, so it lists the branches
      // — most recently committed first — instead of offering only "Clear" and
      // "Custom…" and making the user type a name they have to remember.
      const branches = await this.git.listBranches().catch(() => [] as string[]);

      type BaseItem = vscode.QuickPickItem & { branch?: string; clear?: boolean; custom?: boolean };
      const options: BaseItem[] = [
        {
          label: '$(close) Clear (use default)',
          description: 'Reset to global setting or upstream',
          clear: true,
        },
        { label: '$(edit) Custom…', description: 'Enter a branch name manually', custom: true },
      ];

      if (branches.length > 0) {
        options.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
        for (const branch of branches) {
          options.push({
            label: `$(git-branch) ${branch}`,
            description: branch === currentBase ? 'current base' : undefined,
            branch,
          });
        }
      }

      const picked = await vscode.window.showQuickPick(options, {
        title: `Set Base Branch for ${item.worktree.branch}`,
        placeHolder: currentBase ? `Current: ${currentBase}` : 'Select a base branch',
      });

      if (!picked) {
        return;
      }

      let newBase: string | undefined;
      if (picked.clear) {
        newBase = undefined;
      } else if (picked.branch) {
        newBase = picked.branch;
      } else {
        newBase = await vscode.window.showInputBox({
          prompt: `Enter base branch for ${item.worktree.branch}`,
          value: currentBase || 'main',
        });
        if (!newBase) {
          return;
        }
      }

      await this.context.workspaceState.update(`ygg.baseBranch:${wtPath}`, newBase);
    } else {
      // Global configuration
      const config = vscode.workspace.getConfiguration('ygg');
      const currentGlobal = config.get<string>('baseBranch');

      const newBase = await vscode.window.showInputBox({
        title: 'Set Global Default Branch',
        prompt: 'Enter the branch name to use as default for this repository',
        value: currentGlobal || 'main',
        placeHolder: 'e.g. main, develop, master',
      });

      if (newBase === undefined) {
        return;
      }
      await config.update('baseBranch', newBase, vscode.ConfigurationTarget.Workspace);
    }
    this.provider.refresh();
  }

  private async removeWorktree(item?: WorktreeItem): Promise<void> {
    if (!item || item.worktree.isVirtual) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Remove worktree '${item.worktree.branch}'?`,
      { modal: true },
      'Remove'
    );
    if (answer !== 'Remove') {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Removing worktree '${item.worktree.branch}'…`,
        },
        () => this.git.removeWorktree(item.worktree.path)
      );
      this.provider.refresh();
      toast(`Worktree '${item.worktree.branch}' removed`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `Remove worktree failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async openDiff(item?: WorktreeFileItem): Promise<void> {
    if (!item) {
      return;
    }
    const { file, worktreePath, branch, baseSha } = item;
    const baseUri = makeUri('BASE', worktreePath, file.relativePath, baseSha);
    const workUri = makeUri('WORK', worktreePath, file.relativePath);
    const title = `${branch} — ${file.relativePath} (branch base ↔ working tree)`;

    try {
      await vscode.commands.executeCommand('vscode.diff', baseUri, workUri, title, {
        preview: true,
      });
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `Failed to open diff: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async clearSwitchMode(): Promise<void> {
    const had = this.context.globalState.get<SwitchMode>(SWITCH_MODE_STATE_KEY);
    await this.context.globalState.update(SWITCH_MODE_STATE_KEY, undefined);
    this.statusBar.clearSwitchMode();
    if (!had) {
      vscode.window.showInformationMessage('No remembered switch mode to clear.');
    }
  }

  public async updateWorktreeStatusBar(): Promise<void> {
    await this.statusBar.refreshWorktreeName();
  }

  /**
   * Flips `ygg.worktreeColors`, writing an explicit value. That matters when the
   * setting is currently unset and only on because the theme is high contrast:
   * toggling then has to record an explicit `false`, or the next read would
   * follow the theme straight back to on.
   */
  private async toggleWorktreeColors(): Promise<void> {
    const config = vscode.workspace.getConfiguration('ygg');
    const inspected = config.inspect<boolean>('worktreeColors');
    // Write to the scope that actually wins when the value is read, highest
    // precedence first. Writing Global while a folder-scoped value exists would
    // leave the folder value in charge — the toast would claim a change that
    // never reached the screen.
    const target =
      inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;

    const next = !readWorktreeColorsSetting();
    await config.update('worktreeColors', next, target);
    toast(`Worktree colours ${next ? 'on' : 'off'}`);
  }

  private async detectAgentProviders(): Promise<void> {
    const detected: string[] = [];
    const { promises: fsp } = await import('fs');
    const os = await import('os');
    const path = await import('path');

    try {
      await fsp.access(path.join(os.homedir(), '.claude', 'sessions'));
      detected.push('claude-code');
    } catch {
      /* not installed */
    }

    const desktopDir = (() => {
      switch (process.platform) {
        case 'darwin':
          return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
        case 'win32':
          return path.join(process.env.APPDATA ?? os.homedir(), 'Claude');
        default:
          return path.join(os.homedir(), '.config', 'Claude');
      }
    })();
    try {
      await fsp.access(path.join(desktopDir, 'git-worktrees.json'));
      detected.push('claude-desktop');
    } catch {
      /* not installed */
    }

    if (detected.length === 0) {
      vscode.window.showInformationMessage('No supported coding agents detected.');
      return;
    }
    const config = vscode.workspace.getConfiguration('ygg');
    const inspected = config.inspect<string[]>('agentProviders');
    const target =
      inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('agentProviders', detected, target);
    vscode.window.showInformationMessage(
      `Detected agents: ${detected.join(', ')}. Updated ygg.agentProviders.`
    );
  }

  dispose(): void {
    this.statusBar.dispose();
  }
}
