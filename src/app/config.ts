import { z } from 'zod';

const apiKeyEntrySchema = z.object({
  key: z.string().min(8),
  ownerId: z.string().min(1),
  keyId: z.string().min(1),
});

export type ApiKeyEntry = z.infer<typeof apiKeyEntrySchema>;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3050),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

  API_KEYS: z.string().min(1),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  GOTENBERG_URL: z.string().url(),
  GOTENBERG_BIN: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  GOTENBERG_REQUIRED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  PUBLIC_URL: z.string().url().default('http://localhost:3050'),
  STORAGE_DRIVER: z.enum(['s3', 'fs']).default('s3'),
  STORAGE_FS_ROOT: z.string().default('/tmp/pdf-service-objects'),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  PDF_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(25),
  PDF_MAX_PAGES: z.coerce.number().int().positive().default(300),
  PDF_JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  PDF_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PDF_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  PDF_MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(100),
  PDF_JOB_RETENTION_HOURS: z.coerce.number().positive().default(24),
  PDF_INPUT_RETENTION_HOURS: z.coerce.number().positive().default(24),
  PDF_TEMP_DIR: z.string().default('/tmp/pdf-service'),
  PDF_SYNC_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),
  PDF_SYNC_MAX_PAGES: z.coerce.number().int().positive().default(30),
  PDF_SYNC_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),

  SIGNED_URL_EXPIRES_SECONDS: z.coerce.number().int().positive().default(900),
  DOWNLOAD_SIGNING_SECRET: z.string().min(16).optional(),

  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema> & {
  apiKeys: ApiKeyEntry[];
  maxFileSizeBytes: number;
  syncMaxFileSizeBytes: number;
  swaggerEnabled: boolean;
  gotenbergRequired: boolean;
  downloadSigningSecret: string;
};

function parseApiKeys(raw: string): ApiKeyEntry[] {
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, ownerId, keyId] = part.split(':');
      return apiKeyEntrySchema.parse({
        key,
        ownerId,
        keyId: keyId ?? ownerId,
      });
    });

  if (entries.length === 0) {
    throw new Error('API_KEYS must contain at least one key:ownerId:keyId entry');
  }

  return entries;
}

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const apiKeys = parseApiKeys(parsed.API_KEYS);

  return {
    ...parsed,
    apiKeys,
    maxFileSizeBytes: Math.round(parsed.PDF_MAX_FILE_SIZE_MB * 1024 * 1024),
    syncMaxFileSizeBytes: Math.round(parsed.PDF_SYNC_MAX_FILE_SIZE_MB * 1024 * 1024),
    swaggerEnabled: parsed.SWAGGER_ENABLED ?? parsed.NODE_ENV !== 'production',
    gotenbergRequired: parsed.GOTENBERG_REQUIRED ?? parsed.NODE_ENV === 'production',
    downloadSigningSecret: parsed.DOWNLOAD_SIGNING_SECRET ?? `pdf-download:${parsed.API_KEYS}`,
  };
}

export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}

export function findApiKey(presented: string): ApiKeyEntry | undefined {
  return getConfig().apiKeys.find((entry) => entry.key === presented);
}
