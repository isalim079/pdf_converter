import type { ConversionInput, ConversionOptions, ConversionResult } from '../pdf.types.js';

export interface PdfConverter {
  readonly engine: ConversionResult['engine'];
  supports(input: ConversionInput): boolean;
  convert(input: ConversionInput, options: ConversionOptions): Promise<ConversionResult>;
}
