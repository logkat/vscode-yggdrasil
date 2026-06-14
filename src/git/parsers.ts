import * as fs from 'fs';
import * as path from 'path';

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isCurrent: boolean;
  isMain: boolean;
  isDirty: boolean;
  pathExists: boolean;
  locked: boolean;
  bare: boolean;
  dotGit?: string;
  baseRef?: string;
  aheadCount?: number;
  isVirtual?: boolean;
}

export interface FileStatus {
  relativePath: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | 'T' | '?';
  isUntracked: boolean;
}

export function dequotePath(raw: string): string {
  if (!raw.startsWith('"')) {
    return raw;
  }
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  let result = '';
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (/[0-7]/.test(next) && i + 3 < inner.length) {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
        i += 4;
        continue;
      }
      if (bytes.length > 0) {
        result += Buffer.from(bytes).toString('utf8');
        bytes.length = 0;
      }
      const escapes: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
      if (next in escapes) {
        result += escapes[next];
        i += 2;
      } else {
        result += inner[i];
        i++;
      }
    } else {
      if (bytes.length > 0) {
        result += Buffer.from(bytes).toString('utf8');
        bytes.length = 0;
      }
      result += inner[i];
      i++;
    }
  }
  if (bytes.length > 0) {
    result += Buffer.from(bytes).toString('utf8');
  }
  return result;
}

export function parseStatusLine(line: string): FileStatus | null {
  if (line.length < 4) {
    return null;
  }
  const x = line[0];
  const y = line[1];
  const rawStatus = (x !== ' ' ? x : y) as FileStatus['status'];
  if (!['M', 'A', 'D', 'R', 'C', 'U', 'T', '?'].includes(rawStatus)) {
    return null;
  }

  let rest = line.slice(3);

  // Renamed/copied: extract new path after last ' -> '
  if ((rawStatus === 'R' || rawStatus === 'C') && rest.includes(' -> ')) {
    rest = rest.slice(rest.lastIndexOf(' -> ') + 4);
  }

  return {
    relativePath: dequotePath(rest),
    status: rawStatus,
    isUntracked: rawStatus === '?',
  };
}

export function parseDiffNameStatus(output: string): FileStatus[] {
  if (!output.trim()) {
    return [];
  }
  return output
    .trim()
    .split('\n')
    .flatMap((line): FileStatus[] => {
      const parts = line.split('\t');
      if (parts.length < 2) {
        return [];
      }
      const letter = parts[0][0] as FileStatus['status'];
      if (!(['M', 'A', 'D', 'R', 'C', 'U', 'T'] as string[]).includes(letter)) {
        return [];
      }
      const rawPath = (letter === 'R' || letter === 'C') && parts.length >= 3 ? parts[2] : parts[1];
      const dequoted = dequotePath(rawPath);
      // Normalise path separators to forward slashes for internal consistency
      const normalizedPath = dequoted
        .split(path.win32.sep)
        .join('/')
        .split(path.posix.sep)
        .join('/');
      return [{ relativePath: normalizedPath, status: letter, isUntracked: false }];
    });
}

export function parsePorcelain(
  output: string,
  currentRealPath: string
): Omit<Worktree, 'isDirty'>[] {
  const blocks = output.trim().split(/\n\n+/);
  const worktrees: Omit<Worktree, 'isDirty'>[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.trim()) {
      continue;
    }
    const lines = block.split('\n');
    let wtPath = '';
    let head = '';
    let branch = '';
    let locked = false;
    let bare = false;
    let detached = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length);
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      } else if (line === 'detached') {
        detached = true;
      } else if (line === 'bare') {
        bare = true;
      } else if (line.startsWith('locked')) {
        locked = true;
      }
    }

    if (!wtPath) {
      continue;
    }

    // Fallback for branch if not provided by git
    if (!branch && !bare && !detached) {
      branch = path.basename(wtPath) || 'unknown';
    }

    if (bare) {
      branch = '(bare)';
    } else if (detached) {
      branch = '(detached HEAD)';
    }

    let resolvedWt = wtPath;
    try {
      resolvedWt = fs.realpathSync(wtPath);
    } catch {
      /* use raw path */
    }

    worktrees.push({
      path: wtPath,
      branch,
      head,
      isCurrent: resolvedWt === currentRealPath,
      isMain: i === 0, // First entry in 'git worktree list' is the main worktree
      pathExists: fs.existsSync(wtPath),
      locked,
      bare,
    });
  }

  return worktrees;
}
