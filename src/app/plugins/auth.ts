import type { FastifyInstance, FastifyRequest } from 'fastify';

import { verifySignedDownload } from '../../common/utils/signed-download.js';
import { AppError } from '../../common/errors/app-error.js';
import { findApiKey, getConfig } from '../config.js';

const PUBLIC_PATHS = new Set(['/health', '/ready', '/metrics', '/docs', '/docs/', '/documentation']);

function isPublic(url: string): boolean {
  if (PUBLIC_PATHS.has(url)) {
    return true;
  }
  return url.startsWith('/docs') || url.startsWith('/documentation');
}

function extractKey(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return apiKey.trim();
  }
  return undefined;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (request.method === 'OPTIONS' || isPublic(path)) {
      return;
    }

    const fileMatch = path.match(/^\/v1\/pdf\/jobs\/([^/]+)\/file$/);
    if (request.method === 'GET' && fileMatch?.[1]) {
      const query = request.query as { expires?: string; sig?: string };
      if (verifySignedDownload(fileMatch[1], query.expires, query.sig, getConfig().downloadSigningSecret)) {
        request.signedDownload = true;
        return;
      }
    }

    const presented = extractKey(request);
    if (!presented) {
      throw AppError.unauthorized();
    }

    const match = findApiKey(presented);
    if (!match) {
      throw AppError.unauthorized('Invalid API key');
    }

    request.owner = {
      ownerId: match.ownerId,
      apiKeyId: match.keyId,
    };
  });
}
