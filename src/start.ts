import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import closeWithGrace from 'close-with-grace';

import { resolveChildCommand } from './app/child-commands.js';
import { getConfig } from './app/config.js';
import { loadEnvFile } from './app/load-env.js';
import { stopChildProcess } from './infrastructure/engines/process.js';
import { createLogger } from './infrastructure/logging/logger.js';

loadEnvFile();

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger();
  const watch = process.argv.includes('--watch');
  const entryDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(entryDir, '..');

  let shuttingDown = false;
  let stopInProgress = false;

  const command = resolveChildCommand({
    watch,
    entryDir,
    projectRoot,
    execPath: process.execPath,
  });

  const api = spawn(command.command, command.args, {
    stdio: 'inherit',
    cwd: projectRoot,
    env: process.env,
  });

  logger.info({ watch }, 'API started');

  const shutdown = async (signal: string) => {
    shuttingDown = true;
    if (stopInProgress) {
      return;
    }
    stopInProgress = true;
    logger.info({ signal }, 'Supervisor shutting down');
    await stopChildProcess(api, 10_000);
  };

  process.once('SIGINT', () => {
    shuttingDown = true;
  });
  process.once('SIGTERM', () => {
    shuttingDown = true;
  });

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
