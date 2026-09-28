import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeUpArgs, decideInfra, missingComposeServices } from '../scripts/ensure-lib/plan.mjs';
import { parseBootArg, upsertEnvFile } from '../scripts/ensure-lib/runtime.mjs';
import {
  COMPOSE_PROJECT,
  composeServiceRunning,
  gotenbergTarget,
  isDestructiveInfraCommand,
  isOurPublishedService,
  parsePublishedPort,
  pickPort,
  toWslPath,
} from '../scripts/ensure-lib/probes.mjs';

const base = {
  platform: 'linux',
  inWsl: false,
  dockerUp: false,
  gotenbergUp: false,
  gotenbergBin: false,
  wslUbuntu: false,
  wslInstallable: false,
};

describe('ensure probes', () => {
  it('parses Gotenberg URLs', () => {
    expect(gotenbergTarget('http://localhost:3000')).toMatchObject({
      host: 'localhost',
      port: 3000,
      origin: 'http://localhost:3000',
    });
    expect(parsePublishedPort('127.0.0.1:3001\n')).toBe(3001);
  });

  it('detects a running Compose service from docker ps output', () => {
    const running = () => ({ status: 0, stdout: 'abc123\n', stderr: '' });
    const stopped = () => ({ status: 0, stdout: '\n', stderr: '' });
    expect(composeServiceRunning(running, 'gotenberg')).toBe(true);
    expect(composeServiceRunning(stopped, 'gotenberg')).toBe(false);
  });

  it('claims a host port only when our Compose service is publishing it', () => {
    const exec = (_cmd, args) => {
      if (args.includes('ps')) {
        return { status: 0, stdout: 'abc123\n', stderr: '' };
      }
      if (args.includes('port')) {
        return { status: 0, stdout: '127.0.0.1:3000\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    };
    expect(isOurPublishedService(exec, 'gotenberg', 3000, 3000)).toBe(true);
    expect(isOurPublishedService(exec, 'gotenberg', 3001, 3000)).toBe(false);
  });

  it('converts Windows paths for WSL', () => {
    expect(toWslPath('C:\\src\\pdf_converter_api')).toBe('/mnt/c/src/pdf_converter_api');
    expect(toWslPath('D:/app')).toBe('/mnt/d/app');
  });

  it('reuses our port and allocates the next when the preferred port is foreign', () => {
    expect(pickPort(3000, { busy: false, ours: false, nextFree: 3000 })).toEqual({
      port: 3000,
      reason: 'free',
    });
    expect(pickPort(3000, { busy: true, ours: true, nextFree: 3001 })).toEqual({
      port: 3000,
      reason: 'ours',
    });
    expect(pickPort(3000, { busy: true, ours: false, nextFree: 3001 })).toEqual({
      port: 3001,
      reason: 'foreign',
    });
  });
});

describe('ensure decision table', () => {
  it('starts only missing Compose services when Docker is up', () => {
    const facts = { ...base, dockerUp: true };
    expect(missingComposeServices(facts)).toEqual(['gotenberg']);
    expect(decideInfra(facts)).toEqual({
      action: 'compose',
      services: ['gotenberg'],
    });
  });

  it('is ready when Gotenberg is already up', () => {
    expect(
      decideInfra({
        ...base,
        gotenbergUp: true,
      }),
    ).toEqual({ action: 'ready' });
  });

  it('is ready on Linux when Gotenberg binary exists even if the HTTP API is down', () => {
    expect(
      decideInfra({
        ...base,
        platform: 'linux',
        gotenbergBin: true,
      }),
    ).toEqual({ action: 'ready' });
  });

  it('installs Linux packages when Docker is missing', () => {
    const plan = decideInfra({ ...base, platform: 'linux' });
    expect(plan.action).toBe('install-linux');
  });

  it('warns images-only on macOS when Gotenberg is not available', () => {
    const plan = decideInfra({
      ...base,
      platform: 'darwin',
    });
    expect(plan.action).toBe('ready-images-only');
  });

  it('re-execs WSL on Windows without Docker', () => {
    const plan = decideInfra({
      ...base,
      platform: 'win32',
      wslUbuntu: true,
    });
    expect(plan.action).toBe('reexec-wsl');
  });

  it('installs WSL when Ubuntu is missing but --install works', () => {
    const plan = decideInfra({
      ...base,
      platform: 'win32',
      wslInstallable: true,
    });
    expect(plan.action).toBe('install-wsl');
  });

  it('uses Hyper-V when Windows has no Docker and no WSL', () => {
    const plan = decideInfra({ ...base, platform: 'win32' });
    expect(plan.action).toBe('hyperv');
  });

  it('uses Compose on Windows when Docker is available', () => {
    const plan = decideInfra({
      ...base,
      platform: 'win32',
      dockerUp: true,
    });
    expect(plan.action).toBe('compose');
    expect(plan.services).toEqual(['gotenberg']);
  });

  it('starts Windows Node when Gotenberg is already reachable', () => {
    expect(
      decideInfra({
        ...base,
        platform: 'win32',
        gotenbergUp: true,
      }),
    ).toEqual({ action: 'ready' });
  });

  it('starts isolated Compose services without down or force-recreate', () => {
    const args = composeUpArgs(['gotenberg']);
    expect(args).toEqual(['compose', '-p', COMPOSE_PROJECT, 'up', '-d', '--build', 'gotenberg']);
    expect(isDestructiveInfraCommand(args)).toBe(false);
    expect(isDestructiveInfraCommand(['compose', 'down'])).toBe(true);
    expect(isDestructiveInfraCommand(['compose', 'up', '--force-recreate'])).toBe(true);
  });
});

describe('parseBootArg', () => {
  it('reads --boot=start', () => {
    expect(parseBootArg(['node', 'ensure-runtime.mjs', '--boot=start'])).toBe('start');
    expect(parseBootArg(['node', 'ensure-runtime.mjs', '--boot', 'dev'])).toBe('dev');
    expect(parseBootArg(['node', 'ensure-runtime.mjs'])).toBe('none');
  });
});

describe('upsertEnvFile', () => {
  it('updates keys without wiping the rest of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-env-'));
    const filePath = join(dir, '.env');
    writeFileSync(filePath, 'LOG_LEVEL=info\nPORT=3050\n');
    upsertEnvFile(filePath, { PORT: '3051', GOTENBERG_URL: 'http://127.0.0.1:3001' });
    const text = readFileSync(filePath, 'utf8');
    expect(text).toContain('LOG_LEVEL=info');
    expect(text).toContain('PORT=3051');
    expect(text).toContain('GOTENBERG_URL=http://127.0.0.1:3001');
    expect(text).not.toContain('PORT=3050');
  });
});
