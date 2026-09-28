import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getConfig } from '../../../app/config.js';
import { conversionTempDir } from '../../../common/utils/temp-files.js';
import type { GotenbergClient } from '../../../infrastructure/gotenberg/client.js';
import type { ConversionInput, ConversionOptions, ConversionResult } from '../pdf.types.js';
import type { PdfConverter } from './converter.interface.js';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

export class ChromiumConverter implements PdfConverter {
  readonly engine = 'chromium' as const;

  constructor(private readonly client: GotenbergClient) {}

  supports(input: ConversionInput): boolean {
    return HTML_EXTENSIONS.has(input.extension);
  }

  async convert(input: ConversionInput, options: ConversionOptions): Promise<ConversionResult> {
    const timeoutMs = getConfig().PDF_JOB_TIMEOUT_SECONDS * 1000;
    const pdf = await this.client.convertHtml({
      filePath: input.filePath,
      assets: input.assets,
      options,
      timeoutMs,
    });

    const outputPath = join(conversionTempDir(input.conversionId), 'output.pdf');
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
