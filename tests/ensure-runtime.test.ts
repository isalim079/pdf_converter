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
  postgresTarget,
  redisTarget,
  toWslPath,
} from '../scripts/ensure-lib/probes.mjs';

const base = {
  platform: 'linux',
  inWsl: false,
  dockerUp: false,
  postgresUp: false,
  redisUp: false,
  gotenbergUp: false,
  gotenbergBin: false,
  wslUbuntu: false,
  wslInstallable: false,
  hostPostgresBusyForeign: false,
  hostRedisBusyForeign: false,
};

describe('ensure probes', () => {
  it('parses service URLs', () => {
    expect(postgresTarget('postgresql://pdf:pdf@localhost:5432/pdf_service')).toEqual({
      host: 'localhost',
      port: 5432,
    });
    expect(redisTarget('redis://127.0.0.1:6379')).toEqual({ host: '127.0.0.1', port: 6379 });
    expect(gotenbergTarget('http://localhost:3000')).toMatchObject({
      host: 'localhost',
      port: 3000,
      origin: 'http://localhost:3000',
    });
    expect(parsePublishedPort('127.0.0.1:5433\n')).toBe(5433);
  });

  it('detects a running Compose service from docker ps output', () => {
    const running = () => ({ status: 0, stdout: 'abc123\n', stderr: '' });
    const stopped = () => ({ status: 0, stdout: '\n', stderr: '' });
    expect(composeServiceRunning(running, 'postgres')).toBe(true);
    expect(composeServiceRunning(stopped, 'postgres')).toBe(false);
  });

  it('claims a host port only when our Compose service is publishing it', () => {
    const exec = (_cmd, args) => {
      if (args.includes('ps')) {
        return { status: 0, stdout: 'abc123\n', stderr: '' };
      }
      if (args.includes('port')) {
        return { status: 0, stdout: '127.0.0.1:5432\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    };
    expect(isOurPublishedService(exec, 'postgres', 5432, 5432)).toBe(true);
    expect(isOurPublishedService(exec, 'postgres', 5433, 5432)).toBe(false);
  });

  it('converts Windows paths for WSL', () => {
    expect(toWslPath('C:\\src\\pdf_converter_api')).toBe('/mnt/c/src/pdf_converter_api');
    expect(toWslPath('D:/app')).toBe('/mnt/d/app');
  });

  it('reuses our port and allocates the next when the preferred port is foreign', () => {
    expect(pickPort(5432, { busy: false, ours: false, nextFree: 5432 })).toEqual({
      port: 5432,
      reason: 'free',
    });
    expect(pickPort(5432, { busy: true, ours: true, nextFree: 5433 })).toEqual({
      port: 5432,
      reason: 'ours',
    });
    expect(pickPort(5432, { busy: true, ours: false, nextFree: 5433 })).toEqual({
      port: 5433,
      reason: 'foreign',
    });
  });
});

describe('ensure decision table', () => {
  it('starts only missing Compose services when Docker is up', () => {
    const facts = { ...base, dockerUp: true, postgresUp: true };
    expect(missingComposeServices(facts)).toEqual(['redis', 'gotenberg']);
    expect(decideInfra(facts)).toEqual({
      action: 'compose',
      services: ['redis', 'gotenberg'],
    });
  });

  it('is ready when all dependencies are already up', () => {
    expect(
      decideInfra({
        ...base,
        postgresUp: true,
        redisUp: true,
        gotenbergUp: true,
      }),
    ).toEqual({ action: 'ready' });
  });

  it('is ready on Linux when Gotenberg binary exists even if the HTTP API is down', () => {
    expect(
      decideInfra({
        ...base,
        platform: 'linux',
        postgresUp: true,
        redisUp: true,
        gotenbergBin: true,
      }),
    ).toEqual({ action: 'ready' });
  });

  it('installs Linux packages when Docker is missing', () => {
    const plan = decideInfra({ ...base, platform: 'linux' });
    expect(plan.action).toBe('install-linux');
  });

  it('uses Homebrew on macOS when Postgres or Redis are down', () => {
    expect(decideInfra({ ...base, platform: 'darwin' }).action).toBe('brew-infra');
  });

  it('warns images-only on macOS when data services are up but Gotenberg is not', () => {
    const plan = decideInfra({
      ...base,
      platform: 'darwin',
      postgresUp: true,
      redisUp: true,
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
    expect(plan.services).toEqual(['postgres', 'redis', 'gotenberg']);
  });

  it('starts Windows Node when Linux services are already reachable', () => {
    expect(
      decideInfra({
        ...base,
        platform: 'win32',
        postgresUp: true,
        redisUp: true,
        gotenbergUp: true,
      }),
    ).toEqual({ action: 'ready' });
  });

  it('does not take over a foreign Postgres/Redis when Docker is missing', () => {
    const plan = decideInfra({
      ...base,
      platform: 'darwin',
      hostPostgresBusyForeign: true,
    });
    expect(plan.action).toBe('blocked-ports');
  });

  it('starts isolated Compose services without down or force-recreate', () => {
    const args = composeUpArgs(['postgres', 'redis']);
    expect(args).toEqual(['compose', '-p', COMPOSE_PROJECT, 'up', '-d', 'postgres', 'redis']);
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
    writeFileSync(filePath, 'API_KEYS=keep-me\nPORT=3050\n');
    upsertEnvFile(filePath, { PORT: '3051', DATABASE_URL: 'postgresql://pdf:pdf@127.0.0.1:5433/pdf_service' });
    const text = readFileSync(filePath, 'utf8');
    expect(text).toContain('API_KEYS=keep-me');
    expect(text).toContain('PORT=3051');
    expect(text).toContain('DATABASE_URL=postgresql://pdf:pdf@127.0.0.1:5433/pdf_service');
    expect(text).not.toContain('PORT=3050');
  });
});
