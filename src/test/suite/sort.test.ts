import * as assert from 'assert';
import { Worktree } from '../../git/parsers';
import { sortWorktrees } from '../../tree/sort';

function mockWorktree(overrides: Partial<Worktree>): Worktree {
  return {
    path: '/mock/path',
    branch: 'main',
    head: 'abc',
    isCurrent: false,
    isMain: false,
    isDirty: false,
    pathExists: true,
    locked: false,
    bare: false,
    ...overrides
  };
}

suite('sortWorktrees', () => {
  test('virtual items come first', () => {
    const main = mockWorktree({ branch: 'main', isMain: true });
    const virtual = mockWorktree({ branch: 'v-branch', isVirtual: true });
    const sorted = sortWorktrees([main, virtual]);
    assert.strictEqual(sorted[0].branch, 'v-branch');
    assert.strictEqual(sorted[1].branch, 'main');
  });

  test('default branches order: main, develop, master', () => {
    const main = mockWorktree({ branch: 'main' });
    const develop = mockWorktree({ branch: 'develop' });
    const master = mockWorktree({ branch: 'master' });
    const other = mockWorktree({ branch: 'other' });

    const sorted = sortWorktrees([other, master, develop, main]);
    assert.strictEqual(sorted[0].branch, 'main');
    assert.strictEqual(sorted[1].branch, 'develop');
    assert.strictEqual(sorted[2].branch, 'master');
    assert.strictEqual(sorted[3].branch, 'other');
  });

  test('isMain comes before other non-default branches', () => {
    const main = mockWorktree({ branch: 'feature-1', isMain: true });
    const feature2 = mockWorktree({ branch: 'feature-2' });
    const sorted = sortWorktrees([feature2, main]);
    assert.strictEqual(sorted[0].branch, 'feature-1');
    assert.strictEqual(sorted[1].branch, 'feature-2');
  });

  test('alphabetical for the rest', () => {
    const b = mockWorktree({ branch: 'b' });
    const a = mockWorktree({ branch: 'a' });
    const sorted = sortWorktrees([b, a]);
    assert.strictEqual(sorted[0].branch, 'a');
    assert.strictEqual(sorted[1].branch, 'b');
  });

  test('complex sorting: virtual > default > main > alphabetical', () => {
    const virtual = mockWorktree({ branch: 'z-virtual', isVirtual: true });
    const main = mockWorktree({ branch: 'main' });
    const develop = mockWorktree({ branch: 'develop' });
    const isMain = mockWorktree({ branch: 'z-is-main', isMain: true });
    const alphaA = mockWorktree({ branch: 'a' });
    const alphaB = mockWorktree({ branch: 'b' });

    const sorted = sortWorktrees([alphaB, isMain, develop, alphaA, main, virtual]);
    assert.deepStrictEqual(sorted.map(w => w.branch), [
      'z-virtual',
      'main',
      'develop',
      'z-is-main',
      'a',
      'b'
    ]);
  });
});
