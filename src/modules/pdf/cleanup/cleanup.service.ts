import type { PrismaClient } from '@prisma/client';

import type { AppConfig } from '../../../app/config.js';
import { cleanupAbandonedTempDirs } from '../../../common/utils/temp-files.js';
import type { AppLogger } from '../../../infrastructure/logging/logger.js';
import type { ObjectStorage } from '../storage/storage.interface.js';

export class CleanupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  async run(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.pdfJob.findMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          {
            status: { in: ['completed', 'failed', 'cancelled'] },
            completedAt: {
              lte: new Date(Date.now() - this.config.PDF_JOB_RETENTION_HOURS * 60 * 60 * 1000),
            },
          },
        ],
        status: { not: 'expired' },
      },
      take: 200,
    });

    for (const job of expired) {
      if (job.inputStorageKey) {
        await this.storage.delete(job.inputStorageKey).catch(() => undefined);
      }
      if (job.outputStorageKey) {
        await this.storage.delete(job.outputStorageKey).catch(() => undefined);
      }
      await this.prisma.pdfJob.update({
        where: { id: job.id },
        data: {
          status: 'expired',
          outputStorageKey: null,
        },
      });
    }

    const tempRemoved = await cleanupAbandonedTempDirs(
      this.config.PDF_JOB_TIMEOUT_SECONDS * 2 * 1000,
    );

    this.logger.info(
      { expiredJobs: expired.length, tempRemoved },
      'Cleanup cycle completed',
    );
  }

  start(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
    return setInterval(() => {
      this.run().catch((error: unknown) => {
        this.logger.error({ err: error }, 'Cleanup cycle failed');
      });
    }, intervalMs);
  }
}
