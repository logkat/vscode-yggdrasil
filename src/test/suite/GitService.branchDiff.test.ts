import * as assert from 'assert';
import { parseDiffNameStatus, GitService } from '../../git/GitService';

suite('parseDiffNameStatus', () => {
  test('empty input returns []', () => {
    assert.deepStrictEqual(parseDiffNameStatus(''), []);
    assert.deepStrictEqual(parseDiffNameStatus('   '), []);
  });

  test('M line — modified file', () => {
    const result = parseDiffNameStatus('M\tsrc/foo.ts');
    assert.deepStrictEqual(result, [
      { relativePath: 'src/foo.ts', status: 'M', isUntracked: false },
    ]);
  });

  test('A line — added file', () => {
    const result = parseDiffNameStatus('A\tsrc/new.ts');
    assert.deepStrictEqual(result, [
      { relativePath: 'src/new.ts', status: 'A', isUntracked: false },
    ]);
  });

  test('D line — deleted file', () => {
    const result = parseDiffNameStatus('D\tsrc/old.ts');
    assert.deepStrictEqual(result, [
      { relativePath: 'src/old.ts', status: 'D', isUntracked: false },
    ]);
  });

  test('R100 line — rename uses destination path', () => {
    const result = parseDiffNameStatus('R100\told/path.ts\tnew/path.ts');
    assert.deepStrictEqual(result, [
      { relativePath: 'new/path.ts', status: 'R', isUntracked: false },
    ]);
  });

  test('C085 line — copy uses destination path (same rule as rename)', () => {
    const result = parseDiffNameStatus('C085\toriginal.ts\tcopy/path.ts');
    assert.deepStrictEqual(result, [
      { relativePath: 'copy/path.ts', status: 'C', isUntracked: false },
    ]);
  });

  test('unknown status code is skipped', () => {
    const result = parseDiffNameStatus('X\tsrc/weird.ts');
    assert.deepStrictEqual(result, []);
  });

  test('multiple lines parsed correctly', () => {
    const input = 'M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts';
    const result = parseDiffNameStatus(input);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].status, 'M');
    assert.strictEqual(result[1].status, 'A');
    assert.strictEqual(result[2].status, 'D');
  });

  test('isUntracked is always false', () => {
    const result = parseDiffNameStatus('M\tsrc/foo.ts');
    assert.strictEqual(result[0].isUntracked, false);
  });
});

// Helpers used across suites
import { ExecOptions, ExecResult } from '../../utils/execFileNoThrow';
type RunFn = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

function makeRun(handler: (args: string[]) => ExecResult): RunFn {
  return async (_cmd, args) => handler(args);
}

suite('GitService.resolveBaseRef', () => {
  test('returns configured base branch immediately without calling git', async () => {
    const gitCalls: string[][] = [];
    const run = makeRun((args) => {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    });
    const git = new GitService(
      () => '/repo',
      () => 'my-base',
      run
    );
    const result = await (git as any).resolveBaseRef('/wt');
    assert.strictEqual(result, 'my-base');
    assert.strictEqual(gitCalls.length, 0, 'git should not be called when config is set');
  });

  test('returns upstream ref when configured base is not set and upstream resolves', async () => {
    const run = makeRun((args) => {
      if (args.includes('@{upstream}')) {
        return { status: 0, stdout: 'origin/main\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });
    const git = new GitService(
      () => '/repo',
      () => undefined,
      run
    );
    const result = await (git as any).resolveBaseRef('/wt');
    assert.strictEqual(result, 'origin/main');
  });

  test('falls back to "main" when configured base is not set and upstream fails', async () => {
    const run = makeRun(() => ({ status: 128, stdout: '', stderr: 'fatal: no upstream' }));
    const git = new GitService(
      () => '/repo',
      () => undefined,
      run
    );
    const result = await (git as any).resolveBaseRef('/wt');
    assert.strictEqual(result, 'main');
  });
});

suite('GitService.getWorktreeBranchChanges', () => {
  function makeGitWithRun(
    handler: (args: string[]) => { status: number; stdout: string; stderr: string }
  ) {
    const run = makeRun(handler);
    return new GitService(
      () => '/repo',
      () => undefined,
      run
    );
  }

  const MERGE_BASE_SHA = 'deadbeef1234567890abcdef1234567890abcdef';

  function defaultHandler(args: string[]): { status: number; stdout: string; stderr: string } {
    if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
      return { status: 1, stdout: '', stderr: 'no upstream' };
    }
    if (args[0] === 'merge-base') {
      return { status: 0, stdout: MERGE_BASE_SHA + '\n', stderr: '' };
    }
    if (args[0] === 'diff' && args.includes('--cached')) {
      return { status: 0, stdout: 'A\tstaged.ts\n', stderr: '' };
    }
    if (args[0] === 'diff') {
      return { status: 0, stdout: 'M\tworking.ts\n', stderr: '' };
    }
    if (args[0] === 'status') {
      return { status: 0, stdout: '?? untracked.ts\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  }

  test('returns baseSha from merge-base output', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { baseSha } = await git.getWorktreeBranchChanges('/wt');
    assert.strictEqual(baseSha, MERGE_BASE_SHA);
  });

  test('includes committed/unstaged file from git diff', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.ok(files.some((f) => f.relativePath === 'working.ts' && f.status === 'M'));
  });

  test('includes staged file from git diff --cached', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.ok(files.some((f) => f.relativePath === 'staged.ts' && f.status === 'A'));
  });

  test('includes untracked file from git status ??', async () => {
    const git = makeGitWithRun(defaultHandler);
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.ok(files.some((f) => f.relativePath === 'untracked.ts' && f.status === '?'));
  });

  test('deduplicates: file in both diff and --cached appears once', async () => {
    const git = makeGitWithRun((args) => {
      if (args[0] === 'rev-parse') {
        return { status: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'merge-base') {
        return { status: 0, stdout: MERGE_BASE_SHA + '\n', stderr: '' };
      }
      if (args[0] === 'diff' && args.includes('--cached')) {
        return { status: 0, stdout: 'M\tsame.ts\n', stderr: '' };
      }
      if (args[0] === 'diff') {
        return { status: 0, stdout: 'M\tsame.ts\n', stderr: '' };
      }
      if (args[0] === 'status') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const { files } = await git.getWorktreeBranchChanges('/wt');
    assert.strictEqual(files.filter((f) => f.relativePath === 'same.ts').length, 1);
  });

  test('throws when merge-base fails', async () => {
    const git = makeGitWithRun((args) => {
      if (args[0] === 'rev-parse') {
        return { status: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'merge-base') {
        return { status: 1, stdout: '', stderr: 'no common ancestor' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    await assert.rejects(() => git.getWorktreeBranchChanges('/wt'), /no common ancestor/);
  });

  test('passes merge-base SHA as arg to both diff calls', async () => {
    const diffArgs: string[][] = [];
    const git = makeGitWithRun((args) => {
      if (args[0] === 'rev-parse') {
        return { status: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'merge-base') {
        return { status: 0, stdout: MERGE_BASE_SHA + '\n', stderr: '' };
      }
      if (args[0] === 'diff') {
        diffArgs.push([...args]);
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'status') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    await git.getWorktreeBranchChanges('/wt');
    assert.strictEqual(diffArgs.length, 2, 'git diff should be called twice');
    assert.ok(
      diffArgs.every((a) => a.includes(MERGE_BASE_SHA)),
      'both diff calls must include baseSha'
    );
    assert.ok(
      diffArgs.some((a) => a.includes('--cached')),
      'one diff call must include --cached'
    );
  });
});
