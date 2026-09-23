import type { PageDimensions, PageSizeName } from '../../common/utils/page-sizes.js';

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type ConversionFamily = 'image' | 'office';

export type ConversionEngine = 'image' | 'gotenberg';

export type ImageFit = 'contain' | 'cover' | 'original';

export type Orientation = 'auto' | 'portrait' | 'landscape';

export interface PageMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
  unit: 'mm';
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
}

export interface ConversionOptions {
  page: {
    size: PageSizeName;
    custom?: PageDimensions;
    orientation: Orientation;
    margin: PageMargin;
  };
  image: {
    fit: ImageFit;
    dpi: number;
  };
  pdf: {
    pdfa: false;
    metadata: PdfMetadata;
  };
}

export interface ConversionInput {
  jobId: string;
  filePath: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  size: number;
}

export interface ConversionResult {
  outputPath: string;
  mimeType: 'application/pdf';
  size: number;
  pageCount: number;
  engine: ConversionEngine;
}

export interface AuthOwner {
  ownerId: string;
  apiKeyId: string;
}

export interface PdfQueuePayload {
  jobId: string;
  ownerId: string;
  inputStorageKey: string;
  outputStorageKey: string;
  mimeType: string;
  extension: string;
  originalFilename: string;
  conversionEngine: ConversionEngine;
  options: ConversionOptions;
}

export interface SupportedFormat {
  extension: string;
  mimeTypes: string[];
  family: ConversionFamily;
  engine: ConversionEngine;
}
