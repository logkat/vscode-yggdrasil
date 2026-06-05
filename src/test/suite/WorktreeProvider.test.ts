import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorktreeFileItem, WorktreeFolderItem, WorktreeItem, WorktreeProvider } from '../../tree/WorktreeProvider';
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
  return vscode.Uri.parse(`ygg-worktree://worktree?path=${encodeURIComponent(path.join(wtPath, relativePath))}&branch=${encodeURIComponent(branch)}`);
}

suite('WorktreeFileItem', () => {
  test('label is filename only', () => {
    const wtPath = '/repo/wt';
    const branch = 'feature/x';
    const relativePath = 'src/bar.ts';
    const item = new WorktreeFileItem(makeFileStatus({ relativePath }), wtPath, branch, 'baseSHA', mockFileUri(wtPath, relativePath, branch));
    assert.strictEqual(item.label, 'bar.ts');
  });

  test('description is the status code', () => {
    const item = new WorktreeFileItem(makeFileStatus({ status: 'M' }), '/repo/wt', 'main', 'sha', mockFileUri('/repo/wt', 'file.ts', 'main'));
    assert.strictEqual(item.description, 'M');
  });

  test('contextValue is worktreeFile', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'sha', mockFileUri('/repo/wt', 'file.ts', 'main'));
    assert.strictEqual(item.contextValue, 'worktreeFile');
  });

  test('command is ygg.openDiff with item as argument', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'sha', mockFileUri('/repo/wt', 'file.ts', 'main'));
    assert.strictEqual(item.command?.command, 'ygg.openDiff');
    assert.deepStrictEqual(item.command?.arguments, [item]);
  });

  test('collapsible state is None (leaf)', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'sha', mockFileUri('/repo/wt', 'file.ts', 'main'));
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('stores file, worktreePath, branch as public properties', () => {
    const file = makeFileStatus();
    const item = new WorktreeFileItem(file, '/repo/wt', 'feature/y', 'abc', mockFileUri('/repo/wt', 'file.ts', 'feature/y'));
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
        const item = new WorktreeFileItem(makeFileStatus({ status }), '/repo/wt', 'main', 'sha', mockFileUri('/repo/wt', 'file.ts', 'main'));
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, expectedId);
      });
    }
  });
});

suite('WorktreeItem — collapsible state and resourceUri', () => {
  const makeWt = (overrides: Partial<Worktree> = {}): Worktree => ({
    path: '/repo/main', branch: 'main', head: 'abc', isCurrent: false,
    isMain: false, isDirty: false, pathExists: true, locked: false, bare: false,
    ...overrides,
  });

  test('is Collapsed when pathExists && !bare', () => {
    const item = new WorktreeItem(makeWt(), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test('is None when !pathExists', () => {
    const item = new WorktreeItem(makeWt({ pathExists: false }), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('is None when bare', () => {
    const item = new WorktreeItem(makeWt({ bare: true }), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('has no .command property', () => {
    const item = new WorktreeItem(makeWt(), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.command, undefined);
  });

  test('has resourceUri with ygg-worktree scheme and branch query', () => {
    const item = new WorktreeItem(makeWt({ path: '/repo/wt', branch: 'feat' }), '/repo', vscode.Uri.parse('ygg-worktree:dummy'));
    assert.strictEqual(item.resourceUri?.scheme, 'ygg-worktree');
  });
});

suite('WorktreeProvider.getChildren — branch dispatch', () => {
  test('returns [] for WorktreeFileItem (leaf)', async () => {
    const file: FileStatus = { relativePath: 'foo.ts', status: 'M', isUntracked: false };
    const leaf = new WorktreeFileItem(file, '/repo', 'main', 'sha', mockFileUri('/repo', 'foo.ts', 'main'));
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo'
    } as any;
    const provider = new WorktreeProvider(git);
    const children = await provider.getChildren(leaf);
    assert.deepStrictEqual(children, []);
  });

  test('returns nested tree when worktree has branch changes', async () => {
    const file: FileStatus = { relativePath: 'src/index.ts', status: 'M', isUntracked: false };
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isMain: false, isDirty: true, pathExists: true, locked: false, bare: false };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({ files: [file], baseSha: 'baseSHA', baseRef: 'main' }),
      getRepoRoot: async () => '/repo'
    } as any;
    const provider = new WorktreeProvider(git);
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

  test('returns flat list for root files', async () => {
    const file: FileStatus = { relativePath: 'readme.md', status: 'M', isUntracked: false };
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isMain: false, isDirty: true, pathExists: true, locked: false, bare: false };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({ files: [file], baseSha: 'baseSHA', baseRef: 'main' })
    } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = await provider.getChildren(item);
    
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof WorktreeFileItem);
    assert.strictEqual(children[0].label, 'readme.md');
  });

  test('returns single "No changes on branch" TreeItem when branch is clean', async () => {
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isMain: false, isDirty: false, pathExists: true, locked: false, bare: false };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => ({ files: [], baseSha: 'sha', baseRef: 'main' })
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
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isMain: false, isDirty: true, pathExists: true, locked: false, bare: false };
    const git = {
      getCachedBranchChanges: () => undefined,
      getCachedWorktrees: () => undefined,
      getCachedRepoRoot: () => '/repo',
      getWorktreeBranchChanges: async () => { throw new Error('git error'); }
    } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo', vscode.Uri.parse('ygg-worktree://feat/repo/feat'));
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const errorItem = children[0] as vscode.TreeItem;
    assert.strictEqual(errorItem.label, 'Error: git error');
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
    bare: false
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
      getRepoRoot: async () => '/repo'
    } as any;

    const provider = new WorktreeProvider(git);
    const children = await provider.getChildren() as WorktreeItem[];

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
    const worktrees: Worktree[] = [
      makeWt('feature-x', true),
      makeWt('master', false),
    ];

    const git = {
      getCachedWorktrees: () => worktrees,
      getCachedRepoRoot: () => '/repo',
      getWorkspaceRoot: () => '/repo',
      listWorktrees: async () => worktrees,
      getRepoRoot: async () => '/repo'
    } as any;

    const provider = new WorktreeProvider(git);
    const children = await provider.getChildren() as WorktreeItem[];

    assert.strictEqual(children[0].worktree.branch, 'master');
    assert.strictEqual(children[1].worktree.branch, 'feature-x');
  });
});
