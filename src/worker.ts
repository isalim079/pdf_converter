import closeWithGrace from 'close-with-grace';

import { closeContainer, createContainer } from './app/container.js';
import { cleanupAbandonedTempDirs } from './common/utils/temp-files.js';
import { createRedis } from './infrastructure/redis/redis.js';
import { createPdfWorker, recoverStaleJobs } from './modules/pdf/queue/pdf.worker.js';

async function main(): Promise<void> {
  const container = createContainer();
  await container.storage.ensureReady();
  await cleanupAbandonedTempDirs(container.config.PDF_JOB_TIMEOUT_SECONDS * 2 * 1000);

  const recovered = await recoverStaleJobs(
    container.prisma,
    container.config.PDF_JOB_TIMEOUT_SECONDS,
  );
  if (recovered > 0) {
    container.logger.warn({ recovered }, 'Requeued stale processing jobs');
  }

  const workerConnection = createRedis(container.config.REDIS_URL);
  const worker = createPdfWorker({
    connection: workerConnection,
    prisma: container.prisma,
    storage: container.storage,
    resolver: container.resolver,
    config: container.config,
    logger: container.logger,
    metrics: container.metrics,
  });

  const cleanupTimer = container.cleanup.start();
  container.logger.info(
    { concurrency: container.config.PDF_WORKER_CONCURRENCY },
    'PDF worker started',
  );

  closeWithGrace({ delay: container.config.PDF_JOB_TIMEOUT_SECONDS * 1000 }, async ({ signal }) => {
    container.logger.info({ signal }, 'Worker shutting down');
    clearInterval(cleanupTimer);
    await worker.close();
    workerConnection.disconnect();
    await closeContainer(container);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
