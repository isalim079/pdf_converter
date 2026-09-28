import net from 'node:net';
import { readFileSync } from 'node:fs';

export const PORT_SCAN = 20;

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

export function pickPort(preferred, input) {
  if (!input.busy) {
    return { port: preferred, reason: 'free' };
  }
  return { port: input.nextFree, reason: 'foreign' };
}

export function commandSucceeds(exec, command, args, timeoutMs = 8_000) {
  try {
    const result = exec(command, args, { stdio: 'pipe', timeout: timeoutMs, encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function readProcVersion(readFile = readFileSync) {
  try {
    return readFile('/proc/version', 'utf8');
  } catch {
    return '';
  }
}
