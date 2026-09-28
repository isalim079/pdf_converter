import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { runProcess } from './process.js';

const CALC = new Set(['.xls', '.xlsx', '.xlsm', '.ods', '.csv']);
const IMPRESS = new Set(['.ppt', '.pptx', '.pptm', '.odp']);

const PDF_EXPORT_JSON =
  '{"EmbedStandardFonts":{"type":"boolean","value":"true"},"UseLosslessCompression":{"type":"boolean","value":"true"},"Quality":{"type":"long","value":"100"},"ReduceImageResolution":{"type":"boolean","value":"false"}}';

export function pdfFilterName(extension: string): string {
  const ext = extension.toLowerCase();
  if (CALC.has(ext)) {
    return 'calc_pdf_Export';
  }
  if (IMPRESS.has(ext)) {
    return 'impress_pdf_Export';
  }
  return 'writer_pdf_Export';
}

export function pdfExportFilter(extension: string, platform = process.platform): string {
  const name = pdfFilterName(extension);
  if (platform === 'win32') {
    return `pdf:${name}`;
  }
  return `pdf:${name}:${PDF_EXPORT_JSON}`;
}

export function libreOfficePathForCli(filePath: string, platform = process.platform): string {
  const absolute = platform === process.platform ? resolve(filePath) : filePath;
  if (platform === 'win32') {
    return absolute.replace(/\\/g, '/');
  }
  return absolute;
}

export function buildLibreOfficeArgs(input: {
  filePath: string;
  outputDir: string;
  profileDir: string;
  extension: string;
  platform?: NodeJS.Platform;
}): string[] {
  const platform = input.platform ?? process.platform;
  const filePath = libreOfficePathForCli(input.filePath, platform);
  const outputDir = libreOfficePathForCli(input.outputDir, platform);
  const profileDir = platform === process.platform ? resolve(input.profileDir) : input.profileDir;
  return [
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    '--norestore',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to',
    pdfExportFilter(input.extension, platform),
    '--outdir',
    outputDir,
    filePath,
  ];
}

function isSourceNotLoaded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not be loaded/i.test(message);
}

export async function convertOfficeFile(input: {
  bin: string;
  filePath: string;
  outputDir: string;
  timeoutMs: number;
}): Promise<string> {
  const outputDir = resolve(input.outputDir);
  const filePath = resolve(input.filePath);
  const profileDir = join(outputDir, 'lo-profile');
  await mkdir(profileDir, { recursive: true });
  const args = buildLibreOfficeArgs({
    filePath,
    outputDir,
    profileDir,
    extension: extname(filePath),
  });

  try {
    await runProcess(input.bin, args, { timeoutMs: input.timeoutMs, cwd: outputDir });
  } catch (error) {
    if (error instanceof AppError && isSourceNotLoaded(error) && pdfExportFilter(extname(filePath)).includes('{')) {
      const retryArgs = buildLibreOfficeArgs({
        filePath,
        outputDir,
        profileDir,
        extension: extname(filePath),
        platform: 'win32',
      });
      await runProcess(input.bin, retryArgs, { timeoutMs: input.timeoutMs, cwd: outputDir });
    } else if (error instanceof AppError) {
      throw error;
    } else {
      throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'LibreOffice failed to convert the document', {
        cause: error,
      });
    }
  }

  const pdfPath = join(outputDir, `${basename(filePath, extname(filePath))}.pdf`);
  if (!existsSync(pdfPath)) {
    throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'LibreOffice did not produce a PDF');
  }
  return pdfPath;
}
