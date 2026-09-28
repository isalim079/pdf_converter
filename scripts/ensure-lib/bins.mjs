import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LIBREOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/local/bin/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/lib/libreoffice/program/soffice',
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

export const PATH_BIN_NAMES = {
  libreoffice: ['soffice', 'libreoffice'],
  chromium: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
};

export function lookupOnPath(name, exec) {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = exec(command, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
      return undefined;
    }
    const first = parseWhereOutput(result.stdout);
    if (!first) {
      return undefined;
    }
    if (process.platform === 'win32') {
      return first;
    }
    return existsSync(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

export function parseWhereOutput(stdout) {
  return (
    String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || undefined
  );
}

export function lookupViaCmd(name, exec) {
  try {
    const result = exec('cmd.exe', ['/c', 'where', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      return undefined;
    }
    const first = String(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first || undefined;
  } catch {
    return undefined;
  }
}

export function firstExisting(paths, exec) {
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
    const found = lookupOnPath(candidate, exec);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function detectLibreOfficeBin(configured, exec) {
  return firstExisting([configured, ...LIBREOFFICE_CANDIDATES, ...PATH_BIN_NAMES.libreoffice], exec);
}

export function detectChromiumBin(configured, exec) {
  return firstExisting([configured, ...CHROMIUM_CANDIDATES, ...PATH_BIN_NAMES.chromium], exec);
}

export function brewBin(exec) {
  return firstExisting(['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew'], exec);
}

export function aptGetBin(exec) {
  return firstExisting(['/usr/bin/apt-get', 'apt-get'], exec);
}

export function wgetBin(exec) {
  return firstExisting(['wget', 'C:\\Windows\\System32\\wget.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\wget.exe'], exec);
}

export function curlBin(exec) {
  return firstExisting(['curl', 'C:\\Windows\\System32\\curl.exe'], exec);
}

export function wingetBin(exec) {
  const fromCmd = lookupViaCmd('winget', exec);
  if (fromCmd) {
    return fromCmd;
  }
  const localAppData = process.env.LOCALAPPDATA;
  return firstExisting(
    [
      'winget',
      localAppData ? join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe') : undefined,
      'C:\\Program Files\\WindowsApps\\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe\\winget.exe',
    ],
    exec,
  );
}

export function chocoBin(exec) {
  return firstExisting(['choco', 'C:\\ProgramData\\chocolatey\\bin\\choco.exe'], exec);
}

export function fontSearchDirs(platform = process.platform) {
  if (platform === 'darwin') {
    return [join(homedir(), 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts'];
  }
  if (platform === 'win32') {
    const windir = process.env.WINDIR ?? 'C:\\Windows';
    const local = process.env.LOCALAPPDATA;
    return [
      join(windir, 'Fonts'),
      local ? join(local, 'Microsoft', 'Windows', 'Fonts') : undefined,
    ].filter(Boolean);
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(homedir(), '.local', 'share', 'fonts')];
}

function listFontFiles(dirs) {
  const names = [];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) {
      continue;
    }
    try {
      names.push(...readdirSync(dir));
    } catch {
      // unreadable font dir
    }
  }
  return names.join('\n');
}

export function fontsPresent(platform = process.platform, exec, dirs = fontSearchDirs(platform)) {
  const listing = listFontFiles(dirs).toLowerCase();
  const bengali = /noto.*bengali|lohit.*bengali|nirmala/.test(listing);
  const liberation = /liberation/.test(listing);
  if (bengali && liberation) {
    return true;
  }
  if (platform === 'win32') {
    return false;
  }
  try {
    const result = exec('fc-list', [':', 'file'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8_000,
    });
    if (result.status !== 0) {
      return bengali && liberation;
    }
    const text = String(result.stdout).toLowerCase();
    return (
      (/noto.*bengali|lohit|nirmala/.test(text) || bengali) &&
      (/liberation/.test(text) || liberation)
    );
  } catch {
    return bengali && liberation;
  }
}

export function debianLike(readFile) {
  try {
    const text = readFile('/etc/os-release', 'utf8');
    return /^(ID|ID_LIKE)=.*(debian|ubuntu)/im.test(text);
  } catch {
    return false;
  }
}
