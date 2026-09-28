import closeWithGrace from 'close-with-grace';

import { createContainer } from './app/container.js';
import { loadEnvFile } from './app/load-env.js';
import { buildServer } from './app/server.js';
import { cleanupAbandonedTempDirs } from './common/utils/temp-files.js';

loadEnvFile();

async function main(): Promise<void> {
  const container = createContainer();
  const app = await buildServer(container);

  await cleanupAbandonedTempDirs(container.config.PDF_JOB_TIMEOUT_SECONDS * 2 * 1000);

  await app.listen({
    port: container.config.PORT,
    host: '0.0.0.0',
  });

  closeWithGrace({ delay: 10_000 }, async ({ err, signal }) => {
    if (err) {
      container.logger.error({ err }, 'Server closing after error');
    } else {
      container.logger.info({ signal }, 'Server shutting down');
    }
    await app.close();
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
