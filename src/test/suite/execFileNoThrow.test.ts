import * as assert from 'assert';
import { execFileNoThrow } from '../../utils/execFileNoThrow';

suite('execFileNoThrow', () => {
  test('returns stdout and status 0 on success', async () => {
    const result = await execFileNoThrow('echo', ['hello']);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('hello'));
    assert.strictEqual(result.stderr, '');
  });

  test('returns non-zero status and stderr on failure', async () => {
    const result = await execFileNoThrow('git', ['worktree', 'list', '--porcelain'], {
      cwd: '/tmp',
    });
    assert.notStrictEqual(result.status, 0);
  });

  test('returns status -1 when binary is not found (ENOENT)', async () => {
    const result = await execFileNoThrow('__nonexistent_binary_xyz__', []);
    assert.strictEqual(result.status, -1);
    assert.ok(result.stderr.length > 0);
    assert.strictEqual(result.stdout, '');
  });

  test('passes cwd option to the process', async () => {
    const result = await execFileNoThrow('pwd', [], { cwd: '/tmp' });
    assert.strictEqual(result.status, 0);
    // /tmp resolves to /private/tmp on macOS
    assert.ok(result.stdout.trim().endsWith('tmp'));
  });
});
