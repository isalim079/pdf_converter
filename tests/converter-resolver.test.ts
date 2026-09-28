import { describe, expect, it } from 'vitest';

import { ChromiumConverter } from '../src/modules/pdf/converters/chromium.converter.js';
import { ConverterResolver } from '../src/modules/pdf/converters/converter-resolver.js';
import { ImageConverter } from '../src/modules/pdf/converters/image.converter.js';
import { LibreOfficeConverter } from '../src/modules/pdf/converters/libreoffice.converter.js';
import type { ConversionInput } from '../src/modules/pdf/pdf.types.js';

const engines = {
  convertOffice: async () => '/tmp/output.pdf',
  convertHtml: async () => '/tmp/output.pdf',
  libreofficeBin: () => '/mock/soffice',
  chromiumBin: () => '/mock/chrome',
};

const resolver = new ConverterResolver([
  new ImageConverter(),
  new ChromiumConverter(engines),
  new LibreOfficeConverter(engines),
]);

function input(extension: string, mimeType: string): ConversionInput {
  return {
    conversionId: 'pdf_test',
    filePath: '/tmp/input',
    originalFilename: `file${extension}`,
    mimeType,
    extension,
    size: 10,
    assets: [],
  };
}

describe('converter resolver', () => {
  it('routes images to ImageConverter', () => {
    expect(resolver.resolve(input('.jpg', 'image/jpeg')).engine).toBe('image');
    expect(resolver.resolve(input('.png', 'image/png')).engine).toBe('image');
    expect(resolver.resolve(input('.webp', 'image/webp')).engine).toBe('image');
  });

  it('routes office documents to LibreOffice', () => {
    expect(
      resolver.resolve(
        input('.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ).engine,
    ).toBe('libreoffice');
    expect(
      resolver.resolve(
        input('.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ).engine,
    ).toBe('libreoffice');
    expect(
      resolver.resolve(
        input('.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      ).engine,
    ).toBe('libreoffice');
    expect(resolver.resolve(input('.txt', 'text/plain')).engine).toBe('libreoffice');
  });

  it('routes HTML to Chromium', () => {
    expect(resolver.resolve(input('.html', 'text/html')).engine).toBe('chromium');
    expect(resolver.resolve(input('.htm', 'text/html')).engine).toBe('chromium');
  });
});
