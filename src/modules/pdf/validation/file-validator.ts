import { fileTypeFromBuffer } from 'file-type';

import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { extensionOf, isPathTraversal, sanitizeFilename } from '../../../common/utils/filenames.js';
import { findFormatByExtension } from '../converters/formats.js';
import type { SupportedFormat } from '../pdf.types.js';
import { inspectZip } from './zip-inspect.js';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b]);
const RTF_SIGNATURE = Buffer.from('{\\rtf');

export interface FileValidationInput {
  originalFilename: string;
  declaredMimeType?: string;
  buffer: Buffer;
  maxBytes: number;
}

export interface FileValidationResult {
  filename: string;
  extension: string;
  mimeType: string;
  format: SupportedFormat;
  size: number;
}

export async function validateUpload(input: FileValidationInput): Promise<FileValidationResult> {
  if (input.originalFilename.length === 0) {
    throw new AppError(ERROR_CODES.FILE_REQUIRED, 'A file is required');
  }

  if (isPathTraversal(input.originalFilename)) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Filename is not allowed');
  }

  const filename = sanitizeFilename(input.originalFilename);
  const extension = extensionOf(filename);
  const format = findFormatByExtension(extension);

  if (!format) {
    throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'The uploaded file type is not supported.');
  }

  if (input.buffer.length === 0) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'The uploaded file is empty');
  }

  if (input.buffer.length > input.maxBytes) {
    throw new AppError(ERROR_CODES.FILE_TOO_LARGE, 'The uploaded file exceeds the configured size limit');
  }

  await assertSignature(input.buffer, format);

  const detected = await fileTypeFromBuffer(input.buffer);
  if (detected && !isCompatibleDetectedType(format, detected.mime, detected.ext)) {
    throw new AppError(
      ERROR_CODES.INVALID_FILE_SIGNATURE,
      'The file signature does not match the declared type',
    );
  }

  if (
    input.declaredMimeType &&
    input.declaredMimeType !== 'application/octet-stream' &&
    !format.mimeTypes.includes(input.declaredMimeType) &&
    !isKnownAlias(format, input.declaredMimeType)
  ) {
    throw new AppError(
      ERROR_CODES.INVALID_FILE_SIGNATURE,
      'The declared MIME type does not match the file contents',
    );
  }

  return {
    filename,
    extension: format.extension,
    mimeType: format.mimeTypes[0] ?? 'application/octet-stream',
    format,
    size: input.buffer.length,
  };
}

async function assertSignature(buffer: Buffer, format: SupportedFormat): Promise<void> {
  switch (format.extension) {
    case '.jpg':
    case '.jpeg':
      if (!buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid JPEG');
      }
      return;
    case '.png':
      if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid PNG');
      }
      return;
    case '.doc':
    case '.dot':
      if (!buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid Word document');
      }
      return;
    case '.docx':
    case '.docm':
    case '.dotx':
      assertZipOffice(buffer, ['[Content_Types].xml', 'word/']);
      return;
    case '.odt':
      assertZipOffice(buffer, ['mimetype', 'content.xml']);
      return;
    case '.rtf':
      if (!buffer.subarray(0, 5).equals(RTF_SIGNATURE)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid RTF document');
      }
      return;
    case '.txt':
      assertPlainText(buffer);
      return;
    default:
      throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'The uploaded file type is not supported.');
  }
}

function assertZipOffice(buffer: Buffer, required: string[]): void {
  if (!buffer.subarray(0, 2).equals(ZIP_SIGNATURE)) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Office document is not a valid ZIP package');
  }

  const entries = inspectZip(buffer);
  const names = entries.map((entry) => entry.name);

  for (const requiredName of required) {
    const found = names.some((name) =>
      requiredName.endsWith('/') ? name.startsWith(requiredName) : name === requiredName,
    );
    if (!found) {
      throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Office document is missing required parts');
    }
  }
}

function assertPlainText(buffer: Buffer): void {
  if (buffer.includes(0)) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Text file contains binary data');
  }
}

const OLE_DOC_TYPES = new Set([
  'application/x-cfb',
  'application/vnd.ms-office',
  'application/CDFV2',
  'application/msword',
]);

function isCompatibleDetectedType(format: SupportedFormat, mime: string, ext: string): boolean {
  if (format.mimeTypes.includes(mime)) {
    return true;
  }

  if (['.doc', '.dot'].includes(format.extension) && (OLE_DOC_TYPES.has(mime) || ext === 'cfb' || ext === 'doc')) {
    return true;
  }

  if (format.family === 'office' && (mime === 'application/zip' || ext === 'zip')) {
    return ['.docx', '.docm', '.dotx', '.odt'].includes(format.extension);
  }

  return false;
}

function isKnownAlias(format: SupportedFormat, mime: string): boolean {
  if (format.extension === '.txt' && mime.startsWith('text/')) {
    return true;
  }
  if (['.doc', '.dot'].includes(format.extension) && OLE_DOC_TYPES.has(mime)) {
    return true;
  }
  return format.mimeTypes.includes(mime);
}
