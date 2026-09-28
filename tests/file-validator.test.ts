import { describe, expect, it } from 'vitest';

import { AppError } from '../src/common/errors/app-error.js';
import { ERROR_CODES } from '../src/common/errors/error-codes.js';
import { validateUpload } from '../src/modules/pdf/validation/file-validator.js';
import { createMinimalDocx, JPEG_1X1, PNG_1X1 } from './helpers/zip.js';

describe('file validator', () => {
  it('accepts a real PNG', async () => {
    const result = await validateUpload({
      originalFilename: 'square.png',
      declaredMimeType: 'image/png',
      buffer: PNG_1X1,
      maxBytes: 1024 * 1024,
    });
    expect(result.extension).toBe('.png');
    expect(result.mimeType).toBe('image/png');
  });

  it('accepts a real JPEG', async () => {
    const result = await validateUpload({
      originalFilename: 'portrait.jpg',
      buffer: JPEG_1X1,
      maxBytes: 1024 * 1024,
    });
    expect(result.extension).toBe('.jpg');
  });

  it('accepts a classic OLE .doc even when detected as CFB', async () => {
    const buffer = Buffer.alloc(512);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer);

    const result = await validateUpload({
      originalFilename: 'file-sample_100kB.doc',
      declaredMimeType: 'application/msword',
      buffer,
      maxBytes: 1024 * 1024,
    });
    expect(result.extension).toBe('.doc');
    expect(result.format.engine).toBe('libreoffice');
  });

  it('accepts a valid DOCX package', async () => {
    const result = await validateUpload({
      originalFilename: 'basic.docx',
      buffer: createMinimalDocx(),
      maxBytes: 1024 * 1024,
    });
    expect(result.format.engine).toBe('libreoffice');
  });

  it('accepts HTML, CSV, and XLSX', async () => {
    const html = await validateUpload({
      originalFilename: 'page.html',
      buffer: Buffer.from('<!doctype html><html><body>Hi</body></html>'),
      maxBytes: 1024 * 1024,
    });
    expect(html.format.engine).toBe('chromium');

    const csv = await validateUpload({
      originalFilename: 'rows.csv',
      buffer: Buffer.from('a,b\n1,2\n'),
      maxBytes: 1024 * 1024,
    });
    expect(csv.format.engine).toBe('libreoffice');
  });

  it('rejects a renamed executable', async () => {
    await expect(
      validateUpload({
        originalFilename: 'invoice.docx',
        declaredMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('MZ\x90\x00this-is-not-a-docx'),
        maxBytes: 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_FILE_SIGNATURE,
      statusCode: 415,
    });
  });

  it('rejects path traversal filenames', async () => {
    await expect(
      validateUpload({
        originalFilename: '../etc/passwd.png',
        buffer: PNG_1X1,
        maxBytes: 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects oversized uploads', async () => {
    await expect(
      validateUpload({
        originalFilename: 'big.png',
        buffer: PNG_1X1,
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FILE_TOO_LARGE });
  });

  it('rejects unsupported extensions', async () => {
    await expect(
      validateUpload({
        originalFilename: 'notes.md',
        buffer: Buffer.from('# hi'),
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.UNSUPPORTED_FILE_TYPE, statusCode: 415 });
  });

  it('rejects binary content claimed as txt', async () => {
    await expect(
      validateUpload({
        originalFilename: 'notes.txt',
        buffer: Buffer.from([0x00, 0x01, 0x02, 0xff]),
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_FILE_SIGNATURE });
  });
});
