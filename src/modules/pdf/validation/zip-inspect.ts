import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

const MAX_ZIP_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

interface ZipEntry {
  name: string;
  uncompressedSize: number;
}

export function inspectZip(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Archive is too small to be a valid ZIP');
  }

  const eocd = findEocd(buffer);
  const entryCount = eocd.totalEntries;
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Archive contains too many entries');
  }

  const entries: ZipEntry[] = [];
  let offset = eocd.centralDirectoryOffset;
  let uncompressed = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Archive central directory is corrupt');
    }

    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    uncompressed += uncompressedSize;
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Archive uncompressed size exceeds limit');
    }

    entries.push({ name, uncompressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEocd(buffer: Buffer): { totalEntries: number; centralDirectoryOffset: number } {
  const maxComment = 0xffff;
  const start = Math.max(0, buffer.length - 22 - maxComment);

  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      return {
        totalEntries: buffer.readUInt16LE(i + 10),
        centralDirectoryOffset: buffer.readUInt32LE(i + 16),
      };
    }
  }

  throw new AppError(ERROR_CODES.INVALID_FILE_SIGNATURE, 'Archive is missing a ZIP end record');
}
