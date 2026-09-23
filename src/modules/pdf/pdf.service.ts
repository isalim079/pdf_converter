import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';

import type { AppConfig } from '../../app/config.js';
import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { sha256 } from '../../common/utils/hash.js';
import { createSignedDownloadQuery } from '../../common/utils/signed-download.js';
import { createJobId } from '../../common/utils/ids.js';
import { createJobTempDir, removeJobTempDir } from '../../common/utils/temp-files.js';
import type { AppLogger } from '../../infrastructure/logging/logger.js';
import { conversionOptionsSchema, normalizePageSizeName } from './pdf.schemas.js';
import type {
  AuthOwner,
  ConversionEngine,
  ConversionOptions,
  PdfQueuePayload,
} from './pdf.types.js';
import { enqueueConversion } from './queue/pdf.queue.js';
import type { ObjectStorage } from './storage/storage.interface.js';
import { validateUpload } from './validation/file-validator.js';
import type { MalwareScanner } from './validation/malware-scanner.js';

export interface CreateJobInput {
  owner: AuthOwner;
  originalFilename: string;
  declaredMimeType?: string;
  buffer: Buffer;
  rawOptions: unknown;
  idempotencyKey?: string;
  requestId: string;
  maxBytes?: number;
}

export class PdfService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly queue: Queue<PdfQueuePayload>,
    private readonly scanner: MalwareScanner,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  async createJob(input: CreateJobInput) {
    const options = parseOptions(input.rawOptions);
    const validated = await validateUpload({
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      buffer: input.buffer,
      maxBytes: input.maxBytes ?? this.config.maxFileSizeBytes,
    });

    const requestHash = sha256(
      JSON.stringify({
        filename: validated.filename,
        size: validated.size,
        mimeType: validated.mimeType,
        options,
      }),
    );

    if (input.idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          ownerId_key: {
            ownerId: input.owner.ownerId,
            key: input.idempotencyKey,
          },
        },
        include: { job: true },
      });

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new AppError(
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'Idempotency key was reused with a different request',
          );
        }
        return existing.job;
      }
    }

    const jobId = createJobId();
    const inputStorageKey = `uploads/${jobId}/input${validated.extension}`;
    const outputStorageKey = `pdf/${jobId}/output.pdf`;
    const expiresAt = new Date(Date.now() + this.config.PDF_JOB_RETENTION_HOURS * 60 * 60 * 1000);

    const tempDir = await createJobTempDir(jobId);
    const inputPath = join(tempDir, `input${validated.extension}`);

    try {
      await writeFile(inputPath, input.buffer);
      const scan = await this.scanner.scan(inputPath);
      if (!scan.clean) {
        throw new AppError(ERROR_CODES.MALWARE_DETECTED, 'The uploaded file failed the malware scan');
      }

      await this.storage.upload(inputStorageKey, input.buffer, validated.mimeType);

      const job = await this.prisma.pdfJob.create({
        data: {
          id: jobId,
          status: 'queued',
          ownerId: input.owner.ownerId,
          apiKeyId: input.owner.apiKeyId,
          originalFilename: validated.filename,
          inputMimeType: validated.mimeType,
          inputSize: BigInt(validated.size),
          inputStorageKey,
          conversionEngine: validated.format.engine,
          pageSize: options.page.size,
          orientation: options.page.orientation,
          options: options as unknown as Prisma.InputJsonValue,
          expiresAt,
        },
      });

      if (input.idempotencyKey) {
        await this.prisma.idempotencyRecord.create({
          data: {
            ownerId: input.owner.ownerId,
            key: input.idempotencyKey,
            jobId,
            requestHash,
          },
        });
      }

      await enqueueConversion(
        this.queue,
        {
          jobId,
          ownerId: input.owner.ownerId,
          inputStorageKey,
          outputStorageKey,
          mimeType: validated.mimeType,
          extension: validated.extension,
          originalFilename: validated.filename,
          conversionEngine: validated.format.engine as ConversionEngine,
          options,
        },
        this.config,
      );

      this.logger.info(
        {
          requestId: input.requestId,
          jobId,
          ownerId: input.owner.ownerId,
          engine: validated.format.engine,
          inputMimeType: validated.mimeType,
          fileSize: validated.size,
        },
        'PDF conversion queued',
      );

      return job;
    } catch (error) {
      await this.storage.delete(inputStorageKey).catch(() => undefined);
      await this.prisma.pdfJob.delete({ where: { id: jobId } }).catch(() => undefined);
      throw error;
    } finally {
      await removeJobTempDir(jobId);
    }
  }

  async getJobById(jobId: string) {
    const job = await this.prisma.pdfJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw AppError.notFound();
    }
    return job;
  }

  async getJob(jobId: string, owner: AuthOwner) {
    const job = await this.prisma.pdfJob.findFirst({
      where: { id: jobId, ownerId: owner.ownerId },
    });
    if (!job) {
      throw AppError.notFound();
    }
    return job;
  }

  async cancelJob(jobId: string, owner: AuthOwner) {
    const job = await this.getJob(jobId, owner);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }

    await this.queue.remove(jobId).catch(() => undefined);

    return this.prisma.pdfJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorCode: ERROR_CODES.INVALID_REQUEST,
        errorMessage: 'Cancelled by requester',
      },
    });
  }

  async signedOutputUrl(outputStorageKey: string, jobId?: string): Promise<string> {
    if (this.config.STORAGE_DRIVER === 'fs' && jobId) {
      const query = createSignedDownloadQuery(
        jobId,
        this.config.SIGNED_URL_EXPIRES_SECONDS,
        this.config.downloadSigningSecret,
      );
      return `${this.config.PUBLIC_URL}/v1/pdf/jobs/${jobId}/file?${query}`;
    }
    return this.storage.createSignedUrl(outputStorageKey, this.config.SIGNED_URL_EXPIRES_SECONDS);
  }

  async waitForCompletion(jobId: string, owner: AuthOwner, timeoutMs: number) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = await this.getJob(jobId, owner);
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return job;
      }
      await sleep(400);
    }
    throw new AppError(ERROR_CODES.CONVERSION_TIMEOUT, 'Synchronous conversion timed out');
  }

  async downloadOutput(outputStorageKey: string): Promise<Buffer> {
    return this.storage.download(outputStorageKey);
  }
}

export function parseOptions(raw: unknown): ConversionOptions {
  const parsed = conversionOptionsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Conversion options are invalid');
  }

  return {
    page: {
      size: normalizePageSizeName(parsed.data.page.size),
      custom: parsed.data.page.custom,
      orientation: parsed.data.page.orientation,
      margin: parsed.data.page.margin,
    },
    image: parsed.data.image,
    pdf: {
      pdfa: false,
      metadata: {
        ...parsed.data.pdf.metadata,
        ...(parsed.data.pdf.title ? { title: parsed.data.pdf.title } : {}),
      },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
