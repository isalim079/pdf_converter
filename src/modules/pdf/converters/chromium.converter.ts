import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import { getConfig } from '../../../app/config.js';
import { conversionTempDir } from '../../../common/utils/temp-files.js';
import type { NativeEngines } from '../../../infrastructure/engines/native.js';
import type { ConversionInput, ConversionOptions, ConversionResult } from '../pdf.types.js';
import type { PdfConverter } from './converter.interface.js';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

export class ChromiumConverter implements PdfConverter {
  readonly engine = 'chromium' as const;

  constructor(private readonly engines: NativeEngines) {}

  supports(input: ConversionInput): boolean {
    return HTML_EXTENSIONS.has(input.extension);
  }

  async convert(input: ConversionInput, _options: ConversionOptions): Promise<ConversionResult> {
    const timeoutMs = getConfig().PDF_JOB_TIMEOUT_SECONDS * 1000;
    const outputPath = join(conversionTempDir(input.conversionId), 'output.pdf');
    await this.engines.convertHtml({
      htmlPath: input.filePath,
      outputPath,
      timeoutMs,
    });
    const size = (await stat(outputPath)).size;

    return {
      outputPath,
      mimeType: 'application/pdf',
      size,
      pageCount: 0,
      engine: this.engine,
    };
  }
}
