/**
 * Pure decision table for yarn start / yarn dev ensure.
 * Does not spawn processes.
 */

import { COMPOSE_PROJECT } from './probes.mjs';

export function composeUpArgs(services) {
  return ['compose', '-p', COMPOSE_PROJECT, 'up', '-d', '--build', ...services];
}

export function missingComposeServices(facts) {
  const services = [];
  if (!facts.gotenbergUp) {
    services.push('gotenberg');
  }
  return services;
}

export function conversionReady(facts) {
  return facts.gotenbergUp || facts.gotenbergBin;
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
    if (conversionReady(facts)) {
      return { action: 'ready' };
    }
    if (facts.wslUbuntu) {
      return {
        action: 'reexec-wsl',
        message: 'Docker is not available on Windows. Re-running inside WSL Ubuntu so Gotenberg can convert Office and HTML files.',
      };
    }
    if (facts.wslInstallable) {
      return {
        action: 'install-wsl',
        message: 'Office and HTML conversion need Linux Gotenberg. Install WSL Ubuntu, reboot if asked, then run yarn start again.',
      };
    }
    return {
      action: 'hyperv',
      message:
        'This Windows host has no Docker and no WSL. Use Hyper-V Ubuntu (scripts/windows/setup-hyperv-ubuntu.ps1). Native Windows LibreOffice is not supported.',
    };
  }

  if (conversionReady(facts)) {
    return { action: 'ready' };
  }

  if (facts.dockerUp) {
    const services = missingComposeServices(facts);
    if (services.length === 0) {
      return { action: 'ready' };
    }
    return { action: 'compose', services };
  }

  if (platform === 'linux') {
    return {
      action: 'install-linux',
      message: 'Docker is not available. Installing LibreOffice, Chromium, fonts, and Gotenberg via scripts/install-linux.sh.',
    };
  }

  if (platform === 'darwin') {
    return {
      action: 'ready-images-only',
      message:
        'Gotenberg is not running. JPG/PNG/WebP will work. Office and HTML conversion need Docker Desktop or a Linux host.',
    };
  }

  return {
    action: 'unsupported',
    message: `Unsupported platform '${platform}'. Use Linux, macOS, or Windows with WSL/Hyper-V.`,
  };
}
