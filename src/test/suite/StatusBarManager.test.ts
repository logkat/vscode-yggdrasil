import * as assert from 'assert';
import { sanitizeBranchForPath } from '../../commands/StatusBarManager';

suite('sanitizeBranchForPath', () => {
  test('replaces forward slashes', () => {
    assert.strictEqual(sanitizeBranchForPath('feature/foo'), 'feature-foo');
  });

  test('replaces Windows-illegal characters', () => {
    assert.strictEqual(sanitizeBranchForPath('feat:bar?baz*qux'), 'feat-bar-baz-qux');
  });

  test('collapses consecutive illegal characters', () => {
    assert.strictEqual(sanitizeBranchForPath('weird///name'), 'weird-name');
  });

  test('strips leading and trailing dashes', () => {
    assert.strictEqual(sanitizeBranchForPath('/leading/trailing/'), 'leading-trailing');
  });

  test('falls back to "worktree" when input collapses to empty', () => {
    assert.strictEqual(sanitizeBranchForPath('////'), 'worktree');
  });

  test('preserves safe characters', () => {
    assert.strictEqual(sanitizeBranchForPath('my-branch_v2.1'), 'my-branch_v2.1');
  });

  test('replaces whitespace', () => {
    assert.strictEqual(sanitizeBranchForPath('my branch'), 'my-branch');
  });
});
