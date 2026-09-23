import { describe, expect, it } from 'vitest';

import { ConverterResolver } from '../src/modules/pdf/converters/converter-resolver.js';
import { GotenbergConverter } from '../src/modules/pdf/converters/gotenberg.converter.js';
import { ImageConverter } from '../src/modules/pdf/converters/image.converter.js';
import type { ConversionInput } from '../src/modules/pdf/pdf.types.js';

const resolver = new ConverterResolver([
  new ImageConverter(),
  new GotenbergConverter({
    convertOffice: async () => Buffer.from('%PDF-1.4'),
  } as never),
]);

function input(extension: string, mimeType: string): ConversionInput {
  return {
    jobId: 'pdf_test',
    filePath: '/tmp/input',
    originalFilename: `file${extension}`,
    mimeType,
    extension,
    size: 10,
  };
}

describe('converter resolver', () => {
  it('routes images to ImageConverter', () => {
    expect(resolver.resolve(input('.jpg', 'image/jpeg')).engine).toBe('image');
    expect(resolver.resolve(input('.png', 'image/png')).engine).toBe('image');
  });

  it('routes office documents to Gotenberg', () => {
    expect(
      resolver.resolve(
        input('.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ).engine,
    ).toBe('gotenberg');
    expect(resolver.resolve(input('.txt', 'text/plain')).engine).toBe('gotenberg');
  });
});
