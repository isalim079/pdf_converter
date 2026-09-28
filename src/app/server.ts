import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { registerHealthRoutes } from '../modules/health/health.routes.js';
import { registerPdfRoutes } from '../modules/pdf/pdf.routes.js';
import type { AppContainer } from './container.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRequestId } from './plugins/request-id.js';
import { registerSwagger } from './plugins/swagger.js';

export async function buildServer(container: AppContainer) {
  const app = Fastify({
    logger: {
      level: container.config.LOG_LEVEL,
      redact: {
        paths: ['password', 'url'],
        remove: true,
      },
    },
    trustProxy: true,
    bodyLimit: container.config.maxFileSizeBytes + 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: container.config.swaggerEnabled ? false : true,
  });
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: container.config.maxFileSizeBytes,
      files: 1 + container.config.PDF_MAX_HTML_ASSETS,
      fields: 16,
    },
  });
  await app.register(rateLimit, {
    max: container.config.API_RATE_LIMIT_MAX,
    timeWindow: container.config.API_RATE_LIMIT_WINDOW_SECONDS * 1000,
    keyGenerator: (request) => request.ip,
    allowList: (request) => {
      const path = request.url.split('?')[0] ?? '';
      return path === '/health' || path === '/ready' || path === '/metrics';
    },
  });

  await registerRequestId(app);
  await registerErrorHandler(app);
  await registerSwagger(app, container.config);
  await registerHealthRoutes(app, {
    gotenberg: container.gotenberg,
    metrics: container.metrics,
  });
  await registerPdfRoutes(app, container.pdfService);

  return app;
}
