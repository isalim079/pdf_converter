import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

import { resetConfigCache } from '../src/app/config.js';
import { ImageConverter } from '../src/modules/pdf/converters/image.converter.js';
import { parseOptions } from '../src/modules/pdf/pdf.service.js';
import { PNG_1X1 } from './helpers/zip.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  resetConfigCache();
});

describe('image converter', () => {
  it('creates a valid single-page PDF without stretching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pdf-img-'));
    tempRoots.push(root);
    process.env.PDF_TEMP_DIR = root;
    resetConfigCache();

    const jobId = 'pdf_image_test';
    const inputPath = join(root, jobId, 'input.png');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(root, jobId), { recursive: true });
    await writeFile(inputPath, PNG_1X1);

    const converter = new ImageConverter();
    const result = await converter.convert(
      {
        jobId,
        filePath: inputPath,
        originalFilename: 'square.png',
        mimeType: 'image/png',
        extension: '.png',
        size: PNG_1X1.length,
      },
      parseOptions({
        page: { size: 'A4', orientation: 'auto' },
        image: { fit: 'contain', dpi: 72 },
      }),
    );

    const pdf = await PDFDocument.load(await readFile(result.outputPath));
    expect(result.engine).toBe('image');
    expect(pdf.getPageCount()).toBe(1);
    const [page] = pdf.getPages();
    expect(page).toBeDefined();
    expect(page?.getWidth()).toBeGreaterThan(0);
    expect(page?.getHeight()).toBeGreaterThan(0);
  });
});
