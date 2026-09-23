import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import type { AppConfig } from '../../../app/config.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import type { ObjectStorage, StoredObject } from './storage.interface.js';

export class FileSystemStorage implements ObjectStorage {
  private readonly root: string;
  private readonly publicUrl: string;

  constructor(config: AppConfig) {
    this.root = resolve(config.STORAGE_FS_ROOT);
    this.publicUrl = config.PUBLIC_URL.replace(/\/$/, '');
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async upload(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    const payload = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, payload);
    return { key, size: payload.length, contentType };
  }

  async download(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      throw new AppError(ERROR_CODES.STORAGE_UPLOAD_FAILED, 'Object storage download failed', {
        cause: error,
      });
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch(() => undefined);
  }

  async createSignedUrl(key: string, _expiresSeconds: number): Promise<string> {
    return `${this.publicUrl}/v1/pdf/files/${encodeURIComponent(key)}`;
  }

  private resolveKey(key: string): string {
    if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Invalid storage key');
    }
    return join(this.root, key);
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
