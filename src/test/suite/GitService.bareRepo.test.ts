import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../git/GitService';
import { execFileNoThrow } from '../../utils/execFileNoThrow';

/**
 * These tests use a REAL bare repository rather than stubbed git output, because
 * the bug they cover was a wrong assumption about what git reports — a stub would
 * have encoded the same wrong assumption and passed.
 *
 * Layout mirrors the common "bare repo + .worktrees/" workflow:
 *
 *   repo/
 *     .git/            <- bare repository
 *     .worktrees/foo   <- linked worktree
 *
 * In that layout `git rev-parse --show-toplevel` fails with
 * "fatal: this operation must be run in a work tree", which is what the
 * extension previously surfaced as its entire tree contents.
 */
suite('GitService — bare repository support', () => {
  let tmpRoot: string;
  let repoRoot: string;

  suiteSetup(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ygg-bare-'));
    repoRoot = path.join(tmpRoot, 'repo');
    fs.mkdirSync(repoRoot);
    const r = require('child_process').spawnSync('git', ['init', '--bare', '-q', '.git'], {
      cwd: repoRoot,
    });
    assert.strictEqual(r.status, 0, 'fixture: git init --bare failed');
  });

  suiteTeardown(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('fixture really is bare and really fails --show-toplevel', async () => {
    const topLevel = await execFileNoThrow('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
    });
    assert.notStrictEqual(topLevel.status, 0, 'expected --show-toplevel to fail in a bare repo');

    const isBare = await execFileNoThrow('git', ['rev-parse', '--is-bare-repository'], {
      cwd: repoRoot,
    });
    assert.strictEqual(isBare.status, 0);
    assert.strictEqual(isBare.stdout.trim(), 'true');
  });

  test('getRepoRoot resolves in a bare repository instead of throwing', async () => {
    const git = new GitService(() => repoRoot);
    const resolved = await git.getRepoRoot();
    assert.strictEqual(fs.realpathSync(resolved), fs.realpathSync(repoRoot));
  });

  test('listWorktrees returns the bare entry rather than throwing', async () => {
    const git = new GitService(() => repoRoot);
    const worktrees = await git.listWorktrees();

    const bare = worktrees.find((w) => w.bare);
    assert.ok(bare, `expected a bare worktree entry, got ${JSON.stringify(worktrees)}`);
    assert.strictEqual(bare.branch, '(bare)');
    assert.strictEqual(fs.realpathSync(bare.path), fs.realpathSync(repoRoot));
  });

  test('a non-repository directory still reports an error', async () => {
    const notARepo = path.join(tmpRoot, 'plain');
    fs.mkdirSync(notARepo);
    const git = new GitService(() => notARepo);
    await assert.rejects(() => git.getRepoRoot(), /not a git repository/i);
  });
});
