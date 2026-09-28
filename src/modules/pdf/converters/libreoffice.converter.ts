import { stat } from 'node:fs/promises';

import { getConfig } from '../../../app/config.js';
import { conversionTempDir } from '../../../common/utils/temp-files.js';
import type { NativeEngines } from '../../../infrastructure/engines/native.js';
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
  '.xls',
  '.xlsx',
  '.xlsm',
  '.ods',
  '.csv',
  '.ppt',
  '.pptx',
  '.pptm',
  '.odp',
]);

export class LibreOfficeConverter implements PdfConverter {
  readonly engine = 'libreoffice' as const;

  constructor(private readonly engines: NativeEngines) {}

  supports(input: ConversionInput): boolean {
    return OFFICE_EXTENSIONS.has(input.extension);
  }

  async convert(input: ConversionInput, _options: ConversionOptions): Promise<ConversionResult> {
    const timeoutMs = getConfig().PDF_JOB_TIMEOUT_SECONDS * 1000;
    const outputPath = await this.engines.convertOffice({
      filePath: input.filePath,
      outputDir: conversionTempDir(input.conversionId),
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
