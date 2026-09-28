import { describe, expect, it } from 'vitest';

import { buildChromiumArgs } from '../src/infrastructure/engines/chromium.js';
import { buildLibreOfficeArgs, pdfExportFilter } from '../src/infrastructure/engines/libreoffice.js';

describe('LibreOffice PDF export flags', () => {
  it('embeds fonts and keeps lossless images for Word, Calc, and Impress', () => {
    expect(pdfExportFilter('.docx')).toContain('writer_pdf_Export');
    expect(pdfExportFilter('.xlsx')).toContain('calc_pdf_Export');
    expect(pdfExportFilter('.pptx')).toContain('impress_pdf_Export');
    expect(pdfExportFilter('.docx')).toContain('EmbedStandardFonts');
    expect(pdfExportFilter('.xlsx')).toContain('UseLosslessCompression');
    expect(pdfExportFilter('.pptx')).toContain('"Quality":{"type":"long","value":"100"}');
    expect(pdfExportFilter('.odt')).toContain('ReduceImageResolution');
  });

  it('uses a unique UserInstallation profile per conversion', () => {
    const args = buildLibreOfficeArgs({
      filePath: '/tmp/job/input.docx',
      outputDir: '/tmp/job',
      profileDir: '/tmp/job/lo-profile',
      extension: '.docx',
    });
    expect(args).toContain('--headless');
    expect(args.some((arg) => arg.startsWith('-env:UserInstallation='))).toBe(true);
    expect(args.some((arg) => arg.startsWith('--env:'))).toBe(false);
    expect(args).toContain('--convert-to');
    expect(args[args.indexOf('--convert-to') + 1]).toContain('writer_pdf_Export');
  });
});

describe('Chromium print-to-pdf flags', () => {
  it('prints to PDF without header/footer so CSS page size and backgrounds remain', () => {
    const args = buildChromiumArgs({
      htmlPath: '/tmp/job/input.html',
      outputPath: '/tmp/job/output.pdf',
    });
    expect(args).toContain('--headless=new');
    expect(args).toContain('--no-pdf-header-footer');
    expect(args.some((arg) => arg.startsWith('--print-to-pdf='))).toBe(true);
    expect(args.at(-1)).toMatch(/^file:/);
  });
});
