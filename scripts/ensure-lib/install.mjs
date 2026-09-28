import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const LIBREOFFICE_STABLE_INDEX = 'https://download.documentfoundation.org/libreoffice/stable/';
export const LIBREOFFICE_VERSION_FALLBACK = '26.8.0';

export const CHROME_MSI_URL =
  process.env.CHROME_MSI_URL ?? 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi';

export const WINGET_PACKAGES = {
  libreoffice: 'TheDocumentFoundation.LibreOffice',
  chromium: 'Google.Chrome',
  fonts: 'Noto.NotoFonts',
};

export const CHOCO_PACKAGES = {
  libreoffice: 'libreoffice-fresh',
  chromium: 'googlechrome',
  fonts: 'liberationfonts',
};

export function compareSemver(a, b) {
  const left = a.split('.').map((part) => Number(part) || 0);
  const right = b.split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

export function parseLibreOfficeVersions(html) {
  const found = [...String(html).matchAll(/href="(\d+\.\d+\.\d+)\//g)].map((match) => match[1]);
  return [...new Set(found)].sort(compareSemver).reverse();
}

export function libreOfficeMsiUrl(version) {
  if (process.env.LIBREOFFICE_MSI_URL) {
    return process.env.LIBREOFFICE_MSI_URL;
  }
  return `${LIBREOFFICE_STABLE_INDEX}${version}/win/x86_64/LibreOffice_${version}_Win_x86-64.msi`;
}

export async function fetchLatestLibreOfficeVersion(fetcher = fetch) {
  if (process.env.LIBREOFFICE_VERSION) {
    return process.env.LIBREOFFICE_VERSION;
  }
  try {
    const response = await fetcher(LIBREOFFICE_STABLE_INDEX);
    if (!response.ok) {
      return LIBREOFFICE_VERSION_FALLBACK;
    }
    const text = await response.text();
    return parseLibreOfficeVersions(text)[0] ?? LIBREOFFICE_VERSION_FALLBACK;
  } catch {
    return LIBREOFFICE_VERSION_FALLBACK;
  }
}

export function wingetInstallArgs(packageId) {
  return [
    'install',
    '--id',
    packageId,
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity',
    '--silent',
  ];
}

export function wingetInstallPlan(missing) {
  const commands = [];
  if (missing.includes('libreoffice')) {
    commands.push({ id: 'libreoffice', args: wingetInstallArgs(WINGET_PACKAGES.libreoffice), required: true });
  }
  if (missing.includes('chromium')) {
    commands.push({ id: 'chromium', args: wingetInstallArgs(WINGET_PACKAGES.chromium), required: true });
  }
  if (missing.includes('fonts')) {
    commands.push({ id: 'fonts', args: wingetInstallArgs(WINGET_PACKAGES.fonts), required: false });
  }
  return commands;
}

export function chocoInstallArgs(packageId) {
  return ['install', packageId, '-y', '--no-progress'];
}

export function chocoInstallPlan(missing) {
  const commands = [];
  if (missing.includes('libreoffice')) {
    commands.push({ id: 'libreoffice', args: chocoInstallArgs(CHOCO_PACKAGES.libreoffice), required: true });
  }
  if (missing.includes('chromium')) {
    commands.push({ id: 'chromium', args: chocoInstallArgs(CHOCO_PACKAGES.chromium), required: true });
  }
  if (missing.includes('fonts')) {
    commands.push({ id: 'fonts', args: chocoInstallArgs(CHOCO_PACKAGES.fonts), required: false });
  }
  return commands;
}

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

export function windowsDownloadPlan(missing, version = process.env.LIBREOFFICE_VERSION ?? LIBREOFFICE_VERSION_FALLBACK) {
  const downloads = [];
  if (missing.includes('libreoffice')) {
    downloads.push({
      id: 'libreoffice',
      url: libreOfficeMsiUrl(version),
      filename: `LibreOffice_${version}_Win_x86-64.msi`,
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
