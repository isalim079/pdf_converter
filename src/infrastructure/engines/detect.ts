import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const LIBREOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/local/bin/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/lib/libreoffice/program/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

export const CHROMIUM_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function lookupOnPath(name: string): string | undefined {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [name], { encoding: 'utf8' });
  if (result.status !== 0) {
    return undefined;
  }
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first && existsSync(first) ? first : undefined;
}

export function firstExisting(paths: Array<string | undefined>): string | undefined {
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    const found = lookupOnPath(candidate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function detectLibreOfficeBin(configured?: string): string | undefined {
  return firstExisting([configured, ...LIBREOFFICE_CANDIDATES, 'soffice.com', 'soffice', 'libreoffice']);
}

export function detectChromiumBin(configured?: string): string | undefined {
  return firstExisting([
    configured,
    ...CHROMIUM_CANDIDATES,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ]);
}
