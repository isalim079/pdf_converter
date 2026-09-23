import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerAuth } from '../src/app/plugins/auth.js';
import { registerErrorHandler } from '../src/app/plugins/error-handler.js';
import { registerRequestId } from '../src/app/plugins/request-id.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerRequestId(app);
  await registerErrorHandler(app);
  await registerAuth(app);
  app.get('/v1/secure', async (request) => ({ success: true, owner: request.owner }));
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}

describe('authentication', () => {
  it('allows health without a key', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('rejects missing credentials', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/secure' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
    await app.close();
  });

  it('accepts a configured API key and binds an owner', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/secure',
      headers: { authorization: 'Bearer test-key' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().owner).toEqual({ ownerId: 'org_test', apiKeyId: 'key_test' });
    await app.close();
  });
});
