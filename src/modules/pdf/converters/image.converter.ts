import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';

import { AppError } from '../../../common/errors/app-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import {
  applyOrientation,
  fitImageOnPage,
  pageSizeToPoints,
  resolveImageOrientation,
  resolveNamedPageSize,
  toPoints,
  type PageDimensions,
} from '../../../common/utils/page-sizes.js';
import { jobTempDir } from '../../../common/utils/temp-files.js';
import type { ConversionInput, ConversionOptions, ConversionResult } from '../pdf.types.js';
import type { PdfConverter } from './converter.interface.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

export class ImageConverter implements PdfConverter {
  readonly engine = 'image' as const;

  supports(input: ConversionInput): boolean {
    return IMAGE_EXTENSIONS.has(input.extension);
  }

  async convert(input: ConversionInput, options: ConversionOptions): Promise<ConversionResult> {
    const source = await readFile(input.filePath);
    const metadata = await sharp(source).metadata();

    if (!metadata.width || !metadata.height) {
      throw new AppError(ERROR_CODES.CONVERSION_FAILED, 'Image dimensions could not be read');
    }

    const needsRotate = Boolean(metadata.orientation && metadata.orientation !== 1);
    const isJpeg = input.extension === '.jpg' || input.extension === '.jpeg';

    let imageBytes = source;
    let imageWidth = metadata.width;
    let imageHeight = metadata.height;
    let embedAsJpeg = isJpeg && !needsRotate;

    if (needsRotate) {
      const rotated = sharp(source).rotate();
      const rotatedMeta = await rotated.metadata();
      imageBytes = Buffer.from(await rotated.jpeg({ quality: 90 }).toBuffer());
      imageWidth = rotatedMeta.width ?? metadata.width;
      imageHeight = rotatedMeta.height ?? metadata.height;
      embedAsJpeg = true;
    }

    const orientation = resolveImageOrientation(imageWidth, imageHeight, options.page.orientation);
    const page = resolveImagePage(options, imageWidth, imageHeight, orientation);
    const pagePoints = pageSizeToPoints(page);
    const imagePoints = {
      width: (imageWidth * 72) / options.image.dpi,
      height: (imageHeight * 72) / options.image.dpi,
    };

    const margin = {
      top: toPoints(options.page.margin.top, options.page.margin.unit),
      right: toPoints(options.page.margin.right, options.page.margin.unit),
      bottom: toPoints(options.page.margin.bottom, options.page.margin.unit),
      left: toPoints(options.page.margin.left, options.page.margin.unit),
    };

    const fitted = fitImageOnPage({
      pageWidth: pagePoints.width,
      pageHeight: pagePoints.height,
      imageWidth: imagePoints.width,
      imageHeight: imagePoints.height,
      fit: options.image.fit,
      margin,
    });

    const pdf = await PDFDocument.create();
    applyPdfMetadata(pdf, options);

    const pageRef = pdf.addPage([pagePoints.width, pagePoints.height]);
    pageRef.drawRectangle({
      x: 0,
      y: 0,
      width: pagePoints.width,
      height: pagePoints.height,
      color: rgb(1, 1, 1),
    });

    const embedded = embedAsJpeg
      ? await pdf.embedJpg(imageBytes)
      : await pdf.embedPng(imageBytes === source ? source : imageBytes);

    if (options.image.fit === 'cover') {
      pageRef.drawImage(embedded, {
        x: fitted.x,
        y: fitted.y,
        width: fitted.width,
        height: fitted.height,
      });
    } else {
      pageRef.drawImage(embedded, {
        x: fitted.x,
        y: fitted.y,
        width: fitted.width,
        height: fitted.height,
      });
    }

    const outputPath = join(jobTempDir(input.jobId), 'output.pdf');
    const bytes = await pdf.save();
    await writeFile(outputPath, bytes);

    return {
      outputPath,
      mimeType: 'application/pdf',
      size: bytes.length,
      pageCount: 1,
      engine: this.engine,
    };
  }
}

function resolveImagePage(
  options: ConversionOptions,
  imageWidth: number,
  imageHeight: number,
  orientation: 'portrait' | 'landscape',
): PageDimensions {
  if (options.image.fit === 'original' || options.page.size === 'AUTO') {
    return {
      width: (imageWidth * 25.4) / options.image.dpi,
      height: (imageHeight * 25.4) / options.image.dpi,
      unit: 'mm',
    };
  }

  if (options.page.size === 'CUSTOM') {
    if (!options.page.custom) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, 'Custom page size requires width and height');
    }
    return applyOrientation(options.page.custom, orientation);
  }

  return applyOrientation(resolveNamedPageSize(options.page.size), orientation);
}

function applyPdfMetadata(pdf: PDFDocument, options: ConversionOptions): void {
  const metadata = options.pdf.metadata;
  const title = options.pdf.metadata.title ?? undefined;
  if (title) {
    pdf.setTitle(title);
  }
  if (metadata.author) {
    pdf.setAuthor(metadata.author);
  }
  if (metadata.subject) {
    pdf.setSubject(metadata.subject);
  }
  if (metadata.keywords) {
    pdf.setKeywords(metadata.keywords.split(',').map((part) => part.trim()));
  }
  pdf.setCreator(metadata.creator ?? 'PDF Conversion Service');
  pdf.setProducer(metadata.producer ?? 'PDF Conversion Service');
}
