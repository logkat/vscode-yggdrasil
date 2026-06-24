import * as assert from 'assert';
import { AgentSessionService } from '../../agents/AgentSessionService';
import { AgentSession, IAgentProvider } from '../../agents/IAgentProvider';

function fakeProvider(id: string, sessions: AgentSession[]): IAgentProvider {
  return { id, label: id, getSessions: async () => sessions };
}

function makeSession(sessionId: string, lastActivityAt: number, agent = 'test'): AgentSession {
  return { agent, agentLabel: agent, sessionId, lastActivityAt };
}

suite('AgentSessionService', () => {
  test('returns empty array with no providers', async () => {
    const svc = new AgentSessionService([]);
    assert.deepStrictEqual(await svc.getSessionsForWorktree('/wt'), []);
  });

  test('returns sessions from a single provider', async () => {
    const s = makeSession('id1', 1000);
    const svc = new AgentSessionService([fakeProvider('a', [s])]);
    const result = await svc.getSessionsForWorktree('/wt');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].sessionId, 'id1');
  });

  test('merges sessions from multiple providers', async () => {
    const svc = new AgentSessionService([
      fakeProvider('a', [makeSession('id1', 1000)]),
      fakeProvider('b', [makeSession('id2', 2000)]),
    ]);
    const result = await svc.getSessionsForWorktree('/wt');
    assert.strictEqual(result.length, 2);
  });

  test('sorts by lastActivityAt descending (most recent first)', async () => {
    const svc = new AgentSessionService([
      fakeProvider('a', [makeSession('old', 1000)]),
      fakeProvider('b', [makeSession('new', 9000)]),
    ]);
    const result = await svc.getSessionsForWorktree('/wt');
    assert.strictEqual(result[0].sessionId, 'new');
    assert.strictEqual(result[1].sessionId, 'old');
  });

  test('sessions without lastActivityAt sort to the end', async () => {
    const svc = new AgentSessionService([
      fakeProvider('a', [{ agent: 'a', agentLabel: 'A', sessionId: 'no-time' }]),
      fakeProvider('b', [makeSession('has-time', 1000)]),
    ]);
    const result = await svc.getSessionsForWorktree('/wt');
    assert.strictEqual(result[0].sessionId, 'has-time');
    assert.strictEqual(result[1].sessionId, 'no-time');
  });

  test('handles provider errors gracefully, returns other provider sessions', async () => {
    const failing: IAgentProvider = {
      id: 'fail',
      label: 'Fail',
      getSessions: async () => {
        throw new Error('network');
      },
    };
    const svc = new AgentSessionService([failing, fakeProvider('ok', [makeSession('ok-id', 1)])]);
    const result = await svc.getSessionsForWorktree('/wt');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].sessionId, 'ok-id');
  });
});
