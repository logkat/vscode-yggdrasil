import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

export async function execFileNoThrow(
  cmd: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  try {
    const result = await execFileAsync(cmd, args, {
      cwd: options?.cwd,
      env: options?.env,
      timeout: options?.timeout,
    });
    return { stdout: result.stdout, stderr: result.stderr, status: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    if (e.code === 'ENOENT') {
      return { stdout: '', stderr: e.message ?? 'ENOENT', status: -1 };
    }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      status: typeof e.code === 'number' ? e.code : 1,
    };
  }
}
