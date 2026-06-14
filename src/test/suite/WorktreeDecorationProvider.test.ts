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
    const provider = new WorktreeDecorationProvider(git);

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
    assert.ok(!colorsUsed.has('list.foreground'), 'Base color should not be in random pool');
  });

  test('stability: same path returns same color', () => {
    const git = { getCachedWorktrees: () => [] } as any;
    const provider = new WorktreeDecorationProvider(git);
    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fwt1&branch=b1');

    const first = (provider.provideFileDecoration(uri, {} as any) as any).color.id;
    const second = (provider.provideFileDecoration(uri, {} as any) as any).color.id;
    assert.strictEqual(first, second);
  });

  test('current worktree → ygg.worktreeColor.current', () => {
    const current = mockWorktree({ path: '/repo/current', isCurrent: true });
    const git = { getCachedWorktrees: () => [current] } as any;
    const provider = new WorktreeDecorationProvider(git);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fcurrent&branch=current');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('base worktree → list.foreground', () => {
    // base is the first one after sorting. sortWorktrees uses main/develop/master order.
    const main = mockWorktree({ path: '/repo/main', branch: 'main' });
    const feat = mockWorktree({ path: '/repo/feat', branch: 'feat' });
    const git = { getCachedWorktrees: () => [feat, main] } as any; // main will be sorted first
    const provider = new WorktreeDecorationProvider(git);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fmain&branch=main');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'list.foreground');
  });

  test('current wins over base when a path is both', () => {
    const mainCurrent = mockWorktree({ path: '/repo/main', branch: 'main', isCurrent: true });
    const git = { getCachedWorktrees: () => [mainCurrent] } as any;
    const provider = new WorktreeDecorationProvider(git);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fmain&branch=main');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('subtree shares worktree color', () => {
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedWorktrees: () => [wt] } as any;
    const provider = new WorktreeDecorationProvider(git);

    const wtUri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fwt&branch=wt');
    const fileUri = vscode.Uri.parse(
      'ygg-worktree://worktree?path=%2Frepo%2Fwt%2Fsrc%2Ffile.ts&branch=wt'
    );

    const wtColor = (provider.provideFileDecoration(wtUri, {} as any) as any).color.id;
    const fileColor = (provider.provideFileDecoration(fileUri, {} as any) as any).color.id;
    assert.strictEqual(wtColor, fileColor);
  });
});
