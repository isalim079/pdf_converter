import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3050',
      DATABASE_URL: 'postgresql://pdf:pdf@localhost:5432/pdf_service',
      REDIS_URL: 'redis://localhost:6379',
      GOTENBERG_URL: 'http://localhost:3000',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'pdf-service',
      S3_ACCESS_KEY: 'minio',
      S3_SECRET_KEY: 'change-me-minio-secret',
      S3_FORCE_PATH_STYLE: 'true',
      API_KEYS: 'test-key:org_test:key_test,other-key:org_other:key_other',
      PDF_TEMP_DIR: '/tmp/pdf-service-test',
    },
  },
});
