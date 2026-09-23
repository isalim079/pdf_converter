import { ulid } from 'ulid';

export function createJobId(): string {
  return `pdf_${ulid()}`;
}

export function createRequestId(): string {
  return `req_${ulid()}`;
}
