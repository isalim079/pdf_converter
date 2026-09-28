import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { runProcess } from './process.js';

export function buildChromiumArgs(input: { htmlPath: string; outputPath: string }): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--allow-file-access-from-files',
    '--no-pdf-header-footer',
    '--disable-dev-shm-usage',
    `--print-to-pdf=${input.outputPath}`,
    '--virtual-time-budget=10000',
    pathToFileURL(input.htmlPath).href,
  ];
}

export async function convertHtmlFile(input: {
  bin: string;
  htmlPath: string;
  outputPath: string;
  timeoutMs: number;
}): Promise<string> {
  const args = buildChromiumArgs({ htmlPath: input.htmlPath, outputPath: input.outputPath });
  try {
    await runProcess(input.bin, args, { timeoutMs: input.timeoutMs });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'Chromium failed to convert the HTML', {
      cause: error,
    });
  }

  if (!existsSync(input.outputPath)) {
    throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'Chromium did not produce a PDF');
  }
  return input.outputPath;
}
