import * as assert from 'assert';
import * as path from 'path';
import { ClaudeCodeProvider } from '../../agents/ClaudeCodeProvider';

function makeProvider(files: Record<string, object>): ClaudeCodeProvider {
  const readdir = async () => Object.keys(files);
  const readFile = async (p: string) => {
    const key = path.basename(p);
    if (!(key in files)) {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    }
    return JSON.stringify(files[key]);
  };
  return new ClaudeCodeProvider('/fake/sessions', readFile, readdir);
}

suite('ClaudeCodeProvider', () => {
  test('returns session when cwd matches', async () => {
    const provider = makeProvider({
      '1234.json': {
        sessionId: 'abc-123',
        cwd: '/repo/wt/feat-x',
        name: 'Fix auth',
        status: 'idle',
        updatedAt: 1000,
      },
    });
    const sessions = await provider.getSessions('/repo/wt/feat-x');
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'abc-123');
    assert.strictEqual(sessions[0].name, 'Fix auth');
    assert.strictEqual(sessions[0].status, 'idle');
    assert.strictEqual(sessions[0].agentLabel, 'Claude Code');
    assert.strictEqual(sessions[0].resumeCommand, 'claude --resume abc-123');
    assert.strictEqual(sessions[0].lastActivityAt, 1000);
  });

  test('returns empty array when cwd does not match', async () => {
    const provider = makeProvider({
      '1234.json': { sessionId: 'abc-123', cwd: '/repo/wt/other', updatedAt: 1 },
    });
    const sessions = await provider.getSessions('/repo/wt/feat-x');
    assert.strictEqual(sessions.length, 0);
  });

  test('returns empty array when sessions dir is missing', async () => {
    const readdir = async (): Promise<string[]> => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    };
    const readFile = async () => '';
    const provider = new ClaudeCodeProvider('/nonexistent', readFile, readdir);
    const sessions = await provider.getSessions('/any/path');
    assert.strictEqual(sessions.length, 0);
  });

  test('skips malformed JSON files silently', async () => {
    const readdir = async () => ['bad.json'];
    const readFile = async () => 'not-json';
    const provider = new ClaudeCodeProvider('/fake/sessions', readFile, readdir);
    const sessions = await provider.getSessions('/any/path');
    assert.strictEqual(sessions.length, 0);
  });

  test('skips non-json files', async () => {
    const provider = makeProvider({ README: { sessionId: 'x', cwd: '/wt', updatedAt: 1 } });
    const sessions = await provider.getSessions('/wt');
    assert.strictEqual(sessions.length, 0);
  });

  test('skips sessions missing sessionId or cwd', async () => {
    const provider = makeProvider({ 'a.json': { status: 'idle', updatedAt: 1 } });
    const sessions = await provider.getSessions('/any');
    assert.strictEqual(sessions.length, 0);
  });

  test('status busy maps correctly', async () => {
    const provider = makeProvider({
      'a.json': { sessionId: 'id1', cwd: '/wt', status: 'busy', updatedAt: 1 },
    });
    const [s] = await provider.getSessions('/wt');
    assert.strictEqual(s.status, 'busy');
  });

  test('undefined name when field absent', async () => {
    const provider = makeProvider({ 'a.json': { sessionId: 'id1', cwd: '/wt', updatedAt: 1 } });
    const [s] = await provider.getSessions('/wt');
    assert.strictEqual(s.name, undefined);
  });
});
