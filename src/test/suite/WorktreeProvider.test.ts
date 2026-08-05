import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  WorktreeFileItem,
  WorktreeFolderItem,
  WorktreeItem,
  WorktreeProvider,
} from '../../tree/WorktreeProvider';
import { FileStatus, Worktree } from '../../git/GitService';

function makeFileStatus(overrides: Partial<FileStatus> = {}): FileStatus {
  return {
    relativePath: 'src/foo.ts',
    status: 'M',
    isUntracked: false,
    ...overrides,
  };
}

function mockFileUri(wtPath: string, relativePath: string, branch: string): vscode.Uri {
  return vscode.Uri.parse(
    `ygg-worktree://worktree?path=${encodeURIComponent(path.join(wtPath, relativePath))}&branch=${encodeURIComponent(branch)}`
  );
}

suite('WorktreeFileItem', () => {
  test('label is filename only', () => {
    const wtPath = '/repo/wt';
    const branch = 'feature/x';
    const relativePath = 'src/bar.ts';
    const item = new WorktreeFileItem(
      makeFileStatus({ relativePath }),
      wtPath,
      branch,
      'baseSHA',
      mockFileUri(wtPath, relativePath, branch)
    );
    assert.strictEqual(item.label, 'bar.ts');
  });

  test('description is the status code', () => {
    const item = new WorktreeFileItem(
      makeFileStatus({ status: 'M' }),
      '/repo/wt',
      'main',
      'sha',
      mockFileUri('/repo/wt', 'file.ts', 'main')
    );
    assert.strictEqual(item.description, 'M');
  });

  test('contextValue is worktreeFile', () => {
    const item = new WorktreeFileItem(
      makeFileStatus(),
      '/repo/wt',
      'main',
      'sha',
      mockFileUri('/repo/wt', 'file.ts', 'main')
    );
    assert.strictEqual(item.contextValue, 'worktreeFile');
  });

  test('command is ygg.openDiff with item as argument', () => {
    const item = new WorktreeFileItem(
      makeFileStatus(),
      '/repo/wt',
      'main',
      'sha',
      mockFileUri('/repo/wt', 'file.ts', 'main')
    );
    assert.strictEqual(item.command?.command, 'ygg.openDiff');
    assert.deepStrictEqual(item.command?.arguments, [item]);
  });

  test('collapsible state is None (leaf)', () => {
    const item = new WorktreeFileItem(
      makeFileStatus(),
      '/repo/wt',
      'main',
      'sha',
      mockFileUri('/repo/wt', 'file.ts', 'main')
    );
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('stores file, worktreePath, branch as public properties', () => {
    const file = makeFileStatus();
    const item = new WorktreeFileItem(
      file,
      '/repo/wt',
      'feature/y',
      'abc',
      mockFileUri('/repo/wt', 'file.ts', 'feature/y')
    );
    assert.strictEqual(item.file, file);
    assert.strictEqual(item.worktreePath, '/repo/wt');
    assert.strictEqual(item.branch, 'feature/y');
    assert.strictEqual(item.baseSha, 'abc');
  });

  suite('icon per status', () => {
    const cases: Array<[FileStatus['status'], string]> = [
      ['M', 'edit'],
      ['A', 'add'],
      ['?', 'add'],
      ['D', 'trash'],
      ['R', 'arrow-right'],
      ['C', 'copy'],
    ];
    for (const [status, expectedId] of cases) {
      test(`status '${status}' -> $(${expectedId})`, () => {
        const item = new WorktreeFileItem(
          makeFileStatus({ status }),
          '/repo/wt',
          'main',
          'sha',
          mockFileUri('/repo/wt', 'file.ts', 'main')
        );
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, expectedId);
      });
    }
  });
});

suite('WorktreeItem — collapsible state and resourceUri', () => {
  const makeWt = (overrides: Partial<Worktree> = {}): Worktree => ({
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

  test('is Collapsed when pathExists && !bare', () => {
    const item = new WorktreeItem(makeWt(), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  // Every worktree row is collapsible, whatever its state. A row without a
  // twistie leaves a hole in the twistie column, and with only 8px of nesting
  // that made a top-level worktree read as a child of the row above it.
  const alwaysCollapsible: Array<[string, Partial<Worktree>]> = [
    ['missing', { pathExists: false }],
    ['bare', { bare: true }],
    ['not checked out', { isVirtual: true, pathExists: false }],
  ];
  for (const [name, overrides] of alwaysCollapsible) {
    test(`is Collapsed when ${name}`, () => {
      const item = new WorktreeItem(
        makeWt(overrides),
        '/repo',
        vscode.Uri.parse('ygg-worktree:dummy')
      );
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });
  }

  test('has no .command property', () => {
    const item = new WorktreeItem(makeWt(), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.command, undefined);
  });

  test('locked suffix is present on the first render, not only after a refresh', () => {
    const item = new WorktreeItem(
      makeWt({ branch: 'feat', locked: true }),
      '/repo',
      vscode.Uri.parse('ygg-worktree:dummy')
    );
    assert.strictEqual(item.label, 'feat (locked)');
  });

  test('virtual worktree keeps its description across updateFrom', () => {
    // A virtual worktree's `path` is the sentinel `VIRTUAL:<branch>`, so running
    // it through path.relative produces garbage like `../../../VIRTUAL:main`.
    const wt = makeWt({ path: 'VIRTUAL:main', branch: 'main', pathExists: false, isVirtual: true });
    const uri = vscode.Uri.parse('ygg-worktree:dummy');
    const item = new WorktreeItem(wt, '/repo', uri);
    assert.strictEqual(item.description, '(not checked out)');

    item.updateFrom(wt, '/repo', uri);
    assert.strictEqual(item.description, '(not checked out)');
  });

  test('contextValue tracks state changes on a reused instance', () => {
    // Instances are reused from instanceCache across refreshes. A stale
    // contextValue means the menu clauses in package.json stop matching: a
    // worktree whose folder was deleted would keep offering Switch and Remove
    // while hiding the Prune its own row tells the user to run.
    const uri = vscode.Uri.parse('ygg-worktree:dummy');
    const item = new WorktreeItem(makeWt({ path: '/repo/wt' }), '/repo', uri);
    assert.strictEqual(item.contextValue, 'worktreeItem');

    item.updateFrom(makeWt({ path: '/repo/wt', pathExists: false }), '/repo', uri);
    assert.strictEqual(item.contextValue, 'worktreeItemMissing');

    item.updateFrom(makeWt({ path: '/repo/wt', isCurrent: true }), '/repo', uri);
    assert.strictEqual(item.contextValue, 'worktreeItemCurrent');

    item.updateFrom(makeWt({ path: '/repo/wt', bare: true }), '/repo', uri);
    assert.strictEqual(item.contextValue, 'worktreeItemBare');
  });

  test('missing worktree is described as missing, not as a relative path', () => {
    const wt = makeWt({ path: '/gone/wt', pathExists: false });
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.description, 'missing');
  });

  test('assigned colour goes on the icon so it survives row selection', () => {
    // list.activeSelectionForeground repaints the label of the focused row, so
    // the worktree colour has to ride on the icon to stay visible when selected.
    const icon = WorktreeItem.iconFor(makeWt({ isDirty: true }), 'ygg.worktreeColor.5');
    assert.strictEqual(icon.id, 'source-control', 'glyph still reports state');
    assert.strictEqual((icon.color as vscode.ThemeColor | undefined)?.id, 'ygg.worktreeColor.5');
  });

  test('without an assigned colour the icon falls back to state colours', () => {
    const icon = WorktreeItem.iconFor(makeWt({ isDirty: true }));
    assert.strictEqual(icon.id, 'source-control');
    assert.strictEqual(
      (icon.color as vscode.ThemeColor | undefined)?.id,
      'gitDecoration.modifiedResourceForeground'
    );
  });

  test('a broken worktree keeps the error colour over its assigned colour', () => {
    const icon = WorktreeItem.iconFor(makeWt({ pathExists: false }), 'ygg.worktreeColor.5');
    assert.strictEqual(icon.id, 'warning');
    assert.strictEqual((icon.color as vscode.ThemeColor | undefined)?.id, 'list.errorForeground');
  });

  suite('folder rows', () => {
    const makeFolder = (colorId?: string): WorktreeFolderItem =>
      new WorktreeFolderItem(
        'src',
        'src',
        '/repo/wt',
        'main',
        'sha',
        [],
        vscode.Uri.parse('ygg-worktree:dummy'),
        colorId
      );

    test('render a folder codicon', () => {
      assert.strictEqual((makeFolder().iconPath as vscode.ThemeIcon).id, 'folder');
    });

    test('carry no resourceUri', () => {
      // A collapsible item with a resourceUri renders as FileKind.FOLDER through
      // the icon theme and ignores iconPath outright — verified in an Extension
      // Development Host, where neither ThemeIcon.Folder nor a literal
      // ThemeIcon('folder') drew anything with one set.
      assert.strictEqual(makeFolder().resourceUri, undefined);
    });

    test('take the worktree tint on the icon, since they get no decoration', () => {
      const icon = makeFolder('ygg.worktreeColor.3').iconPath as vscode.ThemeIcon;
      assert.strictEqual((icon.color as vscode.ThemeColor | undefined)?.id, 'ygg.worktreeColor.3');
    });
  });

  test('a worktree with no working tree expands to one explanatory row', async () => {
    const wt: Worktree = {
      path: '/repo/gone',
      branch: 'gone',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: false,
      pathExists: false,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => {
        throw new Error('should not be asked — there is no working tree');
      },
    } as any;

    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    const children = (await provider.getChildren(item)) as vscode.TreeItem[];

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, 'Folder is missing');
  });

  test('rows inside a worktree never use real file URIs', async () => {
    // A FileDecoration follows a URI everywhere it appears, so real paths would
    // tint the Explorer and editor tabs as well as this tree.
    const files: FileStatus[] = [{ relativePath: 'src/a.ts', status: 'M', isUntracked: false }];
    const wt: Worktree = {
      path: '/repo/feat',
      branch: 'feat',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: true,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({ files, baseSha: 'sha', baseRef: 'main' }),
    } as any;

    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = (await provider.getChildren(item)) as WorktreeFileItem[];

    assert.strictEqual(children[0].resourceUri?.scheme, 'ygg-worktree');
  });

  test('current worktree keeps its check icon even when dirty', () => {
    // State rides on the decoration badge, so `check` no longer has to lose a
    // race against `source-control` to say "you are here".
    const icon = WorktreeItem.iconFor(makeWt({ isCurrent: true, isDirty: true }));
    assert.strictEqual(icon.id, 'check');
  });

  test('has resourceUri with ygg-worktree scheme and branch query', () => {
    const item = new WorktreeItem(
      makeWt({ path: '/repo/wt', branch: 'feat' }),
      '/repo',
      vscode.Uri.parse('ygg-worktree:dummy')
    );
    assert.strictEqual(item.resourceUri?.scheme, 'ygg-worktree');
  });
});

suite('WorktreeProvider.getChildren — branch dispatch', () => {
  test('returns [] for WorktreeFileItem (leaf)', async () => {
    const file: FileStatus = { relativePath: 'foo.ts', status: 'M', isUntracked: false };
    const leaf = new WorktreeFileItem(
      file,
      '/repo',
      'main',
      'sha',
      mockFileUri('/repo', 'foo.ts', 'main')
    );
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
    } as any;
    const provider = new WorktreeProvider(git);
    const children = await provider.getChildren(leaf);
    assert.deepStrictEqual(children, []);
  });

  test('returns nested tree when worktree has branch changes', async () => {
    const file: FileStatus = { relativePath: 'src/index.ts', status: 'M', isUntracked: false };
    const wt: Worktree = {
      path: '/repo/feat',
      branch: 'feat',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: true,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({
        files: [file],
        baseSha: 'baseSHA',
        baseRef: 'main',
      }),
      getRepoRoot: async () => '/repo',
    } as any;
    const provider = new WorktreeProvider(git, undefined, undefined, () => 'tree');
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = await provider.getChildren(item);

    // Should be WorktreeFolderItem('src')
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof WorktreeFolderItem);
    const folder = children[0] as WorktreeFolderItem;
    assert.strictEqual(folder.label, 'src');
    assert.strictEqual(folder.children.length, 1);

    // Should be WorktreeFileItem('index.ts')
    assert.ok(folder.children[0] instanceof WorktreeFileItem);
    const child = folder.children[0] as WorktreeFileItem;
    assert.strictEqual(child.label, 'index.ts');
    assert.strictEqual(child.file.relativePath, 'src/index.ts');
  });

  test('default list layout keeps every level leaves-only', async () => {
    // The mixed case — a folder beside a file in one level — is what VS Code
    // renders with the wrong indent, so the default layout never produces it.
    const files: FileStatus[] = [
      { relativePath: 'src/index.ts', status: 'M', isUntracked: false },
      { relativePath: 'readme.md', status: 'A', isUntracked: false },
    ];
    const wt: Worktree = {
      path: '/repo/feat',
      branch: 'feat',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: true,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({ files, baseSha: 'baseSHA', baseRef: 'main' }),
    } as any;

    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = (await provider.getChildren(item)) as WorktreeFileItem[];

    assert.strictEqual(children.length, 2);
    assert.ok(
      children.every((c) => c instanceof WorktreeFileItem),
      'no folder rows in list layout'
    );
    const nested = children.find((c) => c.file.relativePath === 'src/index.ts')!;
    const root = children.find((c) => c.file.relativePath === 'readme.md')!;
    assert.strictEqual(nested.label, 'index.ts');
    assert.strictEqual(
      nested.description,
      'M · src',
      'status and directory both in the description'
    );
    assert.strictEqual(root.description, 'A', 'no separator for a root-level file');
  });

  test('returns flat list for root files', async () => {
    const file: FileStatus = { relativePath: 'readme.md', status: 'M', isUntracked: false };
    const wt: Worktree = {
      path: '/repo/feat',
      branch: 'feat',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: true,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({
        files: [file],
        baseSha: 'baseSHA',
        baseRef: 'main',
      }),
    } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = await provider.getChildren(item);

    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof WorktreeFileItem);
    assert.strictEqual(children[0].label, 'readme.md');
  });

  test('returns single "No changes on branch" TreeItem when branch is clean', async () => {
    const wt: Worktree = {
      path: '/repo/feat',
      branch: 'feat',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: false,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({ files: [], baseSha: 'sha', baseRef: 'main' }),
    } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const clean = children[0] as vscode.TreeItem;
    assert.strictEqual(clean.label, 'No changes on branch');
    assert.strictEqual(clean.description, 'relative to main');
    assert.ok(!(clean instanceof WorktreeFileItem));
  });

  test('returns error TreeItem when git.getWorktreeBranchChanges throws', async () => {
    const wt: Worktree = {
      path: '/repo/feat',
      branch: 'feat',
      head: 'abc',
      isCurrent: false,
      isMain: false,
      isDirty: true,
      pathExists: true,
      locked: false,
      bare: false,
    };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => {
        throw new Error('git error');
      },
    } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const errorItem = children[0] as vscode.TreeItem;
    // The label stays short and readable; the raw git message goes to the
    // description and tooltip so it cannot truncate the row into nonsense.
    assert.strictEqual(errorItem.label, 'Could not read branch changes');
    assert.strictEqual(errorItem.description, 'git error');
    assert.ok((errorItem.tooltip as vscode.MarkdownString).value.includes('git error'));
    assert.strictEqual(errorItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.ok(errorItem.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((errorItem.iconPath as vscode.ThemeIcon).id, 'error');
  });
});

suite('Worktree Sorting', () => {
  const makeWt = (branch: string, isMain: boolean): Worktree => ({
    path: `/repo/${branch}`,
    branch,
    head: 'abc',
    isCurrent: false,
    isMain,
    isDirty: false,
    pathExists: true,
    locked: false,
    bare: false,
  });

  test('sorts main and develop branches first', async () => {
    const worktrees: Worktree[] = [
      makeWt('feature-b', false),
      makeWt('develop', false),
      makeWt('main', false),
      makeWt('feature-a', true),
    ];

    const git = {
      getCachedWorktrees: () => worktrees,
      getCachedRepoRoot: () => '/repo',
      getWorkspaceRoot: () => '/repo',
      listWorktrees: async () => worktrees,
      getRepoRoot: async () => '/repo',
    } as any;

    const provider = new WorktreeProvider(git);
    const children = (await provider.getChildren()) as WorktreeItem[];

    // Expected order:
    // 1. main
    // 2. develop
    // 3. feature-a (isMain)
    // 4. feature-b (alphabetical)

    assert.strictEqual(children[0].worktree.branch, 'main');
    assert.strictEqual(children[1].worktree.branch, 'develop');
    assert.strictEqual(children[2].worktree.branch, 'feature-a');
    assert.strictEqual(children[2].worktree.isMain, true);
    assert.strictEqual(children[3].worktree.branch, 'feature-b');
  });

  test('sorts master first if main/develop do not exist', async () => {
    const worktrees: Worktree[] = [makeWt('feature-x', true), makeWt('master', false)];

    const git = {
      getCachedWorktrees: () => worktrees,
      getCachedRepoRoot: () => '/repo',
      getWorkspaceRoot: () => '/repo',
      listWorktrees: async () => worktrees,
      getRepoRoot: async () => '/repo',
    } as any;

    const provider = new WorktreeProvider(git);
    const children = (await provider.getChildren()) as WorktreeItem[];

    assert.strictEqual(children[0].worktree.branch, 'master');
    assert.strictEqual(children[1].worktree.branch, 'feature-x');
  });
});
