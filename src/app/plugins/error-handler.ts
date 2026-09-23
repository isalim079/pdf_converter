import type { FastifyInstance } from 'fastify';

import { AppError, isAppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    request.log.error(
      {
        requestId: request.requestId,
        errorCode: mapped.code,
        statusCode: mapped.statusCode,
      },
      mapped.expose ? mapped.message : 'Request failed',
    );

    reply.code(mapped.statusCode).send({
      success: false,
      error: {
        code: mapped.code,
        message: mapped.expose ? mapped.message : 'An unexpected error occurred',
        requestId: request.requestId,
      },
    });
  });
}

function mapError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (typeof error === 'object' && error && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: number }).statusCode);
    if (statusCode === 429) {
      return new AppError(ERROR_CODES.RATE_LIMITED, 'Rate limit exceeded');
    }
    if (statusCode === 413) {
      return new AppError(ERROR_CODES.FILE_TOO_LARGE, 'The uploaded file exceeds the configured size limit');
    }
    if (statusCode === 400) {
      return new AppError(ERROR_CODES.INVALID_REQUEST, 'The request is invalid');
    }
  }

  return new AppError(ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred', {
    expose: false,
    cause: error,
  });
}
