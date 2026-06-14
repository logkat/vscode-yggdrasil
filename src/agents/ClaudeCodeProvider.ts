import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentSession, IAgentProvider } from './IAgentProvider';

interface RawSession {
  sessionId?: string;
  cwd?: string;
  name?: string;
  status?: string;
  updatedAt?: number;
}

export class ClaudeCodeProvider implements IAgentProvider {
  readonly id = 'claude-code';
  readonly label = 'Claude Code';

  constructor(
    private readonly sessionsDir: string = path.join(os.homedir(), '.claude', 'sessions'),
    private readonly readFile: (p: string) => Promise<string> = (p) =>
      fs.promises.readFile(p, 'utf8'),
    private readonly readdir: (p: string) => Promise<string[]> = (p) => fs.promises.readdir(p)
  ) {}

  async getSessions(worktreePath: string): Promise<AgentSession[]> {
    let files: string[];
    try {
      files = await this.readdir(this.sessionsDir);
    } catch {
      return [];
    }

    const results: AgentSession[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }
      try {
        const raw: RawSession = JSON.parse(await this.readFile(path.join(this.sessionsDir, file)));
        if (!raw.sessionId || !raw.cwd) {
          continue;
        }
        const norm = (p: string): string => path.resolve(p).replace(/[/\\]+$/, '');
        if (norm(raw.cwd) !== norm(worktreePath)) {
          continue;
        }
        results.push({
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          sessionId: raw.sessionId,
          name: raw.name || undefined,
          status: raw.status === 'busy' || raw.status === 'idle' ? raw.status : undefined,
          lastActivityAt: raw.updatedAt,
          resumeCommand: `claude --resume ${raw.sessionId}`,
        });
      } catch {
        // skip malformed files
      }
    }
    return results;
  }
}
