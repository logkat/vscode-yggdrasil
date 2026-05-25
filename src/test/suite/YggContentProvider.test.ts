import * as assert from 'assert';
import * as vscode from 'vscode';
import { YggContentProvider, makeUri } from '../../content/YggContentProvider';

suite('YggContentProvider', () => {
  suite('makeUri', () => {
    test('encodes side, wt, file into query string', () => {
      const uri = makeUri('BASE', '/repo/my worktree', 'src/foo bar.ts', 'abc123');
      assert.strictEqual(uri.scheme, 'ygg-git');
      assert.strictEqual(uri.path, '/diff');
      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get('side'), 'BASE');
      assert.strictEqual(params.get('wt'), '/repo/my worktree');
      assert.strictEqual(params.get('file'), 'src/foo bar.ts');
      assert.strictEqual(params.get('sha'), 'abc123');
    });

    test('round-trips wt with slashes intact', () => {
      const wt = '/home/user/projects/my-feature';
      const file = 'src/components/Button.tsx';
      const uri = makeUri('WORK', wt, file);
      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get('wt'), wt);
      assert.strictEqual(params.get('file'), file);
    });
  });

  suite('provideTextDocumentContent', () => {
    test('BASE side: returns stdout on success', async () => {
      const run = async (_cmd: string, _args: string[], _opts: any) =>
        ({ status: 0, stdout: 'hello world\n', stderr: '' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo', 'src/index.ts', 'sha123');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, 'hello world\n');
    });

    test('BASE side: returns "" on non-zero exit', async () => {
      const run = async () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repo' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo', 'missing.ts', 'sha123');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '');
    });

    test('BASE side: returns binary message when null byte in first 8000 bytes', async () => {
      const binaryContent = 'PNG\x89' + '\0' + 'rest';
      const run = async () => ({ status: 0, stdout: binaryContent, stderr: '' });
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo', 'image.png', 'sha123');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '(binary file — diff not available)');
    });

    test('BASE side: passes correct git args and cwd', async () => {
      let capturedArgs: string[] = [];
      let capturedCwd = '';
      const run = async (_cmd: string, args: string[], opts: any) => {
        capturedArgs = args;
        capturedCwd = opts?.cwd ?? '';
        return { status: 0, stdout: 'file content', stderr: '' };
      };
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('BASE', '/repo/worktree', 'src/module.ts', 'baseSHA');
      await provider.provideTextDocumentContent(uri);
      assert.deepStrictEqual(capturedArgs, ['show', 'baseSHA:src/module.ts']);
      assert.strictEqual(capturedCwd, '/repo/worktree');
    });

    test('WORK side: reads from disk (mocked by injecting a stub)', async () => {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ygg-test-'));
      const tmpFile = path.join(tmpDir, 'test.ts');
      fs.writeFileSync(tmpFile, 'const x = 1;\n', 'utf8');
      try {
        const run = async () => ({ status: 0, stdout: '', stderr: '' }); // unused for WORK
        const provider = new YggContentProvider(run as any);
        const uri = makeUri('WORK', tmpDir, 'test.ts');
        const content = await provider.provideTextDocumentContent(uri);
        assert.strictEqual(content, 'const x = 1;\n');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('WORK side: returns "" on ENOENT', async () => {
      const run = async () => ({ status: 0, stdout: '', stderr: '' }); // unused
      const provider = new YggContentProvider(run as any);
      const uri = makeUri('WORK', '/nonexistent-dir-abc123', 'no-such-file.ts');
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '');
    });

    test('unknown side returns ""', async () => {
      const run = async () => ({ status: 0, stdout: '', stderr: '' });
      const provider = new YggContentProvider(run as any);
      // Build a URI manually with side=BOGUS
      const uri = vscode.Uri.from({
        scheme: 'ygg-git',
        path: '/diff',
        query: new URLSearchParams({ side: 'BOGUS', wt: '/repo', file: 'x.ts' }).toString(),
      });
      const content = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(content, '');
    });
  });
});
