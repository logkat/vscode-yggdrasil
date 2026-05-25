import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorktreeFileItem, WorktreeItem, WorktreeProvider } from '../../tree/WorktreeProvider';
import { FileStatus, Worktree } from '../../git/GitService';

function makeFileStatus(overrides: Partial<FileStatus> = {}): FileStatus {
  return {
    relativePath: 'src/foo.ts',
    status: 'M',
    isUntracked: false,
    ...overrides,
  };
}

suite('WorktreeFileItem', () => {
  test('label is relativePath', () => {
    const item = new WorktreeFileItem(makeFileStatus({ relativePath: 'src/bar.ts' }), '/repo/wt', 'feature/x', 'baseSHA');
    assert.strictEqual(item.label, 'src/bar.ts');
  });

  test('description is the status code', () => {
    const item = new WorktreeFileItem(makeFileStatus({ status: 'M' }), '/repo/wt', 'main', 'sha');
    assert.strictEqual(item.description, 'M');
  });

  test('contextValue is worktreeFile', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'sha');
    assert.strictEqual(item.contextValue, 'worktreeFile');
  });

  test('command is ygg.openDiff with item as argument', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'sha');
    assert.strictEqual(item.command?.command, 'ygg.openDiff');
    assert.deepStrictEqual(item.command?.arguments, [item]);
  });

  test('collapsible state is None (leaf)', () => {
    const item = new WorktreeFileItem(makeFileStatus(), '/repo/wt', 'main', 'sha');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('stores file, worktreePath, branch as public properties', () => {
    const file = makeFileStatus();
    const item = new WorktreeFileItem(file, '/repo/wt', 'feature/y', 'abc');
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
        const item = new WorktreeFileItem(makeFileStatus({ status }), '/repo/wt', 'main', 'sha');
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, expectedId);
      });
    }
  });
});

suite('WorktreeItem — collapsible state', () => {
  const makeWt = (overrides: Partial<Worktree> = {}): Worktree => ({
    path: '/repo/main', branch: 'main', head: 'abc', isCurrent: false,
    isDirty: false, pathExists: true, locked: false, bare: false,
    ...overrides,
  });

  test('is Collapsed when pathExists && !bare', () => {
    const item = new WorktreeItem(makeWt(), '/repo');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test('is None when !pathExists', () => {
    const item = new WorktreeItem(makeWt({ pathExists: false }), '/repo');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('is None when bare', () => {
    const item = new WorktreeItem(makeWt({ bare: true }), '/repo');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('has no .command property', () => {
    const item = new WorktreeItem(makeWt(), '/repo');
    assert.strictEqual(item.command, undefined);
  });
});

suite('WorktreeProvider.getChildren — branch dispatch', () => {
  test('returns [] for WorktreeFileItem (leaf)', async () => {
    const file: FileStatus = { relativePath: 'foo.ts', status: 'M', isUntracked: false };
    const leaf = new WorktreeFileItem(file, '/repo', 'main', 'sha');
    // Provide a minimal git stub — getChildren for a leaf should never call git
    const git = {} as any;
    const provider = new WorktreeProvider(git);
    const children = await provider.getChildren(leaf);
    assert.deepStrictEqual(children, []);
  });

  test('returns WorktreeFileItem[] when worktree has branch changes', async () => {
    const file: FileStatus = { relativePath: 'src/index.ts', status: 'M', isUntracked: false };
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isDirty: true, pathExists: true, locked: false, bare: false };
    const git = { getWorktreeBranchChanges: async () => ({ files: [file], baseSha: 'baseSHA', baseRef: 'main' }) } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo');
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof WorktreeFileItem);
    const child = children[0] as WorktreeFileItem;
    assert.strictEqual(child.file.relativePath, 'src/index.ts');
    assert.strictEqual(child.worktreePath, '/repo/feat');
    assert.strictEqual(child.branch, 'feat');
    assert.strictEqual(child.baseSha, 'baseSHA');
  });

  test('returns single "No changes on branch" TreeItem when branch is clean', async () => {
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isDirty: false, pathExists: true, locked: false, bare: false };
    const git = { getWorktreeBranchChanges: async () => ({ files: [], baseSha: 'sha', baseRef: 'main' }) } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo');
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const clean = children[0] as vscode.TreeItem;
    assert.strictEqual(clean.label, 'No changes on branch');
    assert.strictEqual(clean.description, 'relative to main');
    assert.ok(!(clean instanceof WorktreeFileItem));
  });

  test('returns error TreeItem when git.getWorktreeBranchChanges throws', async () => {
    const wt: Worktree = { path: '/repo/feat', branch: 'feat', head: 'abc',
      isCurrent: false, isDirty: true, pathExists: true, locked: false, bare: false };
    const git = { getWorktreeBranchChanges: async () => { throw new Error('git error'); } } as any;
    const provider = new WorktreeProvider(git);
    const item = new WorktreeItem(wt, '/repo');
    const children = await provider.getChildren(item);
    assert.strictEqual(children.length, 1);
    const errorItem = children[0] as vscode.TreeItem;
    assert.strictEqual(errorItem.label, 'Error: git error');
    assert.strictEqual(errorItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.ok(errorItem.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((errorItem.iconPath as vscode.ThemeIcon).id, 'error');
  });
});
