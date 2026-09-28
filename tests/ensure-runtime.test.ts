import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fontsPresent } from '../scripts/ensure-lib/bins.mjs';
import {
  brewInstallArgs,
  linuxPackages,
  msiexecSilentArgs,
  windowsDownloadPlan,
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

  it('uses wget Windows installers when engines are missing', () => {
    const plan = decideInfra({ ...base, platform: 'win32' });
    expect(plan.action).toBe('install-windows');
    expect(plan.missing).toEqual(['libreoffice', 'chromium', 'fonts']);
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
    const downloads = windowsDownloadPlan(['libreoffice', 'chromium']);
    expect(downloads.map((item) => item.id)).toEqual(['libreoffice', 'chromium']);
    expect(msiexecSilentArgs('C:\\temp\\lo.msi')).toEqual(['/i', 'C:\\temp\\lo.msi', '/qn', '/norestart']);
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
