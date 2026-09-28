import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../../app/config.js';
import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { createConversionId } from '../../common/utils/ids.js';
import { extensionOf, sanitizeFilename } from '../../common/utils/filenames.js';
import { createConversionTempDir, removeConversionTempDir } from '../../common/utils/temp-files.js';
import type { AppLogger } from '../../infrastructure/logging/logger.js';
import type { Metrics } from '../../infrastructure/metrics/metrics.js';
import type { ConverterResolver } from './converters/converter-resolver.js';
import { conversionOptionsSchema, normalizePageSizeName } from './pdf.schemas.js';
import type {
  ConversionEngine,
  ConversionInput,
  ConversionOptions,
} from './pdf.types.js';
import { validateHtmlAssets, validateUpload } from './validation/file-validator.js';
import { validatePdf } from './validation/pdf-validator.js';

export interface ConvertFileInput {
  originalFilename: string;
  declaredMimeType?: string;
  buffer: Buffer;
  rawOptions: unknown;
  assets: Array<{ originalFilename: string; buffer: Buffer }>;
  requestId: string;
}

export interface ConvertFileResult {
  pdf: Buffer;
  filename: string;
  pageCount: number;
  size: number;
  engine: ConversionEngine;
}

export class PdfService {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly resolver: ConverterResolver,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  async convert(input: ConvertFileInput): Promise<ConvertFileResult> {
    const options = parseOptions(input.rawOptions);
    const validated = await validateUpload({
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      buffer: input.buffer,
      maxBytes: this.config.maxFileSizeBytes,
    });

    const assets =
      validated.format.family === 'html'
        ? validateHtmlAssets(input.assets, {
            maxCount: this.config.PDF_MAX_HTML_ASSETS,
            maxBytes: this.config.maxFileSizeBytes,
          })
        : [];

    if (validated.format.family !== 'html' && input.assets.length > 0) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Assets are only accepted with HTML uploads');
    }

    const conversionId = createConversionId();
    const tempDir = await createConversionTempDir(conversionId);
    const inputPath = join(tempDir, `input${validated.extension}`);
    const started = Date.now();

    await this.acquire();
    this.metrics.activeJobs.inc();
    this.metrics.conversionInputBytes.inc(validated.size);

    try {
      await writeFile(inputPath, input.buffer);
      const conversionAssets = [];
      for (const asset of assets) {
        const assetPath = join(tempDir, asset.filename);
        await writeFile(assetPath, asset.buffer);
        conversionAssets.push({ filename: asset.filename, filePath: assetPath });
      }

      const conversionInput: ConversionInput = {
        conversionId,
        filePath: inputPath,
        originalFilename: validated.filename,
        mimeType: validated.mimeType,
        extension: validated.extension,
        size: validated.size,
        assets: conversionAssets,
      };

      const converter = this.resolver.resolve(conversionInput);
      const result = await converter.convert(conversionInput, options);
      const validatedPdf = await validatePdf(result.outputPath);
      const pdf = await readFile(result.outputPath);

      const durationMs = Date.now() - started;
      this.metrics.conversionTotal.inc({ engine: result.engine, status: 'success' });
      this.metrics.conversionDuration.observe({ engine: result.engine }, durationMs / 1000);
      this.metrics.conversionOutputBytes.inc(validatedPdf.size);

      this.logger.info(
        {
          requestId: input.requestId,
          conversionId,
          engine: result.engine,
          inputType: validated.extension.replace('.', ''),
          inputSize: validated.size,
          outputSize: validatedPdf.size,
          pages: validatedPdf.pageCount,
          durationMs,
        },
        'PDF conversion completed',
      );

      return {
        pdf,
        filename: pdfFilename(validated.filename),
        pageCount: validatedPdf.pageCount,
        size: validatedPdf.size,
        engine: result.engine,
      };
    } catch (error) {
      this.metrics.conversionTotal.inc({
        engine: validated.format.engine,
        status: 'failure',
      });
      this.logger.error(
        {
          requestId: input.requestId,
          conversionId,
          engine: validated.format.engine,
          errorCode: error instanceof AppError ? error.code : ERROR_CODES.CONVERSION_FAILED,
        },
        'PDF conversion failed',
      );
      throw error;
    } finally {
      this.metrics.activeJobs.dec();
      this.release();
      await removeConversionTempDir(conversionId);
    }
  }

  private async acquire(): Promise<void> {
    while (this.active >= this.config.PDF_MAX_CONCURRENT_JOBS) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active += 1;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

export function parseOptions(raw: unknown): ConversionOptions {
  const parsed = conversionOptionsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Conversion options are invalid');
  }

  return {
    page: {
      size: normalizePageSizeName(parsed.data.page.size),
      custom: parsed.data.page.custom,
      orientation: parsed.data.page.orientation,
      margin: parsed.data.page.margin,
    },
    image: parsed.data.image,
    pdf: {
      pdfa: false,
      metadata: {
        ...parsed.data.pdf.metadata,
        ...(parsed.data.pdf.title ? { title: parsed.data.pdf.title } : {}),
      },
    },
  };
}

function pdfFilename(original: string): string {
  const sanitized = sanitizeFilename(original);
  const extension = extensionOf(sanitized);
  const base = extension ? sanitized.slice(0, -extension.length) : sanitized;
  const name = base.length > 0 ? base : 'document';
  return `${name}.pdf`;
}
