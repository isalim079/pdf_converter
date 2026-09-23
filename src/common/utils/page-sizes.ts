export type PageSizeName =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'LETTER'
  | 'LEGAL'
  | 'TABLOID'
  | 'CUSTOM'
  | 'AUTO';

export type LengthUnit = 'mm' | 'in' | 'pt';

export interface PageDimensions {
  width: number;
  height: number;
  unit: LengthUnit;
}

export const PAGE_SIZES: Record<Exclude<PageSizeName, 'CUSTOM' | 'AUTO'>, PageDimensions> = {
  A0: { width: 841, height: 1189, unit: 'mm' },
  A1: { width: 594, height: 841, unit: 'mm' },
  A2: { width: 420, height: 594, unit: 'mm' },
  A3: { width: 297, height: 420, unit: 'mm' },
  A4: { width: 210, height: 297, unit: 'mm' },
  A5: { width: 148, height: 210, unit: 'mm' },
  A6: { width: 105, height: 148, unit: 'mm' },
  LETTER: { width: 215.9, height: 279.4, unit: 'mm' },
  LEGAL: { width: 215.9, height: 355.6, unit: 'mm' },
  TABLOID: { width: 279.4, height: 431.8, unit: 'mm' },
};

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

export function toPoints(value: number, unit: LengthUnit): number {
  if (unit === 'pt') {
    return value;
  }
  if (unit === 'in') {
    return value * PT_PER_INCH;
  }
  return (value / MM_PER_INCH) * PT_PER_INCH;
}

export function pageSizeToPoints(size: PageDimensions): { width: number; height: number } {
  return {
    width: toPoints(size.width, size.unit),
    height: toPoints(size.height, size.unit),
  };
}

export function resolveNamedPageSize(name: Exclude<PageSizeName, 'CUSTOM' | 'AUTO'>): PageDimensions {
  return PAGE_SIZES[name];
}

export function applyOrientation(
  size: PageDimensions,
  orientation: 'portrait' | 'landscape',
): PageDimensions {
  const points = pageSizeToPoints(size);
  const isLandscape = points.width > points.height;
  if (orientation === 'landscape' && !isLandscape) {
    return { width: size.height, height: size.width, unit: size.unit };
  }
  if (orientation === 'portrait' && isLandscape) {
    return { width: size.height, height: size.width, unit: size.unit };
  }
  return size;
}

export interface ImageFitResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitImageOnPage(input: {
  pageWidth: number;
  pageHeight: number;
  imageWidth: number;
  imageHeight: number;
  fit: 'contain' | 'cover' | 'original';
  margin?: { top: number; right: number; bottom: number; left: number };
}): ImageFitResult {
  const margin = input.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const availWidth = Math.max(1, input.pageWidth - margin.left - margin.right);
  const availHeight = Math.max(1, input.pageHeight - margin.top - margin.bottom);

  if (input.fit === 'original') {
    return {
      x: margin.left + (availWidth - input.imageWidth) / 2,
      y: margin.bottom + (availHeight - input.imageHeight) / 2,
      width: input.imageWidth,
      height: input.imageHeight,
    };
  }

  const scale =
    input.fit === 'cover'
      ? Math.max(availWidth / input.imageWidth, availHeight / input.imageHeight)
      : Math.min(availWidth / input.imageWidth, availHeight / input.imageHeight);

  const width = input.imageWidth * scale;
  const height = input.imageHeight * scale;

  return {
    x: margin.left + (availWidth - width) / 2,
    y: margin.bottom + (availHeight - height) / 2,
    width,
    height,
  };
}

export function resolveImageOrientation(
  imageWidth: number,
  imageHeight: number,
  orientation: 'auto' | 'portrait' | 'landscape',
): 'portrait' | 'landscape' {
  if (orientation !== 'auto') {
    return orientation;
  }
  return imageWidth >= imageHeight ? 'landscape' : 'portrait';
}
