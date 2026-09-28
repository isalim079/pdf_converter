import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3050',
      LOG_LEVEL: 'fatal',
      ENGINES_REQUIRED: 'false',
      PDF_TEMP_DIR: '/tmp/pdf-service-test',
    },
  },
});
