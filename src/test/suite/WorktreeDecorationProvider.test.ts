import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorktreeDecorationProvider } from '../../tree/WorktreeDecorationProvider';
import { Worktree } from '../../git/parsers';

suite('WorktreeDecorationProvider', () => {
  const mockWorktree = (overrides: Partial<Worktree>): Worktree => ({
    path: '/repo/main',
    branch: 'main',
    head: 'abc',
    isCurrent: false,
    isMain: false,
    isDirty: false,
    pathExists: true,
    locked: false,
    bare: false,
    ...overrides,
  });

  test('exhaustive randomness: uses all 9 pool colors before repeating', () => {
    const git = { getCachedWorktrees: () => [] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const colorsUsed = new Set<string>();
    const poolSize = 9;

    for (let i = 1; i <= poolSize; i++) {
      const uri = vscode.Uri.parse(
        `ygg-worktree://worktree?path=${encodeURIComponent(`/repo/wt${i}`)}&branch=b${i}`
      );
      const decoration = provider.provideFileDecoration(uri, {} as any) as any;
      assert.ok(decoration.color instanceof vscode.ThemeColor);
      colorsUsed.add(decoration.color.id);
    }

    assert.strictEqual(colorsUsed.size, poolSize, 'Should have used all 9 colors');
    assert.ok(!colorsUsed.has('ygg.worktreeColor.current'), 'Green should not be in random pool');
    assert.ok(!colorsUsed.has('foreground'), 'Base color should not be in random pool');
  });

  test('stability: same path returns same color', () => {
    const git = { getCachedWorktrees: () => [] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);
    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fwt1&branch=b1');

    const first = (provider.provideFileDecoration(uri, {} as any) as any).color.id;
    const second = (provider.provideFileDecoration(uri, {} as any) as any).color.id;
    assert.strictEqual(first, second);
  });

  test('current worktree → ygg.worktreeColor.current', () => {
    const current = mockWorktree({ path: '/repo/current', isCurrent: true });
    const git = { getCachedWorktrees: () => [current] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fcurrent&branch=current');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('base worktree → foreground', () => {
    // base is the first one after sorting. sortWorktrees uses main/develop/master order.
    const main = mockWorktree({ path: '/repo/main', branch: 'main' });
    const feat = mockWorktree({ path: '/repo/feat', branch: 'feat' });
    const git = { getCachedWorktrees: () => [feat, main] } as any; // main will be sorted first
    const provider = new WorktreeDecorationProvider(git, () => true);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fmain&branch=main');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'foreground');
  });

  test('current wins over base when a path is both', () => {
    const mainCurrent = mockWorktree({ path: '/repo/main', branch: 'main', isCurrent: true });
    const git = { getCachedWorktrees: () => [mainCurrent] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fmain&branch=main');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('subtree shares worktree color', () => {
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedWorktrees: () => [wt] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const wtUri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fwt&branch=wt');
    const fileUri = vscode.Uri.parse(
      'ygg-worktree://worktree?path=%2Frepo%2Fwt%2Fsrc%2Ffile.ts&branch=wt'
    );

    const wtColor = (provider.provideFileDecoration(wtUri, {} as any) as any).color.id;
    const fileColor = (provider.provideFileDecoration(fileUri, {} as any) as any).color.id;
    assert.strictEqual(wtColor, fileColor);
  });

  test('colors off: no decoration at all', () => {
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedWorktrees: () => [wt] } as any;
    const provider = new WorktreeDecorationProvider(git, () => false);

    const uri = vscode.Uri.parse('ygg-worktree://wt?path=%2Frepo%2Fwt');
    assert.strictEqual(provider.provideFileDecoration(uri, {} as any), undefined);
  });

  test('colors off, then on after refresh: a pool color is assigned', () => {
    // Two worktrees so the one under test is neither base nor current, and so
    // takes a pool color rather than BASE_COLOR — otherwise this proves nothing
    // about the assignment map.
    const main = mockWorktree({ path: '/repo/main', branch: 'main' });
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedWorktrees: () => [main, wt] } as any;

    let enabled = false;
    const provider = new WorktreeDecorationProvider(git, () => enabled);
    const uri = vscode.Uri.parse('ygg-worktree://wt?path=%2Frepo%2Fwt');

    assert.strictEqual(provider.provideFileDecoration(uri, {} as any), undefined);

    enabled = true;
    provider.refresh(); // clears the cached flag — the real invalidation path
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.ok(
      /^ygg\.worktreeColor\.[1-9]$/.test(decoration.color.id),
      `expected a pool color, got ${decoration.color.id}`
    );
  });

  test('the cached flag is not re-read per call', () => {
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedWorktrees: () => [wt] } as any;
    let reads = 0;
    const provider = new WorktreeDecorationProvider(git, () => {
      reads++;
      return true;
    });

    const uri = vscode.Uri.parse('ygg-worktree://wt?path=%2Frepo%2Fwt');
    provider.provideFileDecoration(uri, {} as any);
    provider.provideFileDecoration(uri, {} as any);
    provider.provideFileDecoration(uri, {} as any);

    assert.strictEqual(reads, 1, 'setting should be read once, not once per row');
  });
});
