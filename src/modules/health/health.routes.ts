import type { FastifyInstance } from 'fastify';

import { getConfig } from '../../app/config.js';
import type { NativeEngines } from '../../infrastructure/engines/native.js';
import type { Metrics } from '../../infrastructure/metrics/metrics.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    engines: NativeEngines;
    metrics: Metrics;
  },
): Promise<void> {
  app.get('/health', { schema: { tags: ['Health'], summary: 'Process liveness' } }, async () => ({
    status: 'ok',
  }));

  app.get('/ready', { schema: { tags: ['Health'], summary: 'Dependency readiness' } }, async (_request, reply) => {
    const libreoffice = Boolean(deps.engines.libreofficeBin());
    const chromium = Boolean(deps.engines.chromiumBin());
    const engines = libreoffice && chromium;
    const ready = getConfig().enginesRequired ? engines : true;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks: { libreoffice, chromium },
    });
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', deps.metrics.registry.contentType);
    return reply.send(await deps.metrics.registry.metrics());
  });
}
