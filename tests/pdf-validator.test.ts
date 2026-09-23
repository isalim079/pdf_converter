import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '../src/common/errors/error-codes.js';
import { validatePdf } from '../src/modules/pdf/validation/pdf-validator.js';

describe('pdf validator', () => {
  it('accepts a parseable PDF with pages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-val-'));
    const path = join(dir, 'ok.pdf');
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await writeFile(path, await pdf.save());

    const result = await validatePdf(path, { maxPages: 10, maxBytes: 1024 * 1024 });
    expect(result.pageCount).toBe(1);
    expect(result.size).toBeGreaterThan(0);
  });

  it('rejects a non-PDF file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-val-'));
    const path = join(dir, 'bad.pdf');
    await writeFile(path, 'not a pdf');

    await expect(validatePdf(path)).rejects.toMatchObject({
      code: ERROR_CODES.PDF_VALIDATION_FAILED,
    });
  });
});
