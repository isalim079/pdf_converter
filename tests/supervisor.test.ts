import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveChildCommands } from '../src/app/child-commands.js';
import { loadEnvFile } from '../src/app/load-env.js';
import {
  buildGotenbergArgs,
  gotenbergListenPort,
  shouldSpawnGotenberg,
  waitForGotenbergHealth,
} from '../src/infrastructure/gotenberg/supervisor.js';

describe('loadEnvFile', () => {
  it('sets missing variables and does not override existing ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-env-'));
    const filePath = join(dir, '.env');
    writeFileSync(filePath, 'LOAD_ENV_TEST_A=from-file\nLOAD_ENV_TEST_B=file-b\n');
    process.env.LOAD_ENV_TEST_A = 'already-set';
    delete process.env.LOAD_ENV_TEST_B;

    loadEnvFile(filePath);

    expect(process.env.LOAD_ENV_TEST_A).toBe('already-set');
    expect(process.env.LOAD_ENV_TEST_B).toBe('file-b');
  });
});

describe('resolveChildCommands', () => {
  it('runs compiled entrypoints in production mode', () => {
    const commands = resolveChildCommands({
      watch: false,
      entryDir: '/app/dist',
      projectRoot: '/app',
      execPath: '/usr/bin/node',
    });

    expect(commands.api).toEqual({ command: '/usr/bin/node', args: ['/app/dist/main.js'] });
    expect(commands.worker).toEqual({ command: '/usr/bin/node', args: ['/app/dist/worker.js'] });
  });

  it('uses tsx watch for the API and worker in development', () => {
    const commands = resolveChildCommands({
      watch: true,
      entryDir: join(process.cwd(), 'src'),
      projectRoot: process.cwd(),
      execPath: '/usr/bin/node',
    });

    expect(commands.api.args).toContain('watch');
    expect(commands.api.args.at(-1)).toMatch(/main\.ts$/);
    expect(commands.worker.args.at(-1)).toMatch(/worker\.ts$/);
  });
});

describe('Gotenberg supervisor', () => {
  it('spawns only when a binary is set and Gotenberg is not already healthy', () => {
    expect(shouldSpawnGotenberg(undefined, false)).toBe(false);
    expect(shouldSpawnGotenberg('/usr/local/bin/gotenberg', true)).toBe(false);
    expect(shouldSpawnGotenberg('/usr/local/bin/gotenberg', false)).toBe(true);
  });

  it('binds Gotenberg to localhost using the configured URL port', () => {
    expect(gotenbergListenPort('http://127.0.0.1:3000')).toBe(3000);
    expect(buildGotenbergArgs({ timeoutSeconds: 120, baseUrl: 'http://127.0.0.1:3000' })).toEqual([
      '--api-bind-ip=127.0.0.1',
      '--api-port=3000',
      '--api-timeout=120s',
      '--libreoffice-restart-after=10',
      '--log-level=info',
    ]);
  });

  it('waits until a health probe succeeds', async () => {
    let attempts = 0;
    await waitForGotenbergHealth({
      baseUrl: 'http://127.0.0.1:3000',
      timeoutMs: 1_000,
      intervalMs: 10,
      probe: async () => {
        attempts += 1;
        return attempts >= 2;
      },
    });
    expect(attempts).toBe(2);
  });

  it('fails when Gotenberg never becomes healthy', async () => {
    await expect(
      waitForGotenbergHealth({
        baseUrl: 'http://127.0.0.1:3000',
        timeoutMs: 40,
        intervalMs: 10,
        probe: async () => false,
      }),
    ).rejects.toThrow(/did not become healthy/);
  });
});
