import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { convertHtmlFile } from './chromium.js';
import { detectChromiumBin, detectLibreOfficeBin } from './detect.js';
import { convertOfficeFile } from './libreoffice.js';

export interface NativeEngines {
  convertOffice(input: { filePath: string; outputDir: string; timeoutMs: number }): Promise<string>;
  convertHtml(input: { htmlPath: string; outputPath: string; timeoutMs: number }): Promise<string>;
  libreofficeBin(): string | undefined;
  chromiumBin(): string | undefined;
}

export function installHint(kind: 'libreoffice' | 'chromium'): string {
  if (process.platform === 'darwin') {
    return kind === 'libreoffice'
      ? 'LibreOffice is not installed. Run yarn start (brew) or: brew install --cask libreoffice'
      : 'Chrome is not installed. Run yarn start (brew) or: brew install --cask google-chrome';
  }
  if (process.platform === 'win32') {
    return kind === 'libreoffice'
      ? 'LibreOffice is not installed. Run yarn start (winget) or install LibreOffice from https://www.libreoffice.org/'
      : 'Chrome is not installed. Run yarn start (winget) or install Google Chrome.';
  }
  return kind === 'libreoffice'
    ? 'LibreOffice is not installed. Run yarn start (sudo apt) or: sudo apt-get install -y libreoffice-writer libreoffice-calc libreoffice-impress'
    : 'Chromium is not installed. Run yarn start (sudo apt) or: sudo apt-get install -y chromium';
}

export function createNativeEngines(bins: {
  libreofficeBin?: string;
  chromiumBin?: string;
} = {}): NativeEngines {
  const libreofficeBin = detectLibreOfficeBin(bins.libreofficeBin);
  const chromiumBin = detectChromiumBin(bins.chromiumBin);

  return {
    libreofficeBin: () => libreofficeBin,
    chromiumBin: () => chromiumBin,
    async convertOffice(input) {
      if (!libreofficeBin) {
        throw new AppError(ERROR_CODES.ENGINE_UNAVAILABLE, installHint('libreoffice'), { expose: true });
      }
      return convertOfficeFile({
        bin: libreofficeBin,
        filePath: input.filePath,
        outputDir: input.outputDir,
        timeoutMs: input.timeoutMs,
      });
    },
    async convertHtml(input) {
      if (!chromiumBin) {
        throw new AppError(ERROR_CODES.ENGINE_UNAVAILABLE, installHint('chromium'), { expose: true });
      }
      return convertHtmlFile({
        bin: chromiumBin,
        htmlPath: input.htmlPath,
        outputPath: input.outputPath,
        timeoutMs: input.timeoutMs,
      });
    },
  };
}
