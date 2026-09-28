import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { runProcess } from './process.js';

const WRITER = new Set(['.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt', '.txt']);
const CALC = new Set(['.xls', '.xlsx', '.xlsm', '.ods', '.csv']);
const IMPRESS = new Set(['.ppt', '.pptx', '.pptm', '.odp']);

const PDF_EXPORT_JSON =
  '{"EmbedStandardFonts":{"type":"boolean","value":"true"},"UseLosslessCompression":{"type":"boolean","value":"true"},"Quality":{"type":"long","value":"100"},"ReduceImageResolution":{"type":"boolean","value":"false"}}';

export function pdfExportFilter(extension: string): string {
  const ext = extension.toLowerCase();
  if (CALC.has(ext)) {
    return `pdf:calc_pdf_Export:${PDF_EXPORT_JSON}`;
  }
  if (IMPRESS.has(ext)) {
    return `pdf:impress_pdf_Export:${PDF_EXPORT_JSON}`;
  }
  if (WRITER.has(ext) || ext.startsWith('.')) {
    return `pdf:writer_pdf_Export:${PDF_EXPORT_JSON}`;
  }
  return `pdf:writer_pdf_Export:${PDF_EXPORT_JSON}`;
}

export function buildLibreOfficeArgs(input: {
  filePath: string;
  outputDir: string;
  profileDir: string;
  extension: string;
}): string[] {
  return [
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    '--norestore',
    `-env:UserInstallation=${pathToFileURL(input.profileDir).href}`,
    '--convert-to',
    pdfExportFilter(input.extension),
    '--outdir',
    input.outputDir,
    input.filePath,
  ];
}

export async function convertOfficeFile(input: {
  bin: string;
  filePath: string;
  outputDir: string;
  timeoutMs: number;
}): Promise<string> {
  const profileDir = join(input.outputDir, 'lo-profile');
  await mkdir(profileDir, { recursive: true });
  const args = buildLibreOfficeArgs({
    filePath: input.filePath,
    outputDir: input.outputDir,
    profileDir,
    extension: extname(input.filePath),
  });

  try {
    await runProcess(input.bin, args, { timeoutMs: input.timeoutMs, cwd: input.outputDir });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'LibreOffice failed to convert the document', {
      cause: error,
    });
  }

  const pdfPath = join(input.outputDir, `${basename(input.filePath, extname(input.filePath))}.pdf`);
  if (!existsSync(pdfPath)) {
    throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'LibreOffice did not produce a PDF');
  }
  return pdfPath;
}
