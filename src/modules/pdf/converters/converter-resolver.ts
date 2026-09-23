import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import type { ConversionInput } from '../pdf.types.js';
import type { PdfConverter } from './converter.interface.js';

export class ConverterResolver {
  constructor(private readonly converters: PdfConverter[]) {}

  resolve(input: ConversionInput): PdfConverter {
    const converter = this.converters.find((item) => item.supports(input));
    if (!converter) {
      throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'No converter is registered for this file type');
    }
    return converter;
  }
}
