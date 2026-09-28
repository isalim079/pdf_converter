import { spawn, type ChildProcess } from 'node:child_process';

import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';

export interface RunProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export async function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv } = { timeoutMs: 120_000 },
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new AppError(ERROR_CODES.CONVERSION_TIMEOUT, 'Conversion timed out', { retryable: true }));
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      finish(
        new AppError(ERROR_CODES.ENGINE_UNAVAILABLE, `Failed to start ${command}`, {
          retryable: true,
          expose: true,
          cause: error,
        }),
      );
    });
    child.once('close', (code) => {
      if (code === 0) {
        finish(undefined, { stdout, stderr, code });
        return;
      }
      const detail = (stderr || stdout).replace(/\s+/g, ' ').trim().slice(0, 400);
      finish(
        new AppError(
          ERROR_CODES.CONVERSION_FAILED,
          detail ? `Conversion process failed: ${detail}` : `Conversion process failed (exit ${code})`,
          {
            expose: true,
            cause: new Error(stderr.slice(0, 500) || `exit ${code}`),
          },
        ),
      );
    });

    function finish(error?: Error, result?: RunProcessResult): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? { stdout, stderr, code: 0 });
    }
  });
}

export async function stopChildProcess(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill('SIGTERM');
  await waitForChildExit(child, timeoutMs);
  if (child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL');
    await waitForChildExit(child, 2_000);
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
