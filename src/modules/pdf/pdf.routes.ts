import type { FastifyInstance } from 'fastify';

import { createPdfController } from './pdf.controller.js';
import type { PdfService } from './pdf.service.js';

export async function registerPdfRoutes(app: FastifyInstance, service: PdfService): Promise<void> {
  const controller = createPdfController(service);

  app.post(
    '/v1/pdf/convert',
    {
      schema: {
        tags: ['PDF'],
        summary: 'Enqueue a document or image conversion',
        consumes: ['multipart/form-data'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
      },
    },
    (request, reply) => controller.convert(request, reply),
  );

  app.post(
    '/v1/pdf/convert/sync',
    {
      schema: {
        tags: ['PDF'],
        summary: 'Convert a small file and return the PDF immediately',
        consumes: ['multipart/form-data'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
      },
    },
    (request, reply) => controller.convertSync(request, reply),
  );

  app.get(
    '/v1/pdf/jobs/:jobId',
    {
      schema: {
        tags: ['PDF'],
        summary: 'Get conversion job status',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string' } },
        },
      },
    },
    (request, reply) => controller.getJob(request, reply),
  );

  app.get(
    '/v1/pdf/jobs/:jobId/file',
    {
      schema: {
        tags: ['PDF'],
        summary: 'Download a completed PDF',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string' } },
        },
      },
    },
    (request, reply) => controller.downloadFile(request, reply),
  );

  app.delete(
    '/v1/pdf/jobs/:jobId',
    {
      schema: {
        tags: ['PDF'],
        summary: 'Cancel a conversion job',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string' } },
        },
      },
    },
    (request, reply) => controller.deleteJob(request, reply),
  );
}
