import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';

import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { getConfig } from '../../app/config.js';
import type { AuthOwner } from './pdf.types.js';
import { parsePageSizeField } from './pdf.schemas.js';
import type { PdfService } from './pdf.service.js';

function requireOwner(request: FastifyRequest): AuthOwner {
  if (!request.owner) {
    throw AppError.unauthorized();
  }
  return request.owner;
}

function isMultipartFile(value: unknown): value is MultipartFile {
  return Boolean(value && typeof value === 'object' && 'toBuffer' in value && 'filename' in value);
}

function fieldString(value: MultipartValue | MultipartValue[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const single = Array.isArray(value) ? value[0] : value;
  if (!single || typeof single !== 'object' || !('value' in single)) {
    return undefined;
  }
  return String(single.value);
}

async function readConvertRequest(request: FastifyRequest) {
  const file = await request.file();
  if (!file || !isMultipartFile(file)) {
    throw new AppError(ERROR_CODES.FILE_REQUIRED, 'A file is required');
  }

  const buffer = await file.toBuffer();
  const fields = file.fields ?? {};

  const optionsField = fieldString(fields.options as MultipartValue | undefined);
  let rawOptions: unknown = {};
  if (optionsField) {
    try {
      rawOptions = JSON.parse(optionsField);
    } catch {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'options must be valid JSON');
    }
  } else {
    const pageSize = fieldString(fields.pageSize as MultipartValue | undefined);
    const orientation = fieldString(fields.orientation as MultipartValue | undefined);
    const fit = fieldString(fields.fit as MultipartValue | undefined);
    rawOptions = {
      page: {
        ...(pageSize ? { size: parsePageSizeField(pageSize) } : {}),
        ...(orientation ? { orientation } : {}),
      },
      ...(fit ? { image: { fit } } : {}),
    };
  }

  return {
    originalFilename: file.filename,
    declaredMimeType: file.mimetype,
    buffer,
    rawOptions,
  };
}

function serializeJob(
  job: Awaited<ReturnType<PdfService['getJob']>>,
  outputUrl?: string,
) {
  return {
    id: job.id,
    status: job.status,
    input: {
      filename: job.originalFilename,
      mimeType: job.inputMimeType,
      size: Number(job.inputSize),
    },
    output:
      job.status === 'completed' && job.outputStorageKey
        ? {
            mimeType: job.outputMimeType,
            size: job.outputSize ? Number(job.outputSize) : undefined,
            pages: job.pageCount,
            url: outputUrl,
          }
        : undefined,
    error:
      job.status === 'failed'
        ? { code: job.errorCode, message: job.errorMessage }
        : undefined,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };
}

export function createPdfController(service: PdfService) {
  return {
    async convert(request: FastifyRequest, reply: FastifyReply) {
      const payload = await readConvertRequest(request);
      const job = await service.createJob({
        owner: requireOwner(request),
        originalFilename: payload.originalFilename,
        declaredMimeType: payload.declaredMimeType,
        buffer: payload.buffer,
        rawOptions: payload.rawOptions,
        idempotencyKey: request.headers['idempotency-key']?.toString(),
        requestId: request.requestId,
      });

      return reply.code(202).send({
        success: true,
        jobId: job.id,
        status: job.status,
      });
    },

    async convertSync(request: FastifyRequest, reply: FastifyReply) {
      const config = getConfig();
      const payload = await readConvertRequest(request);
      if (payload.buffer.length > config.syncMaxFileSizeBytes) {
        throw new AppError(
          ERROR_CODES.FILE_TOO_LARGE,
          'Synchronous conversion is limited to smaller files',
        );
      }

      const job = await service.createJob({
        owner: requireOwner(request),
        originalFilename: payload.originalFilename,
        declaredMimeType: payload.declaredMimeType,
        buffer: payload.buffer,
        rawOptions: payload.rawOptions,
        idempotencyKey: request.headers['idempotency-key']?.toString(),
        requestId: request.requestId,
        maxBytes: config.syncMaxFileSizeBytes,
      });

      const completed = await service.waitForCompletion(
        job.id,
        requireOwner(request),
        config.PDF_SYNC_TIMEOUT_SECONDS * 1000,
      );

      if (completed.status !== 'completed' || !completed.outputStorageKey) {
        throw new AppError(
          (completed.errorCode as typeof ERROR_CODES.CONVERSION_FAILED) ??
            ERROR_CODES.CONVERSION_FAILED,
          completed.errorMessage ?? 'Synchronous conversion failed',
        );
      }

      if ((completed.pageCount ?? 0) > config.PDF_SYNC_MAX_PAGES) {
        throw new AppError(ERROR_CODES.PDF_VALIDATION_FAILED, 'Synchronous conversion exceeded the page limit');
      }

      const pdf = await service.downloadOutput(completed.outputStorageKey);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('X-Job-Id', completed.id)
        .send(pdf);
    },

    async getJob(request: FastifyRequest, reply: FastifyReply) {
      const jobId = (request.params as { jobId: string }).jobId;
      const job = await service.getJob(jobId, requireOwner(request));
      const url =
        job.status === 'completed' && job.outputStorageKey
          ? await service.signedOutputUrl(job.outputStorageKey, job.id)
          : undefined;

      return reply.send({
        success: true,
        job: serializeJob(job, url),
      });
    },

    async downloadFile(request: FastifyRequest, reply: FastifyReply) {
      const jobId = (request.params as { jobId: string }).jobId;
      if (!request.owner && !request.signedDownload) {
        throw AppError.unauthorized();
      }
      const job = request.owner
        ? await service.getJob(jobId, request.owner)
        : await service.getJobById(jobId);
      if (job.status !== 'completed' || !job.outputStorageKey) {
        throw new AppError(ERROR_CODES.JOB_NOT_FOUND, 'No generated PDF is available for this job');
      }
      const pdf = await service.downloadOutput(job.outputStorageKey);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${job.id}.pdf"`)
        .send(pdf);
    },

    async deleteJob(request: FastifyRequest, reply: FastifyReply) {
      const jobId = (request.params as { jobId: string }).jobId;
      const job = await service.cancelJob(jobId, requireOwner(request));
      return reply.send({
        success: true,
        job: serializeJob(job),
      });
    },
  };
}
