export interface AgentSession {
  agent: string;
  agentLabel: string;
  sessionId: string;
  name?: string;
  status?: 'busy' | 'idle';
  isArchived?: boolean;
  lastActivityAt?: number;
  resumeCommand?: string;
}

export interface IAgentProvider {
  readonly id: string;
  readonly label: string;
  getSessions(worktreePath: string): Promise<AgentSession[]>;
}
