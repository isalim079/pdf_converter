import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const optionalPath = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3050),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

  LIBREOFFICE_BIN: optionalPath,
  CHROMIUM_BIN: optionalPath,
  ENGINES_REQUIRED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

  PDF_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(25),
  PDF_MAX_PAGES: z.coerce.number().int().positive().default(300),
  PDF_JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  PDF_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  PDF_MAX_HTML_ASSETS: z.coerce.number().int().positive().default(32),
  PDF_TEMP_DIR: z.string().optional(),

  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema> & {
  PDF_TEMP_DIR: string;
  maxFileSizeBytes: number;
  swaggerEnabled: boolean;
  enginesRequired: boolean;
};

export function isUnixStyleTempDir(dir: string): boolean {
  return dir === '/tmp' || dir.startsWith('/tmp/') || dir.startsWith('/var/tmp');
}

export function resolvePdfTempDir(dir: string | undefined, platform = process.platform): string {
  const fallback = platform === 'win32' ? join(tmpdir(), 'pdf-service') : '/tmp/pdf-service';
  const trimmed = dir?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (platform === 'win32' && isUnixStyleTempDir(trimmed)) {
    return fallback;
  }
  return trimmed;
}

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    ...parsed,
    PDF_TEMP_DIR: resolvePdfTempDir(parsed.PDF_TEMP_DIR),
    maxFileSizeBytes: Math.round(parsed.PDF_MAX_FILE_SIZE_MB * 1024 * 1024),
    swaggerEnabled: parsed.SWAGGER_ENABLED ?? parsed.NODE_ENV !== 'production',
    enginesRequired: parsed.ENGINES_REQUIRED ?? parsed.NODE_ENV === 'production',
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
