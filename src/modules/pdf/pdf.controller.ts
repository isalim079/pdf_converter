import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';

import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { parsePageSizeField } from './pdf.schemas.js';
import type { PdfService } from './pdf.service.js';

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
  const parts = request.parts();
  let file: { filename: string; mimetype: string; buffer: Buffer } | undefined;
  const assets: Array<{ originalFilename: string; buffer: Buffer }> = [];
  const fields: Record<string, MultipartValue> = {};

  for await (const part of parts) {
    if (part.type === 'file') {
      if (!isMultipartFile(part)) {
        continue;
      }
      const buffer = await part.toBuffer();
      if (part.fieldname === 'assets') {
        assets.push({ originalFilename: part.filename, buffer });
        continue;
      }
      if (!file && (part.fieldname === 'file' || part.fieldname === 'files')) {
        file = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer,
        };
        continue;
      }
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Only one primary file is allowed');
    }

    fields[part.fieldname] = part as unknown as MultipartValue;
  }

  if (!file) {
    throw new AppError(ERROR_CODES.FILE_REQUIRED, 'A file is required');
  }

  const optionsField = fieldString(fields.options);
  let rawOptions: unknown = {};
  if (optionsField) {
    try {
      rawOptions = JSON.parse(optionsField);
    } catch {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'options must be valid JSON');
    }
  } else {
    const pageSize = fieldString(fields.pageSize);
    const orientation = fieldString(fields.orientation);
    const fit = fieldString(fields.fit);
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
    buffer: file.buffer,
    rawOptions,
    assets,
  };
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replaceAll('"', '');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function createPdfController(service: PdfService) {
  return {
    async convert(request: FastifyRequest, reply: FastifyReply) {
      const payload = await readConvertRequest(request);
      const result = await service.convert({
        originalFilename: payload.originalFilename,
        declaredMimeType: payload.declaredMimeType,
        buffer: payload.buffer,
        rawOptions: payload.rawOptions,
        assets: payload.assets,
        requestId: request.requestId,
      });

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', contentDisposition(result.filename))
        .header('X-Page-Count', String(result.pageCount))
        .header('X-Conversion-Engine', result.engine)
        .send(result.pdf);
    },
  };
}
