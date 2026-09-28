import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveChildCommand } from '../src/app/child-commands.js';
import { loadEnvFile } from '../src/app/load-env.js';

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

describe('resolveChildCommand', () => {
  it('runs the compiled API entrypoint in production mode', () => {
    const command = resolveChildCommand({
      watch: false,
      entryDir: '/app/dist',
      projectRoot: '/app',
      execPath: '/usr/bin/node',
    });

    expect(command).toEqual({ command: '/usr/bin/node', args: ['/app/dist/main.js'] });
  });

  it('uses tsx watch for the API in development', () => {
    const command = resolveChildCommand({
      watch: true,
      entryDir: join(process.cwd(), 'src'),
      projectRoot: process.cwd(),
      execPath: '/usr/bin/node',
    });

    expect(command.args).toContain('watch');
    expect(command.args.at(-1)).toMatch(/main\.ts$/);
  });
});
