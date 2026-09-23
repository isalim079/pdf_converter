import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { registerHealthRoutes } from '../modules/health/health.routes.js';
import { registerPdfRoutes } from '../modules/pdf/pdf.routes.js';
import type { AppContainer } from './container.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRequestId } from './plugins/request-id.js';
import { registerSwagger } from './plugins/swagger.js';

export async function buildServer(container: AppContainer) {
  const app = Fastify({
    logger: {
      level: container.config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'apiKey',
          'password',
          'signedUrl',
          'url',
        ],
        remove: true,
      },
    },
    trustProxy: true,
    bodyLimit: container.config.maxFileSizeBytes + 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: container.config.swaggerEnabled ? false : true,
  });
  await app.register(cors, { origin: false });
  await app.register(multipart, {
    limits: {
      fileSize: container.config.maxFileSizeBytes,
      files: 1,
      fields: 16,
    },
  });
  await app.register(rateLimit, {
    max: container.config.API_RATE_LIMIT_MAX,
    timeWindow: container.config.API_RATE_LIMIT_WINDOW_SECONDS * 1000,
    keyGenerator: (request) => {
      const bearer = request.headers.authorization;
      if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
        return `key:${bearer.slice(7, 19)}`;
      }
      const apiKey = request.headers['x-api-key'];
      if (typeof apiKey === 'string') {
        return `key:${apiKey.slice(0, 12)}`;
      }
      return request.ip;
    },
    allowList: (request) => {
      const path = request.url.split('?')[0] ?? '';
      return path === '/health' || path === '/ready' || path === '/metrics';
    },
  });

  await registerRequestId(app);
  await registerErrorHandler(app);
  await registerSwagger(app, container.config);
  await registerAuth(app);
  await registerHealthRoutes(app, {
    prisma: container.prisma,
    redis: container.redis,
    gotenberg: container.gotenberg,
    storage: container.storage,
    metrics: container.metrics,
  });
  await registerPdfRoutes(app, container.pdfService);

  return app;
}
