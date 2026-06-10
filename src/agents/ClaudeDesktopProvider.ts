import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentSession, IAgentProvider } from './IAgentProvider';

interface GitWorktreeEntry {
  name: string;
  path: string;
  leasedBy?: string;
  createdAt?: number;
}

interface GitWorktreesJson {
  worktrees?: Record<string, GitWorktreeEntry>;
}

interface DesktopSessionJson {
  sessionId?: string;
  title?: string;
  isArchived?: boolean;
  lastActivityAt?: number;
}

function getClaudeDesktopDir(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'Claude');
    default:
      return path.join(os.homedir(), '.config', 'Claude');
  }
}

export class ClaudeDesktopProvider implements IAgentProvider {
  readonly id = 'claude-desktop';
  readonly label = 'Claude Desktop';

  constructor(
    private readonly desktopDir: string = getClaudeDesktopDir(),
    private readonly readFile: (p: string) => Promise<string> = (p) => fs.promises.readFile(p, 'utf8'),
    private readonly readdir: (p: string) => Promise<string[]> = (p) => fs.promises.readdir(p),
  ) {}

  async getSessions(worktreePath: string): Promise<AgentSession[]> {
    let worktreesData: GitWorktreesJson;
    try {
      worktreesData = JSON.parse(await this.readFile(path.join(this.desktopDir, 'git-worktrees.json')));
    } catch {
      return [];
    }

    const results: AgentSession[] = [];
    for (const wt of Object.values(worktreesData.worktrees ?? {})) {
      if (wt.path !== worktreePath || !wt.leasedBy) { continue; }

      const session: AgentSession = {
        agent: 'claude-desktop',
        agentLabel: 'Claude Desktop',
        sessionId: wt.leasedBy,
        lastActivityAt: wt.createdAt,
      };

      const sessionFileData = await this.findSessionFile(wt.leasedBy);
      if (sessionFileData) {
        session.name = sessionFileData.title || undefined;
        session.isArchived = sessionFileData.isArchived;
        if (sessionFileData.lastActivityAt) {
          session.lastActivityAt = sessionFileData.lastActivityAt;
        }
      }

      results.push(session);
    }
    return results;
  }

  private async findSessionFile(leasedBy: string): Promise<DesktopSessionJson | null> {
    const sessionsBase = path.join(this.desktopDir, 'claude-code-sessions');
    let desktopIds: string[];
    try {
      desktopIds = await this.readdir(sessionsBase);
    } catch {
      return null;
    }
    for (const desktopId of desktopIds) {
      let cliIds: string[];
      try {
        cliIds = await this.readdir(path.join(sessionsBase, desktopId));
      } catch {
        continue;
      }
      for (const cliId of cliIds) {
        try {
          const raw = await this.readFile(path.join(sessionsBase, desktopId, cliId, `${leasedBy}.json`));
          return JSON.parse(raw) as DesktopSessionJson;
        } catch {
          // not in this dir
        }
      }
    }
    return null;
  }
}
