import type { FastifyInstance } from 'fastify';

import { getConfig } from '../../app/config.js';
import type { GotenbergClient } from '../../infrastructure/gotenberg/client.js';
import type { Metrics } from '../../infrastructure/metrics/metrics.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    gotenberg: GotenbergClient;
    metrics: Metrics;
  },
): Promise<void> {
  app.get('/health', { schema: { tags: ['Health'], summary: 'Process liveness' } }, async () => ({
    status: 'ok',
  }));

  app.get('/ready', { schema: { tags: ['Health'], summary: 'Dependency readiness' } }, async (_request, reply) => {
    const gotenberg = await check(async () => {
      const ok = await deps.gotenberg.health();
      if (!ok) {
        throw new Error('gotenberg unhealthy');
      }
    });

    const ready = getConfig().gotenbergRequired ? gotenberg : true;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks: { gotenberg },
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
