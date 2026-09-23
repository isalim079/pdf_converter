import type { FastifyInstance } from 'fastify';

import { createRequestId } from '../../common/utils/ids.js';

export async function registerRequestId(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    request.requestId = typeof incoming === 'string' && incoming.startsWith('req_')
      ? incoming
      : createRequestId();
    reply.header('x-request-id', request.requestId);
  });
}
