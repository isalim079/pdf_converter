import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

import { createContainer } from '../src/app/container.js';
import { getConfig, resetConfigCache } from '../src/app/config.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';
import { createMetrics } from '../src/infrastructure/metrics/metrics.js';
import { buildServer } from '../src/app/server.js';
import type { GotenbergClient } from '../src/infrastructure/gotenberg/client.js';
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

async function buildApp(gotenberg: Partial<GotenbergClient> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-api-'));
  tempRoots.push(root);
  process.env.PDF_TEMP_DIR = root;
  process.env.GOTENBERG_URL = process.env.GOTENBERG_URL ?? 'http://localhost:3000';
  resetConfigCache();

  const pdf = await samplePdf();
  const client = {
    health: async () => true,
    convertOffice: async () => pdf,
    convertHtml: async () => pdf,
    ...gotenberg,
  } as GotenbergClient;

  const container = createContainer({
    config: getConfig(),
    logger: createLogger(),
    gotenberg: client,
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
    let receivedAssets = 0;
    const { app } = await buildApp({
      convertHtml: async (input) => {
        receivedAssets = input.assets.length;
        return samplePdf();
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
    expect(receivedAssets).toBe(1);
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

  it('allows health without a conversion engine', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
