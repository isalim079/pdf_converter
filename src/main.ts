import closeWithGrace from 'close-with-grace';

import { closeContainer, createContainer } from './app/container.js';
import { buildServer } from './app/server.js';
import { cleanupAbandonedTempDirs } from './common/utils/temp-files.js';

async function main(): Promise<void> {
  const container = createContainer();
  const app = await buildServer(container);

  try {
    await container.storage.ensureReady();
  } catch (error) {
    container.logger.fatal(
      { err: error, endpoint: container.config.S3_ENDPOINT, driver: container.config.STORAGE_DRIVER },
      'Storage is not ready. Start dependencies with `yarn infra`, or set STORAGE_DRIVER=fs in .env for local development without MinIO.',
    );
    throw error;
  }
  await cleanupAbandonedTempDirs(container.config.PDF_JOB_TIMEOUT_SECONDS * 2 * 1000);
  const cleanupTimer = container.cleanup.start();

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
    clearInterval(cleanupTimer);
    await app.close();
    await closeContainer(container);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
