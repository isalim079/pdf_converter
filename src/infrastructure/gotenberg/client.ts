import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { getConfig } from '../../app/config.js';
import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { PAGE_SIZES, toPoints, type PageDimensions } from '../../common/utils/page-sizes.js';
import type { ConversionOptions } from '../../modules/pdf/pdf.types.js';

export interface GotenbergAsset {
  filename: string;
  filePath: string;
}

export class GotenbergClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  }

  async convertOffice(input: {
    filePath: string;
    filename: string;
    options: ConversionOptions;
    timeoutMs: number;
  }): Promise<Buffer> {
    const body = new FormData();
    body.append('files', await fileFromPath(input.filePath, basename(input.filename)));
    appendMetadata(body, input.options);
    if (input.options.page.orientation === 'landscape') {
      body.append('landscape', 'true');
    }
    body.append('losslessImageCompression', 'true');
    body.append('quality', '100');
    body.append('reduceImageResolution', 'false');
    return this.post('/forms/libreoffice/convert', body, input.timeoutMs, 'Office conversion');
  }

  async convertHtml(input: {
    filePath: string;
    assets: GotenbergAsset[];
    options: ConversionOptions;
    timeoutMs: number;
  }): Promise<Buffer> {
    const body = new FormData();
    body.append('files', await fileFromPath(input.filePath, 'index.html', 'text/html'));
    for (const asset of input.assets) {
      body.append('files', await fileFromPath(asset.filePath, basename(asset.filename)));
    }
    appendMetadata(body, input.options);
    body.append('printBackground', 'true');
    body.append('omitBackground', 'false');

    if (input.options.page.size === 'AUTO') {
      body.append('preferCssPageSize', 'true');
    } else {
      const paper = resolvePaperSize(input.options);
      body.append('paperWidth', `${toInches(paper.width, paper.unit)}in`);
      body.append('paperHeight', `${toInches(paper.height, paper.unit)}in`);
    }

    if (input.options.page.orientation === 'landscape') {
      body.append('landscape', 'true');
    }

    body.append('marginTop', `${toInches(input.options.page.margin.top, 'mm')}in`);
    body.append('marginRight', `${toInches(input.options.page.margin.right, 'mm')}in`);
    body.append('marginBottom', `${toInches(input.options.page.margin.bottom, 'mm')}in`);
    body.append('marginLeft', `${toInches(input.options.page.margin.left, 'mm')}in`);

    return this.post('/forms/chromium/convert/html', body, input.timeoutMs, 'HTML conversion');
  }

  private async post(path: string, body: FormData, timeoutMs: number, label: string): Promise<Buffer> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        throw new AppError(ERROR_CODES.CONVERSION_FAILED, `${label} failed`, { retryable });
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (isAppErrorTimeout(error) || isAbortError(error)) {
        throw new AppError(ERROR_CODES.CONVERSION_TIMEOUT, `${label} timed out`, {
          retryable: true,
          cause: error,
        });
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'Conversion engine is unavailable', {
        retryable: true,
        cause: error,
      });
    }
  }
}

export function createGotenbergClient(): GotenbergClient {
  return new GotenbergClient(getConfig().GOTENBERG_URL);
}

async function fileFromPath(filePath: string, filename: string, type = 'application/octet-stream'): Promise<File> {
  const bytes = await readFile(filePath);
  return new File([bytes], filename, { type });
}

function appendMetadata(body: FormData, options: ConversionOptions): void {
  const metadata = compactMetadata(options.pdf.metadata);
  if (metadata) {
    body.append('metadata', JSON.stringify(metadata));
  }
}

function compactMetadata(metadata: ConversionOptions['pdf']['metadata']): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolvePaperSize(options: ConversionOptions): PageDimensions {
  if (options.page.size === 'CUSTOM') {
    if (!options.page.custom) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Custom page size requires width and height');
    }
    return options.page.custom;
  }
  if (options.page.size === 'AUTO') {
    return PAGE_SIZES.A4;
  }
  return PAGE_SIZES[options.page.size];
}

function toInches(value: number, unit: PageDimensions['unit'] | 'mm'): number {
  if (unit === 'in') {
    return value;
  }
  return toPoints(value, unit) / 72;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function isAppErrorTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}
