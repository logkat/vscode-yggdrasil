import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFileNoThrow } from '../utils/execFileNoThrow';

type RunFn = typeof execFileNoThrow;

export function makeUri(side: 'BASE', wt: string, file: string, sha: string): vscode.Uri;
export function makeUri(side: 'WORK', wt: string, file: string): vscode.Uri;
export function makeUri(side: 'BASE' | 'WORK', wt: string, file: string, sha?: string): vscode.Uri {
  const params: Record<string, string> = { side, wt, file };
  if (sha) {
    params.sha = sha;
  }
  return vscode.Uri.from({
    scheme: 'ygg-git',
    path: '/diff',
    query: new URLSearchParams(params).toString(),
  });
}

export class YggContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly run: RunFn = execFileNoThrow) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const side = params.get('side');
    const wt = params.get('wt')!;
    const file = params.get('file')!;

    if (side === 'BASE') {
      const sha = params.get('sha')!;
      const gitPath = file.split(path.sep).join('/');
      const result = await this.run('git', ['show', `${sha}:${gitPath}`], { cwd: wt });

      // If result.status is non-zero, the file might not exist in the base commit.
      // We return empty string to show an "added file" diff (empty left side).
      if (result.status !== 0) {
        return '';
      }

      if (result.stdout.slice(0, 8000).includes('\0')) {
        return '(binary file — diff not available)';
      }
      return result.stdout;
    }

    if (side === 'WORK') {
      try {
        // Reject absolute paths before resolving so path.resolve(wt, file)
        // cannot silently discard the worktree base when file starts with '/'.
        if (path.isAbsolute(file)) {
          return '';
        }
        const fullPath = path.resolve(wt, file);
        const resolvedWt = path.resolve(wt);
        // Ensure the resolved path is strictly inside the worktree root.
        // path.relative returns '' for equal paths and '..'-prefixed strings
        // for paths outside the root — both should be rejected.
        const rel = path.relative(resolvedWt, fullPath);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
          return '';
        }
        return await fs.promises.readFile(fullPath, 'utf8');
      } catch {
        return '';
      }
    }

    return '';
  }
}
