import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface ObjectStorage {
  ensureReady(): Promise<void>;
  upload(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  createSignedUrl(key: string, expiresSeconds: number): Promise<string>;
}
