import * as assert from 'assert';
import { ClaudeDesktopProvider } from '../../agents/ClaudeDesktopProvider';

const WORKTREES_JSON = {
  worktrees: {
    'elastic-cartwright': {
      name: 'elastic-cartwright',
      path: '/repo/.claude/worktrees/elastic-cartwright',
      leasedBy: 'local_abc-123',
      createdAt: 2000,
    },
  },
};

const SESSION_JSON = {
  sessionId: 'local_abc-123',
  title: 'Implement app studio feature',
  isArchived: false,
  lastActivityAt: 5000,
};

function makeProvider(
  worktrees: object | null,
  session: object | null,
  sessionId = 'local_abc-123',
): ClaudeDesktopProvider {
  const readFile = async (p: string) => {
    if (p.endsWith('git-worktrees.json')) {
      if (worktrees === null) { throw Object.assign(new Error(), { code: 'ENOENT' }); }
      return JSON.stringify(worktrees);
    }
    if (p.endsWith(`${sessionId}.json`)) {
      if (session === null) { throw Object.assign(new Error(), { code: 'ENOENT' }); }
      return JSON.stringify(session);
    }
    throw Object.assign(new Error(), { code: 'ENOENT' });
  };
  const readdir = async () => ['desktop-id-1', 'cli-id-1'];
  return new ClaudeDesktopProvider('/fake/claude', readFile, readdir);
}

suite('ClaudeDesktopProvider', () => {
  test('returns session with title when path matches', async () => {
    const provider = makeProvider(WORKTREES_JSON, SESSION_JSON);
    const sessions = await provider.getSessions('/repo/.claude/worktrees/elastic-cartwright');
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'local_abc-123');
    assert.strictEqual(sessions[0].name, 'Implement app studio feature');
    assert.strictEqual(sessions[0].isArchived, false);
    assert.strictEqual(sessions[0].agentLabel, 'Claude Desktop');
    assert.strictEqual(sessions[0].resumeCommand, undefined);
    assert.strictEqual(sessions[0].lastActivityAt, 5000);
  });

  test('returns empty array when path does not match', async () => {
    const provider = makeProvider(WORKTREES_JSON, SESSION_JSON);
    const sessions = await provider.getSessions('/repo/.claude/worktrees/other');
    assert.strictEqual(sessions.length, 0);
  });

  test('returns empty array when git-worktrees.json missing', async () => {
    const provider = makeProvider(null, SESSION_JSON);
    const sessions = await provider.getSessions('/any/path');
    assert.strictEqual(sessions.length, 0);
  });

  test('returns session without name when session file missing', async () => {
    const provider = makeProvider(WORKTREES_JSON, null);
    const sessions = await provider.getSessions('/repo/.claude/worktrees/elastic-cartwright');
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'local_abc-123');
    assert.strictEqual(sessions[0].name, undefined);
  });

  test('uses createdAt as fallback lastActivityAt', async () => {
    const provider = makeProvider(WORKTREES_JSON, null);
    const sessions = await provider.getSessions('/repo/.claude/worktrees/elastic-cartwright');
    assert.strictEqual(sessions[0].lastActivityAt, 2000);
  });

  test('skips worktrees without leasedBy', async () => {
    const noLease = {
      worktrees: {
        'orphan': { name: 'orphan', path: '/repo/.claude/worktrees/orphan', createdAt: 1 },
      },
    };
    const provider = makeProvider(noLease, null);
    const sessions = await provider.getSessions('/repo/.claude/worktrees/orphan');
    assert.strictEqual(sessions.length, 0);
  });
});
