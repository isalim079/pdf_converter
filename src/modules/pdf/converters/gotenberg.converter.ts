import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getConfig } from '../../../app/config.js';
import { jobTempDir } from '../../../common/utils/temp-files.js';
import type { GotenbergClient } from '../../../infrastructure/gotenberg/client.js';
import type { ConversionInput, ConversionOptions, ConversionResult } from '../pdf.types.js';
import type { PdfConverter } from './converter.interface.js';

const OFFICE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.docm',
  '.dot',
  '.dotx',
  '.rtf',
  '.odt',
  '.txt',
]);

export class GotenbergConverter implements PdfConverter {
  readonly engine = 'gotenberg' as const;

  constructor(private readonly client: GotenbergClient) {}

  supports(input: ConversionInput): boolean {
    return OFFICE_EXTENSIONS.has(input.extension);
  }

  async convert(input: ConversionInput, options: ConversionOptions): Promise<ConversionResult> {
    const timeoutMs = getConfig().PDF_JOB_TIMEOUT_SECONDS * 1000;
    const pdf = await this.client.convertOffice({
      filePath: input.filePath,
      filename: `${input.jobId}${input.extension}`,
      options,
      timeoutMs,
    });

    const outputPath = join(jobTempDir(input.jobId), 'output.pdf');
    await writeFile(outputPath, pdf);

    return {
      outputPath,
      mimeType: 'application/pdf',
      size: pdf.length,
      pageCount: 0,
      engine: this.engine,
    };
  }
}
