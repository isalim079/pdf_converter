import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import closeWithGrace from 'close-with-grace';

import { resolveChildCommands } from './app/child-commands.js';
import { getConfig } from './app/config.js';
import { loadEnvFile } from './app/load-env.js';
import {
  buildGotenbergArgs,
  probeGotenbergHealth,
  shouldSpawnGotenberg,
  spawnGotenbergProcess,
  stopChildProcess,
  waitForGotenbergHealth,
} from './infrastructure/gotenberg/supervisor.js';
import { createLogger } from './infrastructure/logging/logger.js';

loadEnvFile();

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger();
  const watch = process.argv.includes('--watch');
  const entryDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(entryDir, '..');

  let gotenberg: ChildProcess | undefined;
  const children: ChildProcess[] = [];
  let shuttingDown = false;
  let stopInProgress = false;

  const shutdown = async (signal: string) => {
    shuttingDown = true;
    if (stopInProgress) {
      return;
    }
    stopInProgress = true;
    logger.info({ signal }, 'Supervisor shutting down');

    await Promise.all(children.map((child) => stopChildProcess(child, 10_000)));
    if (gotenberg) {
      await stopChildProcess(gotenberg, 10_000);
    }
  };

  process.once('SIGINT', () => {
    shuttingDown = true;
  });
  process.once('SIGTERM', () => {
    shuttingDown = true;
  });

  const gotenbergBin = config.GOTENBERG_BIN;
  const alreadyHealthy = await probeGotenbergHealth(config.GOTENBERG_URL);
  if (shouldSpawnGotenberg(gotenbergBin, alreadyHealthy) && gotenbergBin) {
    const args = buildGotenbergArgs({
      timeoutSeconds: config.PDF_JOB_TIMEOUT_SECONDS,
      baseUrl: config.GOTENBERG_URL,
    });
    logger.info({ bin: gotenbergBin, args }, 'Starting local Gotenberg');
    gotenberg = spawnGotenbergProcess(gotenbergBin, args);
    gotenberg.once('error', (error) => {
      logger.fatal({ err: error, bin: gotenbergBin }, 'Failed to spawn Gotenberg');
      process.exit(1);
    });
    try {
      await waitForGotenbergHealth({
        baseUrl: config.GOTENBERG_URL,
        timeoutMs: 60_000,
      });
    } catch (error) {
      await stopChildProcess(gotenberg, 5_000);
      throw error;
    }
    logger.info({ url: config.GOTENBERG_URL }, 'Local Gotenberg is healthy');
  } else if (gotenbergBin) {
    logger.info({ url: config.GOTENBERG_URL }, 'Gotenberg already reachable; not spawning GOTENBERG_BIN');
  }

  const commands = resolveChildCommands({
    watch,
    entryDir,
    projectRoot,
    execPath: process.execPath,
  });

  const api = spawn(commands.api.command, commands.api.args, {
    stdio: 'inherit',
    cwd: projectRoot,
    env: process.env,
  });
  const worker = spawn(commands.worker.command, commands.worker.args, {
    stdio: 'inherit',
    cwd: projectRoot,
    env: process.env,
  });
  children.push(api, worker);

  logger.info({ watch, concurrency: config.PDF_WORKER_CONCURRENCY }, 'API and worker started');

  const onChildExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
    if (shuttingDown) {
      return;
    }
    logger.fatal({ name, code, signal }, 'Child process exited unexpectedly');
    process.exitCode = code && code !== 0 ? code : 1;
    void shutdown('child-exit').then(() => {
      process.exit(process.exitCode ?? 1);
    });
  };

  api.once('exit', (code, signal) => onChildExit('api', code, signal));
  worker.once('exit', (code, signal) => onChildExit('worker', code, signal));
  if (gotenberg) {
    gotenberg.once('exit', (code, signal) => onChildExit('gotenberg', code, signal));
  }

  closeWithGrace({ delay: config.PDF_JOB_TIMEOUT_SECONDS * 1000 }, async ({ signal, err }) => {
    if (err) {
      logger.error({ err }, 'Supervisor closing after error');
    }
    await shutdown(signal ?? 'error');
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
