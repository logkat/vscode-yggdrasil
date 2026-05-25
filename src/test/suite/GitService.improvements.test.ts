import * as assert from 'assert';
import { GitService } from '../../git/GitService';

suite('GitService Improvements', () => {
  test('listWorktrees populates aheadCount', async () => {
    const realPath = process.cwd();
    const mockRun = async (cmd: string, args: string[]) => {
      if (args.includes('list')) {
        return { stdout: `worktree ${realPath}\nHEAD abc\nbranch refs/heads/main\n\n`, stderr: '', status: 0 };
      }
      if (args.includes('rev-parse') && args.includes('--show-toplevel')) {
        return { stdout: realPath, stderr: '', status: 0 };
      }
      if (args.includes('status')) {
        return { stdout: '', stderr: '', status: 0 }; // Clean working tree
      }
      if (args.includes('rev-list')) {
        return { stdout: '5\n', stderr: '', status: 0 }; // 5 commits ahead
      }
      return { stdout: '', stderr: '', status: 0 };
    };

    const git = new GitService(
      () => realPath,
      () => 'main',
      mockRun as any
    );

    const worktrees = await git.listWorktrees();
    assert.strictEqual(worktrees.length, 1);
    assert.strictEqual(worktrees[0].path, realPath);
    assert.strictEqual(worktrees[0].pathExists, true);
    assert.strictEqual(worktrees[0].aheadCount, 5);
    assert.strictEqual(worktrees[0].isDirty, false);
  });

  test('pruneWorktrees executes git worktree prune', async () => {
    let calledArgs: string[] = [];
    const mockRun = async (cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('--show-toplevel')) {
        return { stdout: '/repo/main', stderr: '', status: 0 };
      }
      if (args.includes('prune')) {
        calledArgs = args;
        return { stdout: '', stderr: '', status: 0 };
      }
      return { stdout: '', stderr: '', status: 0 };
    };

    const git = new GitService(
      () => '/repo/main',
      () => 'main',
      mockRun as any
    );

    await git.pruneWorktrees();
    assert.deepStrictEqual(calledArgs, ['worktree', 'prune']);
  });
});
