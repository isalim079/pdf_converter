import { ulid } from 'ulid';

export function createConversionId(): string {
  return `pdf_${ulid()}`;
}

export function createRequestId(): string {
  return `req_${ulid()}`;
}
