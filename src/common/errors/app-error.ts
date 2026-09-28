import { ERROR_STATUS, type ErrorCode } from './error-codes.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly expose: boolean;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { statusCode?: number; expose?: boolean; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options.statusCode ?? ERROR_STATUS[code];
    this.expose = options.expose ?? this.statusCode < 500;
    this.retryable = options.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
