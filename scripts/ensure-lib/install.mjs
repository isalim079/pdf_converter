import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const LIBREOFFICE_VERSION = process.env.LIBREOFFICE_VERSION ?? '25.2.5';

export const LIBREOFFICE_MSI_URL =
  process.env.LIBREOFFICE_MSI_URL ??
  `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`;

export const CHROME_MSI_URL =
  process.env.CHROME_MSI_URL ?? 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi';

export const FONT_URLS = {
  notoSansBengali:
    'https://github.com/google/fonts/raw/main/ofl/notosansbengali/NotoSansBengali%5Bwdth%2Cwght%5D.ttf',
  notoSerifBengali:
    'https://github.com/google/fonts/raw/main/ofl/notoserifbengali/NotoSerifBengali%5Bwdth%2Cwght%5D.ttf',
  liberation:
    'https://github.com/liberationfonts/liberation-fonts/releases/download/2.1.5/liberation-fonts-ttf-2.1.5.tar.gz',
};

export const LINUX_ENGINE_PACKAGES = [
  'libreoffice-writer',
  'libreoffice-calc',
  'libreoffice-impress',
  'chromium',
  'chromium-browser',
];

export const LINUX_FONT_PACKAGES = [
  'fonts-lohit-beng-bengali',
  'fonts-beng',
  'fonts-noto-core',
  'fonts-noto-ui-core',
  'fonts-liberation',
  'fonts-liberation2',
  'fonts-dejavu-core',
  'fonts-noto-color-emoji',
  'fonts-crosextra-carlito',
  'fonts-crosextra-caladea',
  'fonts-noto-cjk',
];

export const BREW_ENGINE_CASKS = {
  libreoffice: 'libreoffice',
  chromium: 'google-chrome',
};

export const BREW_FONT_CASKS = ['font-noto-sans-bengali', 'font-noto-serif-bengali', 'font-liberation'];

export function brewInstallArgs(missing) {
  const casks = [];
  if (missing.includes('libreoffice')) {
    casks.push(BREW_ENGINE_CASKS.libreoffice);
  }
  if (missing.includes('chromium')) {
    casks.push(BREW_ENGINE_CASKS.chromium);
  }
  if (missing.includes('fonts')) {
    casks.push(...BREW_FONT_CASKS);
  }
  return casks.length > 0 ? ['install', '--cask', ...casks] : [];
}

export function linuxPackages(missing) {
  const packages = [];
  if (missing.includes('libreoffice') || missing.includes('chromium')) {
    packages.push('ca-certificates', 'curl', ...LINUX_ENGINE_PACKAGES);
  }
  if (missing.includes('fonts')) {
    packages.push(...LINUX_FONT_PACKAGES);
  }
  return [...new Set(packages)];
}

export function windowsDownloadPlan(missing) {
  const downloads = [];
  if (missing.includes('libreoffice')) {
    downloads.push({
      id: 'libreoffice',
      url: LIBREOFFICE_MSI_URL,
      filename: `LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`,
      kind: 'msi',
    });
  }
  if (missing.includes('chromium')) {
    downloads.push({
      id: 'chromium',
      url: CHROME_MSI_URL,
      filename: 'googlechromestandaloneenterprise64.msi',
      kind: 'msi',
    });
  }
  if (missing.includes('fonts')) {
    downloads.push(
      {
        id: 'notoSansBengali',
        url: FONT_URLS.notoSansBengali,
        filename: 'NotoSansBengali.ttf',
        kind: 'font',
      },
      {
        id: 'notoSerifBengali',
        url: FONT_URLS.notoSerifBengali,
        filename: 'NotoSerifBengali.ttf',
        kind: 'font',
      },
      {
        id: 'liberation',
        url: FONT_URLS.liberation,
        filename: 'liberation-fonts-ttf-2.1.5.tar.gz',
        kind: 'font-archive',
      },
    );
  }
  return downloads;
}

export function msiexecSilentArgs(msiPath) {
  return ['/i', msiPath, '/qn', '/norestart'];
}

export function chromeExeSilentArgs(exePath) {
  return [exePath, '/silent', '/install'];
}

export function isElevatedWindows(exec = spawnSync) {
  try {
    const result = exec('net', ['session'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function adminCommandForMsi(msiPath) {
  return `msiexec /i "${msiPath}" /qn /norestart`;
}

export function downloadArgs(tool, url, dest) {
  if (tool === 'wget') {
    return ['-O', dest, url];
  }
  return ['-L', '--fail', '-o', dest, url];
}

export function extractLiberationArgs(archivePath, destDir) {
  return ['-xzf', archivePath, '-C', destDir];
}

export function windowsFontDest(elevated) {
  if (elevated) {
    return join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts');
  }
  return join(process.env.LOCALAPPDATA ?? tmpdir(), 'Microsoft', 'Windows', 'Fonts');
}

export function copyFontsInto(destDir, files) {
  mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }
    const name = file.split(/[/\\]/).pop();
    const dest = join(destDir, name);
    copyFileSync(file, dest);
    copied.push(dest);
  }
  return copied;
}

export function writePlaceholder(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}
