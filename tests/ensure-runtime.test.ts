import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fontsPresent, wingetBin } from '../scripts/ensure-lib/bins.mjs';
import {
  brewInstallArgs,
  chocoInstallPlan,
  fetchLatestLibreOfficeVersion,
  FONT_URLS,
  libreOfficeMsiUrl,
  linuxPackages,
  msiexecSilentArgs,
  parseLibreOfficeVersions,
  windowsDownloadPlan,
  wingetInstallPlan,
} from '../scripts/ensure-lib/install.mjs';
import { conversionReady, decideInfra, missingPieces } from '../scripts/ensure-lib/plan.mjs';
import { parseBootArg, upsertEnvFile } from '../scripts/ensure-lib/runtime.mjs';
import { pickPort } from '../scripts/ensure-lib/probes.mjs';

const base = {
  platform: 'linux',
  libreofficeBin: undefined,
  chromiumBin: undefined,
  fontsPresent: false,
  brew: undefined,
  apt: false,
};

describe('ensure decision table', () => {
  it('is ready when soffice, Chrome, and fonts are present', () => {
    expect(
      decideInfra({
        ...base,
        libreofficeBin: '/usr/bin/soffice',
        chromiumBin: '/usr/bin/chromium',
        fontsPresent: true,
      }),
    ).toEqual({ action: 'ready', missing: [] });
  });

  it('skips install when engines are already present even if fonts will still be attempted', () => {
    const facts = {
      ...base,
      platform: 'darwin',
      brew: '/opt/homebrew/bin/brew',
      libreofficeBin: '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      chromiumBin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      fontsPresent: false,
    };
    expect(conversionReady(facts)).toBe(true);
    expect(decideInfra(facts)).toMatchObject({ action: 'brew-native', missing: ['fonts'] });
  });

  it('uses Homebrew on macOS when engines are missing', () => {
    const plan = decideInfra({
      ...base,
      platform: 'darwin',
      brew: '/opt/homebrew/bin/brew',
    });
    expect(plan.action).toBe('brew-native');
    expect(plan.missing).toEqual(['libreoffice', 'chromium', 'fonts']);
  });

  it('asks for Homebrew when brew is missing on macOS', () => {
    const plan = decideInfra({ ...base, platform: 'darwin' });
    expect(plan.action).toBe('need-homebrew');
    expect(plan.message).toMatch(/Homebrew is required/);
  });

  it('uses apt on Debian/Ubuntu when engines are missing', () => {
    const plan = decideInfra({ ...base, platform: 'linux', apt: true });
    expect(plan.action).toBe('install-linux');
    expect(plan.missing).toEqual(['libreoffice', 'chromium', 'fonts']);
  });

  it('fails with a package list on non-Debian Linux', () => {
    const plan = decideInfra({ ...base, platform: 'linux', apt: false });
    expect(plan.action).toBe('unsupported-linux');
    expect(plan.message).toMatch(/LibreOffice/);
  });

  it('uses Windows installers when engines are missing', () => {
    const plan = decideInfra({ ...base, platform: 'win32' });
    expect(plan.action).toBe('install-windows');
    expect(plan.missing).toEqual(['libreoffice', 'chromium', 'fonts']);
    expect(plan.message).toMatch(/winget/);
  });

  it('is ready on Windows when host binaries already exist', () => {
    expect(
      decideInfra({
        ...base,
        platform: 'win32',
        libreofficeBin: 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        chromiumBin: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        fontsPresent: true,
      }),
    ).toEqual({ action: 'ready', missing: [] });
  });

  it('installs only the missing brew casks', () => {
    expect(brewInstallArgs(['chromium'])).toEqual(['install', '--cask', 'google-chrome']);
    expect(brewInstallArgs(['libreoffice', 'fonts'])).toEqual([
      'install',
      '--cask',
      'libreoffice',
      'font-noto-sans-bengali',
      'font-noto-serif-bengali',
      'font-liberation',
    ]);
  });

  it('selects apt packages for missing engines and fonts', () => {
    const packages = linuxPackages(['libreoffice', 'fonts']);
    expect(packages).toContain('libreoffice-writer');
    expect(packages).toContain('fonts-liberation');
    expect(packages).not.toContain('gotenberg');
  });

  it('plans silent Windows MSI downloads for missing engines', () => {
    const downloads = windowsDownloadPlan(['libreoffice', 'chromium'], '26.8.0');
    expect(downloads.map((item) => item.id)).toEqual(['libreoffice', 'chromium']);
    expect(downloads[0].url).toBe(libreOfficeMsiUrl('26.8.0'));
    expect(downloads[0].filename).toBe('LibreOffice_26.8.0_Win_x86-64.msi');
    expect(msiexecSilentArgs('C:\\temp\\lo.msi')).toEqual(['/i', 'C:\\temp\\lo.msi', '/qn', '/norestart']);
  });

  it('uses the GitHub files attachment for Liberation fonts, not a 404 release URL', () => {
    expect(FONT_URLS.liberation).toContain('files/7261482');
    expect(FONT_URLS.liberation).not.toContain('releases/download');
    const fonts = windowsDownloadPlan(['fonts']);
    expect(fonts.map((item) => item.id)).toEqual(['notoSansBengali', 'notoSerifBengali', 'liberation']);
    expect(fonts.find((item) => item.id === 'liberation')?.url).toBe(FONT_URLS.liberation);
  });

  it('finds winget through cmd.exe when Git Bash where fails', () => {
    const exec = (command) => {
      if (command === 'cmd.exe') {
        return {
          status: 0,
          stdout: 'C:\\Users\\Excel\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\n',
        };
      }
      return { status: 1, stdout: '' };
    };
    expect(wingetBin(exec)).toMatch(/winget\.exe$/i);
  });

  it('picks the newest LibreOffice stable version from the directory listing', () => {
    const html = `
      <a href="7.6.7/">7.6.7/</a>
      <a href="25.2.5/">25.2.5/</a>
      <a href="26.8.0/">26.8.0/</a>
    `;
    expect(parseLibreOfficeVersions(html)).toEqual(['26.8.0', '25.2.5', '7.6.7']);
  });

  it('fetches the latest LibreOffice version and falls back when the index is unreachable', async () => {
    await expect(
      fetchLatestLibreOfficeVersion(async () => ({
        ok: true,
        text: async () => '<a href="26.8.0/">26.8.0/</a><a href="25.2.5/">25.2.5/</a>',
      })),
    ).resolves.toBe('26.8.0');
    await expect(fetchLatestLibreOfficeVersion(async () => ({ ok: false, text: async () => '' }))).resolves.toBe(
      '26.8.0',
    );
  });

  it('plans winget and Chocolatey installs for missing engines', () => {
    const winget = wingetInstallPlan(['libreoffice', 'chromium', 'fonts']);
    expect(winget.map((item) => item.id)).toEqual(['libreoffice', 'chromium', 'fonts']);
    expect(winget[0].args).toContain('TheDocumentFoundation.LibreOffice');
    expect(winget[1].args).toContain('Google.Chrome');
    expect(winget[2].required).toBe(false);

    const choco = chocoInstallPlan(['libreoffice']);
    expect(choco).toEqual([
      { id: 'libreoffice', args: ['install', 'libreoffice-fresh', '-y', '--no-progress'], required: true },
    ]);
  });

  it('detects Noto Bengali and Liberation from a fonts directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-fonts-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'NotoSansBengali-Regular.ttf'), 'font');
    writeFileSync(join(dir, 'LiberationSans-Regular.ttf'), 'font');
    expect(fontsPresent('darwin', () => ({ status: 1, stdout: '' }), [dir])).toBe(true);
    expect(missingPieces({ fontsPresent: true, libreofficeBin: 'x', chromiumBin: 'y' })).toEqual([]);
  });

  it('reuses a free API port and moves when the preferred port is busy', () => {
    expect(pickPort(3050, { busy: false, nextFree: 3050 })).toEqual({ port: 3050, reason: 'free' });
    expect(pickPort(3050, { busy: true, nextFree: 3051 })).toEqual({ port: 3051, reason: 'foreign' });
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
    upsertEnvFile(filePath, { PORT: '3051', LIBREOFFICE_BIN: '/usr/bin/soffice' });
    const text = readFileSync(filePath, 'utf8');
    expect(text).toContain('LOG_LEVEL=info');
    expect(text).toContain('PORT=3051');
    expect(text).toContain('LIBREOFFICE_BIN=/usr/bin/soffice');
    expect(text).not.toContain('PORT=3050');
  });
});
