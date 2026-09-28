import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { getConfig } from '../../app/config.js';

export function conversionTempDir(conversionId: string): string {
  return join(getConfig().PDF_TEMP_DIR, conversionId);
}

export async function createConversionTempDir(conversionId: string): Promise<string> {
  const dir = conversionTempDir(conversionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeConversionTempDir(conversionId: string): Promise<void> {
  await rm(conversionTempDir(conversionId), { recursive: true, force: true });
}

export async function cleanupAbandonedTempDirs(maxAgeMs: number): Promise<number> {
  const root = getConfig().PDF_TEMP_DIR;
  let removed = 0;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  const now = Date.now();
  for (const entry of entries) {
    if (entry.includes('..') || entry.includes('/') || entry.includes('\\')) {
      continue;
    }
    const full = join(root, entry);
    const info = await stat(full).catch(() => undefined);
    if (!info?.isDirectory()) {
      continue;
    }
    if (now - info.mtimeMs > maxAgeMs) {
      await rm(full, { recursive: true, force: true });
      removed += 1;
    }
  }

  return removed;
}
