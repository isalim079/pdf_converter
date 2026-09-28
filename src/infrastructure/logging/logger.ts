import pino from 'pino';

import { getConfig } from '../../app/config.js';

export function createLogger() {
  const config = getConfig();
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'pdf-converter' },
    redact: {
      paths: ['password'],
      remove: true,
    },
    transport:
      config.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          }
        : undefined,
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
