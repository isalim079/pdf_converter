import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { AppConfig } from '../../../app/config.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import type { ObjectStorage, StoredObject } from './storage.interface.js';

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
    });
  }

  async ensureReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const code = (error as { name?: string; Code?: string }).name;
      if (code === 'NotFound' || code === 'NoSuchBucket' || code === '403' || code === '404') {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        return;
      }
      throw new AppError(
        ERROR_CODES.STORAGE_UPLOAD_FAILED,
        `Object storage is not reachable at the configured S3 endpoint. Start MinIO/S3 or set STORAGE_DRIVER=fs for local development.`,
        { retryable: true, cause: error },
      );
    }
  }

  async upload(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    try {
      const payload = body instanceof Readable ? await streamToBuffer(body) : body;
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: payload,
          ContentType: contentType,
        }),
      );
      return { key, size: payload.length, contentType };
    } catch (error) {
      throw new AppError(ERROR_CODES.STORAGE_UPLOAD_FAILED, 'Object storage upload failed', {
        retryable: true,
        cause: error,
      });
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!result.Body) {
        throw new Error('Empty object body');
      }
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      throw new AppError(ERROR_CODES.STORAGE_UPLOAD_FAILED, 'Object storage download failed', {
        retryable: true,
        cause: error,
      });
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async createSignedUrl(key: string, expiresSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresSeconds },
    );
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
