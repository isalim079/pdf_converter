import { describe, expect, it } from 'vitest';

import { ChromiumConverter } from '../src/modules/pdf/converters/chromium.converter.js';
import { ConverterResolver } from '../src/modules/pdf/converters/converter-resolver.js';
import { GotenbergConverter } from '../src/modules/pdf/converters/gotenberg.converter.js';
import { ImageConverter } from '../src/modules/pdf/converters/image.converter.js';
import type { ConversionInput } from '../src/modules/pdf/pdf.types.js';

const client = {
  convertOffice: async () => Buffer.from('%PDF-1.4'),
  convertHtml: async () => Buffer.from('%PDF-1.4'),
} as never;

const resolver = new ConverterResolver([
  new ImageConverter(),
  new ChromiumConverter(client),
  new GotenbergConverter(client),
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
