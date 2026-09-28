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
const WEBP_RIFF = Buffer.from('RIFF');
const WEBP_WEBP = Buffer.from('WEBP');

const OLE_DOC_TYPES = new Set([
  'application/x-cfb',
  'application/vnd.ms-office',
  'application/CDFV2',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

const HTML_ASSET_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.ico',
  '.html',
  '.htm',
]);

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

export interface HtmlAssetInput {
  originalFilename: string;
  buffer: Buffer;
}

export interface HtmlAssetResult {
  filename: string;
  buffer: Buffer;
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

export function validateHtmlAssets(
  assets: HtmlAssetInput[],
  limits: { maxCount: number; maxBytes: number },
): HtmlAssetResult[] {
  if (assets.length > limits.maxCount) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Too many HTML assets were uploaded');
  }

  const usedNames = new Set<string>();
  let totalBytes = 0;
  const results: HtmlAssetResult[] = [];

  for (const asset of assets) {
    if (isPathTraversal(asset.originalFilename) || asset.originalFilename.includes('/')) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'HTML asset filenames must be a flat file name');
    }

    const filename = sanitizeFilename(asset.originalFilename);
    const extension = extensionOf(filename);
    if (!HTML_ASSET_EXTENSIONS.has(extension)) {
      throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, `HTML asset type ${extension} is not supported`);
    }
    if (filename === 'index.html' || filename === 'index.htm') {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'HTML assets cannot be named index.html');
    }
    if (usedNames.has(filename.toLowerCase())) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'HTML asset filenames must be unique');
    }
    if (asset.buffer.length === 0) {
      throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'An HTML asset is empty');
    }

    totalBytes += asset.buffer.length;
    if (totalBytes > limits.maxBytes) {
      throw new AppError(ERROR_CODES.FILE_TOO_LARGE, 'HTML assets exceed the configured size limit');
    }

    usedNames.add(filename.toLowerCase());
    results.push({ filename, buffer: asset.buffer });
  }

  return results;
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
    case '.webp':
      if (!isWebp(buffer)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid WebP image');
      }
      return;
    case '.doc':
    case '.dot':
    case '.xls':
    case '.ppt':
      if (!buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid Office document');
      }
      return;
    case '.docx':
    case '.docm':
    case '.dotx':
      assertZipOffice(buffer, ['[Content_Types].xml', 'word/']);
      return;
    case '.xlsx':
    case '.xlsm':
      assertZipOffice(buffer, ['[Content_Types].xml', 'xl/']);
      return;
    case '.pptx':
    case '.pptm':
      assertZipOffice(buffer, ['[Content_Types].xml', 'ppt/']);
      return;
    case '.odt':
      assertOpenDocument(buffer, 'application/vnd.oasis.opendocument.text');
      return;
    case '.ods':
      assertOpenDocument(buffer, 'application/vnd.oasis.opendocument.spreadsheet');
      return;
    case '.odp':
      assertOpenDocument(buffer, 'application/vnd.oasis.opendocument.presentation');
      return;
    case '.rtf':
      if (!buffer.subarray(0, 5).equals(RTF_SIGNATURE)) {
        throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not a valid RTF document');
      }
      return;
    case '.txt':
    case '.csv':
      assertPlainText(buffer);
      return;
    case '.html':
    case '.htm':
      assertHtml(buffer);
      return;
    default:
      throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'The uploaded file type is not supported.');
  }
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(WEBP_RIFF) &&
    buffer.subarray(8, 12).equals(WEBP_WEBP)
  );
}

function assertZipOffice(buffer: Buffer, required: string[]): void {
  if (!buffer.subarray(0, 2).equals(ZIP_SIGNATURE)) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Office document is not a valid ZIP package');
  }

  const names = inspectZip(buffer).map((entry) => entry.name);
  for (const requiredName of required) {
    const found = names.some((name) =>
      requiredName.endsWith('/') ? name.startsWith(requiredName) : name === requiredName,
    );
    if (!found) {
      throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Office document is missing required parts');
    }
  }
}

function assertOpenDocument(buffer: Buffer, mimeType: string): void {
  assertZipOffice(buffer, ['mimetype', 'content.xml']);
  const names = inspectZip(buffer).map((entry) => entry.name);
  if (!names.includes('mimetype')) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'OpenDocument file is missing a mimetype');
  }
  const header = buffer.subarray(0, Math.min(buffer.length, 256)).toString('latin1');
  if (!header.includes(mimeType) && !header.includes('mimetype')) {
    return;
  }
}

function assertPlainText(buffer: Buffer): void {
  if (buffer.includes(0)) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Text file contains binary data');
  }
}

function assertHtml(buffer: Buffer): void {
  assertPlainText(buffer);
  const text = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').toLowerCase();
  if (!text.includes('<html') && !text.includes('<!doctype') && !text.includes('<body') && !text.includes('<head')) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'File is not valid HTML');
  }
}

function isCompatibleDetectedType(format: SupportedFormat, mime: string, ext: string): boolean {
  if (format.mimeTypes.includes(mime)) {
    return true;
  }

  if (
    ['.doc', '.dot', '.xls', '.ppt'].includes(format.extension) &&
    (OLE_DOC_TYPES.has(mime) || ext === 'cfb' || ext === 'doc' || ext === 'xls' || ext === 'ppt')
  ) {
    return true;
  }

  if (format.family === 'office' && (mime === 'application/zip' || ext === 'zip')) {
    return ['.docx', '.docm', '.dotx', '.xlsx', '.xlsm', '.pptx', '.pptm', '.odt', '.ods', '.odp'].includes(
      format.extension,
    );
  }

  if (format.extension === '.webp' && (mime === 'image/webp' || ext === 'webp')) {
    return true;
  }

  if (format.family === 'html' && (mime === 'text/html' || ext === 'html' || ext === 'htm')) {
    return true;
  }

  return false;
}

function isKnownAlias(format: SupportedFormat, mime: string): boolean {
  if (['.txt', '.csv'].includes(format.extension) && mime.startsWith('text/')) {
    return true;
  }
  if (format.family === 'html' && (mime === 'text/html' || mime === 'application/xhtml+xml')) {
    return true;
  }
  if (['.doc', '.dot', '.xls', '.ppt'].includes(format.extension) && OLE_DOC_TYPES.has(mime)) {
    return true;
  }
  return format.mimeTypes.includes(mime);
}
