import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { AppConfig } from '../../../app/config.js';
import { isAppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { createJobTempDir, removeJobTempDir } from '../../../common/utils/temp-files.js';
import type { AppLogger } from '../../../infrastructure/logging/logger.js';
import type { Metrics } from '../../../infrastructure/metrics/metrics.js';
import type { ConverterResolver } from '../converters/converter-resolver.js';
import type { ConversionInput, PdfQueuePayload } from '../pdf.types.js';
import type { ObjectStorage } from '../storage/storage.interface.js';
import { validatePdf } from '../validation/pdf-validator.js';
import { PDF_QUEUE_NAME } from './pdf.queue.js';

export function createPdfWorker(deps: {
  connection: Redis;
  prisma: PrismaClient;
  storage: ObjectStorage;
  resolver: ConverterResolver;
  config: AppConfig;
  logger: AppLogger;
  metrics: Metrics;
}): Worker<PdfQueuePayload> {
  const worker = new Worker<PdfQueuePayload>(
    PDF_QUEUE_NAME,
    async (job) => {
      const started = Date.now();
      deps.metrics.activeJobs.inc();
      deps.metrics.conversionInputBytes.inc(0);

      await deps.prisma.pdfJob.update({
        where: { id: job.data.jobId },
        data: {
          status: 'processing',
          startedAt: new Date(),
          attempts: job.attemptsMade + 1,
        },
      });

      const tempDir = await createJobTempDir(job.data.jobId);
      const inputPath = join(tempDir, `input${job.data.extension}`);

      try {
        const inputBytes = await deps.storage.download(job.data.inputStorageKey);
        await writeFile(inputPath, inputBytes);
        deps.metrics.conversionInputBytes.inc(inputBytes.length);

        const conversionInput: ConversionInput = {
          jobId: job.data.jobId,
          filePath: inputPath,
          originalFilename: job.data.originalFilename,
          mimeType: job.data.mimeType,
          extension: job.data.extension,
          size: inputBytes.length,
        };

        const converter = deps.resolver.resolve(conversionInput);
        const result = await converter.convert(conversionInput, job.data.options);
        const validated = await validatePdf(result.outputPath);

        await deps.storage.upload(
          job.data.outputStorageKey,
          await readFile(result.outputPath),
          'application/pdf',
        );

        await deps.prisma.pdfJob.update({
          where: { id: job.data.jobId },
          data: {
            status: 'completed',
            outputStorageKey: job.data.outputStorageKey,
            outputMimeType: 'application/pdf',
            outputSize: BigInt(validated.size),
            pageCount: validated.pageCount,
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });

        const durationMs = Date.now() - started;
        deps.metrics.conversionTotal.inc({ engine: result.engine, status: 'success' });
        deps.metrics.conversionDuration.observe({ engine: result.engine }, durationMs / 1000);
        deps.metrics.conversionOutputBytes.inc(validated.size);

        deps.logger.info(
          {
            jobId: job.data.jobId,
            ownerId: job.data.ownerId,
            engine: result.engine,
            inputType: job.data.extension.replace('.', ''),
            inputSize: inputBytes.length,
            outputSize: validated.size,
            pages: validated.pageCount,
            durationMs,
          },
          'PDF conversion completed',
        );
      } catch (error) {
        const mapped = mapWorkerError(error);
        deps.metrics.conversionTotal.inc({
          engine: job.data.conversionEngine,
          status: 'failure',
        });
        deps.logger.error(
          {
            jobId: job.data.jobId,
            ownerId: job.data.ownerId,
            engine: job.data.conversionEngine,
            errorCode: mapped.code,
          },
          'PDF conversion failed',
        );

        if (!mapped.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
          await deps.prisma.pdfJob.update({
            where: { id: job.data.jobId },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorCode: mapped.code,
              errorMessage: mapped.message,
            },
          });
        }

        if (!mapped.retryable) {
          throw new UnrecoverableError(mapped.message);
        }
        throw error;
      } finally {
        deps.metrics.activeJobs.dec();
        await removeJobTempDir(job.data.jobId);
      }
    },
    {
      connection: deps.connection,
      concurrency: deps.config.PDF_WORKER_CONCURRENCY,
    },
  );

  return worker;
}

function mapWorkerError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (isAppError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: ERROR_CODES.CONVERSION_FAILED,
    message: 'Conversion failed',
    retryable: true,
  };
}

export async function recoverStaleJobs(prisma: PrismaClient, timeoutSeconds: number): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000);
  const result = await prisma.pdfJob.updateMany({
    where: {
      status: 'processing',
      startedAt: { lt: cutoff },
    },
    data: {
      status: 'queued',
      errorCode: null,
      errorMessage: null,
    },
  });
  return result.count;
}
