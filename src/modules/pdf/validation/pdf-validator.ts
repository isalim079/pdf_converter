import { readFile, stat } from 'node:fs/promises';

import { PDFDocument } from 'pdf-lib';

import { getConfig } from '../../../app/config.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

export interface PdfValidationResult {
  pageCount: number;
  size: number;
}

export async function validatePdf(
  filePath: string,
  limits: { maxPages?: number; maxBytes?: number } = {},
): Promise<PdfValidationResult> {
  const config = getConfig();
  const maxPages = limits.maxPages ?? config.PDF_MAX_PAGES;
  const maxBytes = limits.maxBytes ?? config.maxFileSizeBytes * 4;

  let info: { size: number };
  try {
    info = await stat(filePath);
  } catch {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated PDF is missing');
  }

  if (info.size === 0) {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated PDF is empty');
  }

  if (info.size > maxBytes) {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated PDF exceeds the size limit');
  }

  const buffer = await readFile(filePath);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated file is not a PDF');
  }

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (error) {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated PDF could not be parsed', {
      cause: error,
    });
  }

  const pageCount = document.getPageCount();
  if (pageCount <= 0) {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated PDF has no pages');
  }
  if (pageCount > maxPages) {
    throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Generated PDF exceeds the page limit');
  }

  return { pageCount, size: info.size };
}
