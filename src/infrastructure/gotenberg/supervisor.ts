import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export function shouldSpawnGotenberg(bin: string | undefined, alreadyHealthy: boolean): boolean {
  return Boolean(bin) && !alreadyHealthy;
}

export function gotenbergListenPort(baseUrl: string): number {
  const parsed = new URL(baseUrl);
  if (parsed.port) {
    return Number(parsed.port);
  }
  return parsed.protocol === 'https:' ? 443 : 80;
}

export function buildGotenbergArgs(options: { timeoutSeconds: number; baseUrl: string }): string[] {
  return [
    `--api-bind-ip=127.0.0.1`,
    `--api-port=${gotenbergListenPort(options.baseUrl)}`,
    `--api-timeout=${options.timeoutSeconds}s`,
    '--libreoffice-restart-after=10',
    '--log-level=info',
  ];
}

export async function probeGotenbergHealth(baseUrl: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForGotenbergHealth(input: {
  baseUrl: string;
  timeoutMs: number;
  intervalMs?: number;
  probe?: (url: string) => Promise<boolean>;
}): Promise<void> {
  const probe = input.probe ?? ((url) => probeGotenbergHealth(url));
  const intervalMs = input.intervalMs ?? 500;
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    if (await probe(input.baseUrl)) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Gotenberg did not become healthy at ${input.baseUrl}`);
}

export function spawnGotenbergProcess(
  bin: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  return spawn(bin, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    ...options,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
