import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { getConfig } from '../../app/config.js';
import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import type { ConversionOptions } from '../../modules/pdf/pdf.types.js';

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
    const bytes = await readFile(input.filePath);
    const file = new File([bytes], basename(input.filename), {
      type: 'application/octet-stream',
    });
    body.append('files', file);

    const metadata = compactMetadata(input.options.pdf.metadata);
    if (metadata) {
      body.append('metadata', JSON.stringify(metadata));
    }

    if (input.options.page.orientation === 'landscape') {
      body.append('landscape', 'true');
    }

    try {
      const response = await fetch(`${this.baseUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(input.timeoutMs),
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'Office conversion failed', {
          retryable,
        });
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (isAppErrorTimeout(error) || isAbortError(error)) {
        throw new AppError(ERROR_CODES.CONVERSION_TIMEOUT, 'Office conversion timed out', {
          retryable: true,
          cause: error,
        });
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'Office conversion engine is unavailable', {
        retryable: true,
        cause: error,
      });
    }
  }
}

export function createGotenbergClient(): GotenbergClient {
  return new GotenbergClient(getConfig().GOTENBERG_URL);
}

function compactMetadata(
  metadata: ConversionOptions['pdf']['metadata'],
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function isAppErrorTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}
