import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from './error-codes.js';

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

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(ERROR_CODES.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have access to this job'): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'Job not found'): AppError {
    return new AppError(ERROR_CODES.JOB_NOT_FOUND, message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isRetryableError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.retryable;
  }
  return false;
}
