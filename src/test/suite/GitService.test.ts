import * as assert from 'assert';
import { parsePorcelain, parseStatusLine } from '../../git/GitService';

// Porcelain samples verified against git 2.50.1
const NORMAL = `worktree /repo/main
HEAD abc123def456abc123def456abc123def456abc1
branch refs/heads/main

worktree /repo/feature-foo
HEAD def456abc123def456abc123def456abc123def4
branch refs/heads/feature/foo

`;

const DETACHED = `worktree /repo/main
HEAD abc123def456abc123def456abc123def456abc1
detached

`;

const BARE = `worktree /repo/main
HEAD abc123def456abc123def456abc123def456abc1
bare

`;

const LOCKED = `worktree /repo/main
HEAD abc123def456abc123def456abc123def456abc1
branch refs/heads/main

worktree /repo/locked-wt
HEAD def456abc123def456abc123def456abc123def4
branch refs/heads/experiment
locked reason: transferred to another machine

`;

suite('parsePorcelain', () => {
  test('parses two normal worktrees', () => {
    const result = parsePorcelain(NORMAL, '/repo/main');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, '/repo/main');
    assert.strictEqual(result[0].branch, 'main');
    assert.strictEqual(result[0].head, 'abc123def456abc123def456abc123def456abc1');
    assert.strictEqual(result[0].isCurrent, true);
    assert.strictEqual(result[0].bare, false);
    assert.strictEqual(result[0].locked, false);
    assert.strictEqual(result[1].branch, 'feature/foo');
    assert.strictEqual(result[1].isCurrent, false);
  });

  test('strips refs/heads/ prefix from branch name', () => {
    const result = parsePorcelain(NORMAL, '');
    assert.strictEqual(result[0].branch, 'main');
    assert.strictEqual(result[1].branch, 'feature/foo');
  });

  test('detached HEAD shows "(detached HEAD)"', () => {
    const result = parsePorcelain(DETACHED, '');
    assert.strictEqual(result[0].branch, '(detached HEAD)');
    assert.strictEqual(result[0].bare, false);
  });

  test('bare worktree shows "(bare)"', () => {
    const result = parsePorcelain(BARE, '');
    assert.strictEqual(result[0].branch, '(bare)');
    assert.strictEqual(result[0].bare, true);
  });

  test('locked worktree sets locked=true', () => {
    const result = parsePorcelain(LOCKED, '');
    assert.strictEqual(result[1].locked, true);
    assert.strictEqual(result[0].locked, false);
  });

  test('isCurrent matches by path equality', () => {
    const result = parsePorcelain(NORMAL, '/repo/feature-foo');
    assert.strictEqual(result[0].isCurrent, false);
    assert.strictEqual(result[1].isCurrent, true);
  });

  test('handles nested worktrees in ignored directories', () => {
    const NESTED = `worktree /repo/main
HEAD abc123def456abc123def456abc123def456abc1
branch refs/heads/main

worktree /repo/.agent/worktrees/feat
HEAD def456abc123def456abc123def456abc123def4
branch refs/heads/feat
`;
    const result = parsePorcelain(NESTED, '/repo/main');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1].path, '/repo/.agent/worktrees/feat');
    assert.strictEqual(result[1].branch, 'feat');
  });

  test('missing path sets pathExists=false', () => {
    const result = parsePorcelain(NORMAL, '');
    // /repo/main does not exist on this machine
    assert.strictEqual(result[0].pathExists, false);
  });

  test('empty output returns empty array', () => {
    const result = parsePorcelain('', '');
    assert.strictEqual(result.length, 0);
  });
});

suite('parseStatusLine', () => {
  test('modified tracked file', () => {
    const r = parseStatusLine(' M src/foo.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/foo.ts', status: 'M', isUntracked: false });
  });

  test('staged modified file (X non-space takes priority)', () => {
    const r = parseStatusLine('M  src/foo.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/foo.ts', status: 'M', isUntracked: false });
  });

  test('untracked file', () => {
    const r = parseStatusLine('?? src/new.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/new.ts', status: '?', isUntracked: true });
  });

  test('deleted file', () => {
    const r = parseStatusLine(' D src/old.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/old.ts', status: 'D', isUntracked: false });
  });

  test('added staged file', () => {
    const r = parseStatusLine('A  src/added.ts');
    assert.deepStrictEqual(r, { relativePath: 'src/added.ts', status: 'A', isUntracked: false });
  });

  test('renamed file uses new path only', () => {
    const r = parseStatusLine('R  old/path.ts -> new/path.ts');
    assert.deepStrictEqual(r, { relativePath: 'new/path.ts', status: 'R', isUntracked: false });
  });

  test('quoted filename with space is dequoted', () => {
    const r = parseStatusLine(' M "src/my component/Button.tsx"');
    assert.deepStrictEqual(r, { relativePath: 'src/my component/Button.tsx', status: 'M', isUntracked: false });
  });

  test('quoted renamed file uses dequoted new path', () => {
    const r = parseStatusLine('R  "old name.ts" -> "new name.ts"');
    assert.deepStrictEqual(r, { relativePath: 'new name.ts', status: 'R', isUntracked: false });
  });

  test('returns null for short or empty line', () => {
    assert.strictEqual(parseStatusLine(''), null);
    assert.strictEqual(parseStatusLine('M '), null);
  });

  test('quoted filename with double-quote char is dequoted', () => {
    const r = parseStatusLine(' M "src/weird\\"name.ts"');
    assert.deepStrictEqual(r, { relativePath: 'src/weird"name.ts', status: 'M', isUntracked: false });
  });

  test('quoted filename with non-ASCII (octal UTF-8 bytes) is decoded correctly', () => {
    // café.ts → UTF-8 bytes C3 A9 for é → git octal: \303\251
    const r = parseStatusLine(' M "src/caf\\303\\251.ts"');
    assert.deepStrictEqual(r, { relativePath: 'src/café.ts', status: 'M', isUntracked: false });
  });
});

