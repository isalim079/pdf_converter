/**
 * Pure decision table for yarn start / yarn dev ensure.
 * Does not spawn processes.
 */

import { COMPOSE_PROJECT } from './probes.mjs';

export function composeUpArgs(services) {
  return ['compose', '-p', COMPOSE_PROJECT, 'up', '-d', ...services];
}

export function missingComposeServices(facts) {
  const services = [];
  if (!facts.postgresUp) {
    services.push('postgres');
  }
  if (!facts.redisUp) {
    services.push('redis');
  }
  if (!facts.gotenbergUp) {
    services.push('gotenberg');
  }
  return services;
}

export function conversionReady(facts) {
  return facts.gotenbergUp || facts.gotenbergBin;
}

export function dataReady(facts) {
  return facts.postgresUp && facts.redisUp;
}

/**
 * @param {object} facts
 * @returns {{ action: string, services?: string[], message?: string }}
 */
export function decideInfra(facts) {
  const platform = facts.platform;

  if (platform === 'win32' && !facts.inWsl) {
    if (facts.dockerUp) {
      const services = missingComposeServices(facts);
      if (services.length === 0) {
        return { action: 'ready' };
      }
      return { action: 'compose', services };
    }
    if (dataReady(facts) && conversionReady(facts)) {
      return { action: 'ready' };
    }
    if (facts.wslUbuntu) {
      return {
        action: 'reexec-wsl',
        message: 'Docker is not available on Windows. Re-running inside WSL Ubuntu so Gotenberg can convert Office files.',
      };
    }
    if (facts.wslInstallable) {
      return {
        action: 'install-wsl',
        message: 'Office conversion needs Linux Gotenberg. Install WSL Ubuntu, reboot if asked, then run yarn start again.',
      };
    }
    return {
      action: 'hyperv',
      message:
        'This Windows host has no Docker and no WSL. Use Hyper-V Ubuntu (scripts/windows/setup-hyperv-ubuntu.ps1). Native Windows LibreOffice is not supported.',
    };
  }

  if (dataReady(facts) && conversionReady(facts)) {
    return { action: 'ready' };
  }

  if (facts.dockerUp) {
    const services = missingComposeServices(facts);
    if (services.length === 0) {
      return { action: 'ready' };
    }
    return { action: 'compose', services };
  }

  if (facts.hostPostgresBusyForeign || facts.hostRedisBusyForeign) {
    return {
      action: 'blocked-ports',
      message:
        'Default Postgres/Redis ports are in use by another project. Start Docker so this app can bind private ports, or set DATABASE_URL/REDIS_URL to this service. Existing servers will not be stopped.',
    };
  }

  if (platform === 'linux') {
    return {
      action: 'install-linux',
      message: 'Docker is not available. Installing Postgres, Redis, LibreOffice, fonts, and Gotenberg via scripts/install-linux.sh.',
    };
  }

  if (platform === 'darwin') {
    if (!dataReady(facts)) {
      return {
        action: 'brew-infra',
        message: 'Docker is not available. Starting Postgres and Redis with Homebrew.',
      };
    }
    return {
      action: 'ready-images-only',
      message:
        'Postgres and Redis are up, but Gotenberg is not. JPG/PNG will work. DOC/DOCX need Docker Desktop or a Linux host.',
    };
  }

  return {
    action: 'unsupported',
    message: `Unsupported platform '${platform}'. Use Linux, macOS, or Windows with WSL/Hyper-V.`,
  };
}
