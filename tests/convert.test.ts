import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

import { createContainer } from '../src/app/container.js';
import { getConfig, resetConfigCache } from '../src/app/config.js';
import { AppError } from '../src/common/errors/app-error.js';
import { ERROR_CODES } from '../src/common/errors/error-codes.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';
import { createMetrics } from '../src/infrastructure/metrics/metrics.js';
import { buildServer } from '../src/app/server.js';
import type { NativeEngines } from '../src/infrastructure/engines/native.js';
import { createMinimalDocx, createMinimalPptx, createMinimalXlsx, HTML_BASIC, PNG_1X1 } from './helpers/zip.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  resetConfigCache();
});

async function samplePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return Buffer.from(await pdf.save());
}

function multipart(
  fields: Array<{ name: string; filename?: string; type?: string; body: Buffer | string }>,
) {
  const boundary = '----pdf-test-boundary';
  const chunks: Buffer[] = [];
  for (const field of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (field.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\nContent-Type: ${field.type ?? 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      chunks.push(Buffer.isBuffer(field.body) ? field.body : Buffer.from(field.body));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.body}\r\n`),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}

async function buildApp(engines: Partial<NativeEngines> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-api-'));
  tempRoots.push(root);
  process.env.PDF_TEMP_DIR = root;
  process.env.ENGINES_REQUIRED = 'false';
  resetConfigCache();

  const pdf = await samplePdf();
  const client: NativeEngines = {
    libreofficeBin: () => '/mock/soffice',
    chromiumBin: () => '/mock/chrome',
    convertOffice: async ({ outputDir }) => {
      const outputPath = join(outputDir, 'output.pdf');
      await writeFile(outputPath, pdf);
      return outputPath;
    },
    convertHtml: async ({ outputPath }) => {
      await writeFile(outputPath, pdf);
      return outputPath;
    },
    ...engines,
  };

  const container = createContainer({
    config: getConfig(),
    logger: createLogger(),
    engines: client,
    metrics: createMetrics(),
  });
  return { app: await buildServer(container), tempRoot: root };
}

describe('POST /v1/pdf/convert', () => {
  it('converts a PNG without authentication and returns a PDF', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([{ name: 'file', filename: 'square.png', type: 'image/png', body: PNG_1X1 }]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/pdf/);
    expect(response.headers['x-conversion-engine']).toBe('image');
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    await app.close();
  });

  it('accepts a Postman File field name', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([{ name: 'File', filename: 'square.png', type: 'image/png', body: PNG_1X1 }]),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('routes office documents through LibreOffice', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([
        {
          name: 'file',
          filename: 'basic.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          body: createMinimalDocx(),
        },
      ]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-conversion-engine']).toBe('libreoffice');
    await app.close();
  });

  it('routes HTML through Chromium and accepts a flat asset', async () => {
    let htmlCalls = 0;
    const { app } = await buildApp({
      convertHtml: async ({ outputPath }) => {
        htmlCalls += 1;
        await writeFile(outputPath, await samplePdf());
        return outputPath;
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([
        { name: 'file', filename: 'page.html', type: 'text/html', body: HTML_BASIC },
        { name: 'assets', filename: 'logo.png', type: 'image/png', body: PNG_1X1 },
      ]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-conversion-engine']).toBe('chromium');
    expect(htmlCalls).toBe(1);
    await app.close();
  });

  it('accepts xlsx and pptx packages', async () => {
    const { app } = await buildApp();
    const xlsx = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([
        {
          name: 'file',
          filename: 'sheet.xlsx',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: createMinimalXlsx(),
        },
      ]),
    });
    const pptx = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([
        {
          name: 'file',
          filename: 'deck.pptx',
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          body: createMinimalPptx(),
        },
      ]),
    });
    expect(xlsx.statusCode).toBe(200);
    expect(pptx.statusCode).toBe(200);
    await app.close();
  });

  it('rejects unsupported types without auth', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([{ name: 'file', filename: 'notes.md', type: 'text/markdown', body: Buffer.from('# hi') }]),
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('UNSUPPORTED_FILE_TYPE');
    await app.close();
  });

  it('rejects missing files', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([{ name: 'pageSize', body: 'A4' }]),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('FILE_REQUIRED');
    await app.close();
  });

  it('cleans the request temp folder after conversion', async () => {
    const { app, tempRoot } = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([{ name: 'file', filename: 'square.png', type: 'image/png', body: PNG_1X1 }]),
    });
    const leftover = await readdir(tempRoot);
    expect(leftover).toEqual([]);
    await app.close();
  });

  it('allows health without requiring host engines in tests', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('returns ENGINE_UNAVAILABLE when LibreOffice is missing', async () => {
    const { app } = await buildApp({
      convertOffice: async () => {
        throw new AppError(ERROR_CODES.ENGINE_UNAVAILABLE, 'LibreOffice is not installed. Run yarn start.', {
          expose: true,
        });
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pdf/convert',
      ...multipart([
        {
          name: 'file',
          filename: 'basic.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          body: createMinimalDocx(),
        },
      ]),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('ENGINE_UNAVAILABLE');
    await app.close();
  });
});
