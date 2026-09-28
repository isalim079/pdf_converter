import net from 'node:net';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const COMPOSE_PROJECT = 'pdf-converter-api';
export const PORT_SCAN = 20;

export function parseHostPort(rawUrl, fallbackPort) {
  const parsed = new URL(rawUrl);
  const port = parsed.port ? Number(parsed.port) : fallbackPort;
  return { host: parsed.hostname, port };
}

export function postgresTarget(databaseUrl) {
  return parseHostPort(databaseUrl, 5432);
}

export function redisTarget(redisUrl) {
  return parseHostPort(redisUrl, 6379);
}

export function gotenbergTarget(gotenbergUrl) {
  const parsed = new URL(gotenbergUrl);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  return { host: parsed.hostname, port, origin: `${parsed.protocol}//${parsed.host}` };
}

export function probeTcp(host, port, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function findFreePort(host, preferred, maxOffset = PORT_SCAN) {
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const port = preferred + offset;
    const busy = await probeTcp(host, port);
    if (!busy) {
      return port;
    }
  }
  throw new Error(`No free port on ${host} in ${preferred}–${preferred + maxOffset}`);
}

/**
 * preferred is free → use it.
 * preferred is busy and ours → reuse.
 * preferred is busy and foreign → nextFree.
 */
export function pickPort(preferred, input) {
  if (!input.busy) {
    return { port: preferred, reason: 'free' };
  }
  if (input.ours) {
    return { port: preferred, reason: 'ours' };
  }
  return { port: input.nextFree, reason: 'foreign' };
}

export async function probeHttpHealth(baseUrl, timeoutMs = 2_000) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function isOurGotenberg(baseUrl, timeoutMs = 2_000) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return false;
    }
    const text = await response.text();
    return /gotenberg|libreoffice|chromium/i.test(text);
  } catch {
    return false;
  }
}

export function isOurPostgres(databaseUrl, exec = spawnSync) {
  try {
    const parsed = new URL(databaseUrl);
    if (decodeURIComponent(parsed.username) !== 'pdf') {
      return false;
    }
    if (parsed.pathname.replace(/^\//, '') !== 'pdf_service') {
      return false;
    }
    const result = exec('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-Atc', 'SELECT current_database();'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 4_000,
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(parsed.password ?? ''),
        PGCONNECT_TIMEOUT: '3',
      },
    });
    return result.status === 0 && String(result.stdout).trim() === 'pdf_service';
  } catch {
    return false;
  }
}

export function isOurRedis(redisUrl, env) {
  if (env.PDF_ENSURE_REDIS_CLAIMED !== '1') {
    return false;
  }
  try {
    const claimed = redisTarget(env.REDIS_URL ?? redisUrl);
    const current = redisTarget(redisUrl);
    return claimed.host === current.host && claimed.port === current.port;
  } catch {
    return false;
  }
}

export function parsePublishedPort(output) {
  const match = String(output).trim().match(/:(\d+)$/);
  return match?.[1] ? Number(match[1]) : null;
}

export function composePublishedPort(exec, service, containerPort) {
  try {
    const result = exec(
      'docker',
      ['compose', '-p', COMPOSE_PROJECT, 'port', service, String(containerPort)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8_000 },
    );
    if (result.status !== 0) {
      return null;
    }
    return parsePublishedPort(result.stdout);
  } catch {
    return null;
  }
}

export function isOurPublishedService(exec, service, hostPort, containerPort) {
  if (!composeServiceRunning(exec, service)) {
    return false;
  }
  const published = composePublishedPort(exec, service, containerPort);
  return published === hostPort;
}

export function commandSucceeds(exec, command, args, timeoutMs = 8_000) {
  try {
    const result = exec(command, args, { stdio: 'pipe', timeout: timeoutMs, encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function dockerDaemonUp(exec) {
  return commandSucceeds(exec, 'docker', ['info'], 10_000);
}

export function wslUbuntuAvailable(exec) {
  return commandSucceeds(exec, 'wsl', ['-d', 'Ubuntu', '--', 'true'], 20_000);
}

export function wslInstallable(exec, platform) {
  if (platform !== 'win32') {
    return false;
  }
  return commandSucceeds(exec, 'wsl', ['--install', '--help'], 8_000);
}

export function isWsl(env, versionText) {
  if (env.WSL_DISTRO_NAME) {
    return true;
  }
  return typeof versionText === 'string' && /microsoft/i.test(versionText);
}

export function readProcVersion(readFile = readFileSync) {
  try {
    return readFile('/proc/version', 'utf8');
  } catch {
    return '';
  }
}

export function toWslPath(windowsPath) {
  const match = windowsPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) {
    return windowsPath.replace(/\\/g, '/');
  }
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

export function isDestructiveInfraCommand(args) {
  const tokens = args.map((arg) => String(arg).toLowerCase());
  return tokens.includes('down') || tokens.includes('stop') || tokens.includes('--force-recreate') || tokens.includes('kill');
}
