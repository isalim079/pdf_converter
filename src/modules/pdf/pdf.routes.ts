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
        summary: 'Convert a document or image to PDF',
        consumes: ['multipart/form-data'],
      },
    },
    (request, reply) => controller.convert(request, reply),
  );
}
