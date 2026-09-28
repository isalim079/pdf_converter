import { describe, expect, it } from 'vitest';

import { resolvePdfTempDir } from '../src/app/config.js';
import { LIBREOFFICE_CANDIDATES } from '../src/infrastructure/engines/detect.js';
import { buildChromiumArgs } from '../src/infrastructure/engines/chromium.js';
import {
  buildLibreOfficeArgs,
  libreOfficePathForCli,
  pdfExportFilter,
} from '../src/infrastructure/engines/libreoffice.js';

describe('LibreOffice PDF export flags', () => {
  it('embeds fonts and keeps lossless images for Word, Calc, and Impress', () => {
    expect(pdfExportFilter('.docx', 'darwin')).toContain('writer_pdf_Export');
    expect(pdfExportFilter('.xlsx', 'linux')).toContain('calc_pdf_Export');
    expect(pdfExportFilter('.pptx', 'darwin')).toContain('impress_pdf_Export');
    expect(pdfExportFilter('.docx', 'darwin')).toContain('EmbedStandardFonts');
    expect(pdfExportFilter('.xlsx', 'linux')).toContain('UseLosslessCompression');
    expect(pdfExportFilter('.pptx', 'darwin')).toContain('"Quality":{"type":"long","value":"100"}');
    expect(pdfExportFilter('.odt', 'linux')).toContain('ReduceImageResolution');
  });

  it('omits JSON convert-to options on Windows so colons do not break the source path', () => {
    expect(pdfExportFilter('.docx', 'win32')).toBe('pdf:writer_pdf_Export');
    expect(pdfExportFilter('.xlsx', 'win32')).toBe('pdf:calc_pdf_Export');
    expect(pdfExportFilter('.pptx', 'win32')).not.toContain('{');
  });

  it('uses a unique UserInstallation profile per conversion', () => {
    const args = buildLibreOfficeArgs({
      filePath: '/tmp/job/input.docx',
      outputDir: '/tmp/job',
      profileDir: '/tmp/job/lo-profile',
      extension: '.docx',
      platform: 'darwin',
    });
    expect(args).toContain('--headless');
    expect(args.some((arg) => arg.startsWith('-env:UserInstallation='))).toBe(true);
    expect(args.some((arg) => arg.startsWith('--env:'))).toBe(false);
    expect(args).toContain('--convert-to');
    expect(args[args.indexOf('--convert-to') + 1]).toContain('writer_pdf_Export');
  });

  it('passes Windows paths with forward slashes and no JSON filter', () => {
    const args = buildLibreOfficeArgs({
      filePath: 'C:\\tmp\\job\\input.doc',
      outputDir: 'C:\\tmp\\job',
      profileDir: 'C:\\tmp\\job\\lo-profile',
      extension: '.doc',
      platform: 'win32',
    });
    expect(libreOfficePathForCli('C:\\tmp\\job\\input.doc', 'win32')).toContain('/');
    expect(args[args.indexOf('--convert-to') + 1]).toBe('pdf:writer_pdf_Export');
    expect(args.at(-1)).not.toContain('\\');
    expect(args[args.indexOf('--outdir') + 1]).not.toContain('\\');
  });
});

describe('LibreOffice Windows binary candidates', () => {
  it('prefers soffice.com over soffice.exe', () => {
    const com = LIBREOFFICE_CANDIDATES.findIndex((path) => path.endsWith('soffice.com'));
    const exe = LIBREOFFICE_CANDIDATES.findIndex((path) => path.endsWith('soffice.exe'));
    expect(com).toBeGreaterThanOrEqual(0);
    expect(exe).toBeGreaterThan(com);
  });
});

describe('PDF temp dir', () => {
  it('replaces a Unix /tmp path on Windows', () => {
    const resolved = resolvePdfTempDir('/tmp/pdf-service', 'win32');
    expect(resolved).not.toMatch(/^\/tmp/);
    expect(resolved.toLowerCase()).toContain('pdf-service');
  });

  it('keeps /tmp on Unix', () => {
    expect(resolvePdfTempDir('/tmp/pdf-service', 'linux')).toBe('/tmp/pdf-service');
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
