import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { createGotenbergClient, type GotenbergClient } from '../infrastructure/gotenberg/client.js';
import { createLogger, type AppLogger } from '../infrastructure/logging/logger.js';
import { createMetrics, type Metrics } from '../infrastructure/metrics/metrics.js';
import { createPrismaClient } from '../infrastructure/postgres/prisma.js';
import { createRedis } from '../infrastructure/redis/redis.js';
import { CleanupService } from '../modules/pdf/cleanup/cleanup.service.js';
import { ConverterResolver } from '../modules/pdf/converters/converter-resolver.js';
import { GotenbergConverter } from '../modules/pdf/converters/gotenberg.converter.js';
import { ImageConverter } from '../modules/pdf/converters/image.converter.js';
import { createPdfQueue } from '../modules/pdf/queue/pdf.queue.js';
import { PdfService } from '../modules/pdf/pdf.service.js';
import type { PdfQueuePayload } from '../modules/pdf/pdf.types.js';
import { FileSystemStorage } from '../modules/pdf/storage/fs.storage.js';
import { S3ObjectStorage } from '../modules/pdf/storage/s3.storage.js';
import type { ObjectStorage } from '../modules/pdf/storage/storage.interface.js';
import { NoopMalwareScanner } from '../modules/pdf/validation/malware-scanner.js';
import { getConfig, type AppConfig } from './config.js';

export interface AppContainer {
  config: AppConfig;
  logger: AppLogger;
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue<PdfQueuePayload>;
  storage: ObjectStorage;
  gotenberg: GotenbergClient;
  resolver: ConverterResolver;
  pdfService: PdfService;
  cleanup: CleanupService;
  metrics: Metrics;
}

export function createContainer(): AppContainer {
  const config = getConfig();
  const logger = createLogger();
  const prisma = createPrismaClient();
  const redis = createRedis(config.REDIS_URL);
  const queue = createPdfQueue(redis);
  const storage =
    config.STORAGE_DRIVER === 'fs' ? new FileSystemStorage(config) : new S3ObjectStorage(config);
  const gotenberg = createGotenbergClient();
  const resolver = new ConverterResolver([new ImageConverter(), new GotenbergConverter(gotenberg)]);
  const metrics = createMetrics();
  const pdfService = new PdfService(
    prisma,
    storage,
    queue,
    new NoopMalwareScanner(),
    config,
    logger,
  );
  const cleanup = new CleanupService(prisma, storage, config, logger);

  return {
    config,
    logger,
    prisma,
    redis,
    queue,
    storage,
    gotenberg,
    resolver,
    pdfService,
    cleanup,
    metrics,
  };
}

export async function closeContainer(container: AppContainer): Promise<void> {
  await container.queue.close();
  container.redis.disconnect();
  await container.prisma.$disconnect();
}
