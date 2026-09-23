import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { getConfig } from '../../app/config.js';
import type { GotenbergClient } from '../../infrastructure/gotenberg/client.js';
import type { Metrics } from '../../infrastructure/metrics/metrics.js';
import type { ObjectStorage } from '../pdf/storage/storage.interface.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    redis: Redis;
    gotenberg: GotenbergClient;
    storage: ObjectStorage;
    metrics: Metrics;
  },
): Promise<void> {
  app.get('/health', { schema: { tags: ['Health'], summary: 'Process liveness' } }, async () => ({
    status: 'ok',
  }));

  app.get('/ready', { schema: { tags: ['Health'], summary: 'Dependency readiness' } }, async (_request, reply) => {
    const checks = {
      postgres: await check(() => deps.prisma.$queryRaw`SELECT 1`),
      redis: await check(async () => {
        const pong = await deps.redis.ping();
        if (pong !== 'PONG') {
          throw new Error('redis ping failed');
        }
      }),
      gotenberg: await check(async () => {
        const ok = await deps.gotenberg.health();
        if (!ok) {
          throw new Error('gotenberg unhealthy');
        }
      }),
      storage: await check(() => deps.storage.ensureReady()),
    };

    const required = [
      checks.postgres,
      checks.redis,
      checks.storage,
      getConfig().gotenbergRequired ? checks.gotenberg : true,
    ];
    const ready = required.every(Boolean);
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks,
    });
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', deps.metrics.registry.contentType);
    return reply.send(await deps.metrics.registry.metrics());
  });
}

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}
