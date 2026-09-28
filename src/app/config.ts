import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3050),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

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

  PDF_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(25),
  PDF_MAX_PAGES: z.coerce.number().int().positive().default(300),
  PDF_JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  PDF_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  PDF_MAX_HTML_ASSETS: z.coerce.number().int().positive().default(32),
  PDF_TEMP_DIR: z.string().default('/tmp/pdf-service'),

  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema> & {
  maxFileSizeBytes: number;
  swaggerEnabled: boolean;
  gotenbergRequired: boolean;
};

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    ...parsed,
    maxFileSizeBytes: Math.round(parsed.PDF_MAX_FILE_SIZE_MB * 1024 * 1024),
    swaggerEnabled: parsed.SWAGGER_ENABLED ?? parsed.NODE_ENV !== 'production',
    gotenbergRequired: parsed.GOTENBERG_REQUIRED ?? parsed.NODE_ENV === 'production',
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
