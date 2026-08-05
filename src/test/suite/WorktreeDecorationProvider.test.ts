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
    const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [] } as any;
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
    const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);
    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fwt1&branch=b1');

    const first = (provider.provideFileDecoration(uri, {} as any) as any).color.id;
    const second = (provider.provideFileDecoration(uri, {} as any) as any).color.id;
    assert.strictEqual(first, second);
  });

  test('current worktree → ygg.worktreeColor.current', () => {
    const current = mockWorktree({ path: '/repo/current', isCurrent: true });
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => [current],
    } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fcurrent&branch=current');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('base worktree → foreground', () => {
    // base is the first one after sorting. sortWorktrees uses main/develop/master order.
    const main = mockWorktree({ path: '/repo/main', branch: 'main' });
    const feat = mockWorktree({ path: '/repo/feat', branch: 'feat' });
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => [feat, main],
    } as any; // main will be sorted first
    const provider = new WorktreeDecorationProvider(git, () => true);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fmain&branch=main');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'foreground');
  });

  test('current wins over base when a path is both', () => {
    const mainCurrent = mockWorktree({ path: '/repo/main', branch: 'main', isCurrent: true });
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => [mainCurrent],
    } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const uri = vscode.Uri.parse('ygg-worktree://worktree?path=%2Frepo%2Fmain&branch=main');
    const decoration = provider.provideFileDecoration(uri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('subtree shares worktree color', () => {
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [wt] } as any;
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
    const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [wt] } as any;
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
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => [main, wt],
    } as any;

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

  test('windows: subtree shares worktree color despite mixed separators', () => {
    // Worktree.path comes from `git worktree list --porcelain`, which always uses
    // forward slashes even on win32; item paths are built with path.join, which
    // uses backslashes on win32. Both must normalize to the same color.
    const wt = mockWorktree({ path: 'C:/repo/wt', branch: 'wt' });
    const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [wt] } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const wtUri = vscode.Uri.parse(`ygg-worktree://wt?path=${encodeURIComponent('C:/repo/wt')}`);
    const fileUri = vscode.Uri.parse(
      `ygg-worktree://wt?path=${encodeURIComponent('C:\\repo\\wt\\src\\file.ts')}`
    );

    const wtColor = (provider.provideFileDecoration(wtUri, {} as any) as any).color.id;
    const fileColor = (provider.provideFileDecoration(fileUri, {} as any) as any).color.id;
    assert.strictEqual(wtColor, fileColor);
  });

  test('windows: backslash item path resolves to current worktree color', () => {
    const current = mockWorktree({ path: 'C:/repo/current', isCurrent: true });
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => [current],
    } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const fileUri = vscode.Uri.parse(
      `ygg-worktree://current?path=${encodeURIComponent('C:\\repo\\current\\src\\file.ts')}`
    );
    const decoration = provider.provideFileDecoration(fileUri, {} as any) as any;
    assert.strictEqual(decoration.color.id, 'ygg.worktreeColor.current');
  });

  test('startup window: worktree row and file row share color despite mixed separators when worktrees are not yet cached', () => {
    // During startup, git.getCachedWorktrees() returns undefined, so the owner
    // lookup is skipped entirely and provideFileDecoration falls back to keying
    // the assignment map on the raw item path. A worktree row (forward slashes,
    // matching git's porcelain output) and a file row underneath it (backslashes,
    // from path.join on win32) must still land on the same color.
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
    } as any;
    const provider = new WorktreeDecorationProvider(git, () => true);

    const wtUri = vscode.Uri.parse(`ygg-worktree://wt?path=${encodeURIComponent('C:/repo/wt')}`);
    const fileUri = vscode.Uri.parse(
      `ygg-worktree://wt?path=${encodeURIComponent('C:\\repo\\wt\\src\\file.ts')}`
    );

    const wtColor = (provider.provideFileDecoration(wtUri, {} as any) as any).color.id;
    const fileColor = (provider.provideFileDecoration(fileUri, {} as any) as any).color.id;
    assert.strictEqual(wtColor, fileColor);
  });

  suite('state badges', () => {
    const uriFor = (p: string, branch: string): vscode.Uri =>
      vscode.Uri.parse(
        `ygg-worktree:branch:${encodeURIComponent(branch)}?path=${encodeURIComponent(p)}`
      );

    test('dirty worktree row gets a badge', () => {
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt', isDirty: true });
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => [wt],
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => true);

      const decoration = provider.provideFileDecoration(uriFor('/repo/wt', 'wt'), {} as any) as any;
      assert.strictEqual(decoration.badge, '●');
    });

    test('ahead-of-base worktree row shows the count', () => {
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt', aheadCount: 3 });
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => [wt],
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => true);

      const decoration = provider.provideFileDecoration(uriFor('/repo/wt', 'wt'), {} as any) as any;
      assert.strictEqual(decoration.badge, '↑3');
      assert.ok(decoration.tooltip.includes('3 commits ahead of base'));
    });

    test('badge stays within the two-character limit when both states apply', () => {
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt', isDirty: true, aheadCount: 12 });
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => [wt],
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => true);

      const decoration = provider.provideFileDecoration(uriFor('/repo/wt', 'wt'), {} as any) as any;
      assert.ok(decoration.badge.length <= 2, `badge "${decoration.badge}" is too long`);
    });

    test('rows inside a worktree get no badge — only the worktree row does', () => {
      // A file's status is NOT a badge. VS Code paints a TreeView badge in its
      // own default colour and ignores FileDecoration.color for it, so a status
      // letter here rendered grey beside a green or orange icon. The status
      // colour lives on the icon and the letter in the description instead.
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt', isDirty: true });
      const git = {
        getCachedWorktrees: () => [wt],
        getCachedBranchChanges: () => ({
          files: [{ relativePath: 'src/file.ts', status: 'M', isUntracked: false }],
          baseSha: 'sha',
          baseRef: 'main',
        }),
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => true);

      const decoration = provider.provideFileDecoration(
        uriFor('/repo/wt/src/file.ts', 'wt'),
        {} as any
      ) as any;
      assert.strictEqual(decoration.badge, undefined);
    });

    test('badges are independent of ygg.worktreeColors', () => {
      // The badge reports git state, not worktree identity, so turning the
      // colour feature off must not hide it.
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt', isDirty: true });
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => [wt],
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => false);

      const decoration = provider.provideFileDecoration(uriFor('/repo/wt', 'wt'), {} as any) as any;
      assert.strictEqual(decoration.badge, '●');
      assert.strictEqual(decoration.color, undefined);
    });

    test('clean worktree with colours off still yields no decoration', () => {
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => [wt],
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => false);

      assert.strictEqual(
        provider.provideFileDecoration(uriFor('/repo/wt', 'wt'), {} as any),
        undefined
      );
    });
  });

  suite('colour persistence', () => {
    test('a restored assignment survives a new provider instance', () => {
      const main = mockWorktree({ path: '/repo/main', branch: 'main' });
      const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => [main, wt],
      } as any;

      let saved: Record<string, string> | undefined;
      const store = {
        get: () => saved,
        set: (a: Record<string, string>) => {
          saved = a;
        },
      };

      const uri = vscode.Uri.parse('ygg-worktree://wt?path=%2Frepo%2Fwt');
      const first = new WorktreeDecorationProvider(git, () => true, store);
      const firstColor = (first.provideFileDecoration(uri, {} as any) as any).color.id;
      assert.ok(saved, 'assignment should have been written to the store');

      // A new window: same store, fresh provider, shuffle bag re-rolled.
      const second = new WorktreeDecorationProvider(git, () => true, store);
      const secondColor = (second.provideFileDecoration(uri, {} as any) as any).color.id;
      assert.strictEqual(secondColor, firstColor);
    });

    test('pruning drops dead worktrees so their colours return to the pool', () => {
      // Without pruning the persisted map only grows. Once nine dead entries
      // exist every colour counts as used, the bag refills from the whole pool,
      // and live worktrees start sharing colours — the exact guarantee that
      // persisting the map was added to protect.
      const saved: Record<string, string> = {};
      for (let i = 1; i <= 9; i++) {
        saved[`/repo/dead${i}`] = `ygg.worktreeColor.${i}`;
      }
      const live = mockWorktree({ path: '/repo/live', branch: 'live' });
      const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [] } as any;
      const provider = new WorktreeDecorationProvider(git, () => true, {
        get: () => saved,
        set: (a: Record<string, string>) => {
          for (const k of Object.keys(saved)) {
            delete saved[k];
          }
          Object.assign(saved, a);
        },
      });

      provider.pruneAssignments([live]);
      assert.deepStrictEqual(Object.keys(saved), [], 'dead assignments should be gone');

      // With the pool free again, nine fresh worktrees get nine distinct colours.
      const seen = new Set<string>();
      for (let i = 0; i < 9; i++) {
        const uri = vscode.Uri.parse(
          `ygg-worktree://worktree?path=${encodeURIComponent(`/repo/new${i}`)}&branch=n${i}`
        );
        seen.add((provider.provideFileDecoration(uri, {} as any) as any).color.id);
      }
      assert.strictEqual(seen.size, 9);
    });

    test('the startup branch-keyed fallback is never persisted', () => {
      // That key is a stand-in until the worktree list resolves; persisting it
      // would leave the same worktree holding two of the nine slots.
      let saved: Record<string, string> | undefined;
      const git = {
        getCachedBranchChanges: () => undefined,
        getCachedWorktrees: () => undefined,
      } as any;
      const provider = new WorktreeDecorationProvider(git, () => true, {
        get: () => undefined,
        set: (a: Record<string, string>) => {
          saved = a;
        },
      });

      provider.provideFileDecoration(
        vscode.Uri.parse('ygg-worktree://wt?path=%2Frepo%2Fwt'),
        {} as any
      );
      assert.strictEqual(saved, undefined, 'nothing should have been written to the store');
    });

    test('restored assignments do not get handed out again to new worktrees', () => {
      const claimed: Record<string, string> = { '/repo/a': 'ygg.worktreeColor.4' };
      const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [] } as any;
      const provider = new WorktreeDecorationProvider(git, () => true, {
        get: () => claimed,
        set: () => {},
      });

      const seen = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const uri = vscode.Uri.parse(
          `ygg-worktree://worktree?path=${encodeURIComponent(`/repo/new${i}`)}&branch=n${i}`
        );
        seen.add((provider.provideFileDecoration(uri, {} as any) as any).color.id);
      }

      assert.ok(
        !seen.has('ygg.worktreeColor.4'),
        'the colour already assigned to /repo/a should not be reused while others are free'
      );
      assert.strictEqual(seen.size, 8, 'the remaining eight colours should all be distinct');
    });
  });

  test('the cached flag is not re-read per call', () => {
    const wt = mockWorktree({ path: '/repo/wt', branch: 'wt' });
    const git = { getCachedBranchChanges: () => undefined, getCachedWorktrees: () => [wt] } as any;
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
