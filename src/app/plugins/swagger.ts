import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';

export async function registerSwagger(app: FastifyInstance, config: AppConfig): Promise<void> {
  if (!config.swaggerEnabled) {
    return;
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PDF Conversion Service',
        description: 'Asynchronous document and image to PDF conversion API',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${config.PORT}` }],
      tags: [
        { name: 'PDF', description: 'Conversion jobs' },
        { name: 'Health', description: 'Liveness and readiness' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });
}
