import 'fastify';

import type { AuthOwner } from '../modules/pdf/pdf.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    owner?: AuthOwner;
    requestId: string;
    signedDownload?: boolean;
  }
}
