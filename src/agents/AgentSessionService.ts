import { AgentSession, IAgentProvider } from './IAgentProvider';

export class AgentSessionService {
  constructor(private readonly providers: IAgentProvider[]) {}

  async getSessionsForWorktree(worktreePath: string): Promise<AgentSession[]> {
    const settled = await Promise.allSettled(
      this.providers.map(p => p.getSessions(worktreePath))
    );

    const all: AgentSession[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        all.push(...result.value);
      }
    }

    return all.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  }
}
