import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import type { AppConfig } from '../../../app/config.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import type { PdfQueuePayload } from '../pdf.types.js';

export const PDF_QUEUE_NAME = 'pdf-conversion';

export function createPdfQueue(connection: Redis): Queue<PdfQueuePayload> {
  return new Queue<PdfQueuePayload>(PDF_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2_000,
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 1_000,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
      },
    },
  });
}

export async function enqueueConversion(
  queue: Queue<PdfQueuePayload>,
  payload: PdfQueuePayload,
  config: AppConfig,
): Promise<void> {
  const counts = await queue.getJobCounts('wait', 'paused', 'delayed');
  const depth = (counts.wait ?? 0) + (counts.paused ?? 0) + (counts.delayed ?? 0);
  if (depth >= config.PDF_MAX_QUEUE_DEPTH) {
    throw new AppError(ERROR_CODES.QUEUE_SATURATED, 'Conversion queue is at capacity', {
      retryable: true,
    });
  }

  await queue.add('convert', payload, {
    jobId: payload.jobId,
  });
}
