import { describe, expect, it } from 'vitest';

import {
  applyOrientation,
  fitImageOnPage,
  PAGE_SIZES,
  pageSizeToPoints,
  resolveImageOrientation,
} from '../src/common/utils/page-sizes.js';

describe('page sizes', () => {
  it('keeps a single registry for standard sizes', () => {
    expect(PAGE_SIZES.A4).toEqual({ width: 210, height: 297, unit: 'mm' });
    expect(PAGE_SIZES.LETTER.width).toBeCloseTo(215.9);
  });

  it('swaps dimensions for landscape', () => {
    const landscape = applyOrientation(PAGE_SIZES.A4, 'landscape');
    expect(landscape.width).toBe(297);
    expect(landscape.height).toBe(210);
  });

  it('detects image orientation from aspect ratio', () => {
    expect(resolveImageOrientation(800, 600, 'auto')).toBe('landscape');
    expect(resolveImageOrientation(600, 800, 'auto')).toBe('portrait');
    expect(resolveImageOrientation(800, 600, 'portrait')).toBe('portrait');
  });

  it('contains an image without stretching', () => {
    const page = pageSizeToPoints(PAGE_SIZES.A4);
    const fit = fitImageOnPage({
      pageWidth: page.width,
      pageHeight: page.height,
      imageWidth: 400,
      imageHeight: 100,
      fit: 'contain',
    });

    expect(fit.width / fit.height).toBeCloseTo(4);
    expect(fit.width).toBeLessThanOrEqual(page.width + 0.01);
    expect(fit.height).toBeLessThanOrEqual(page.height + 0.01);
  });

  it('covers the page while preserving aspect ratio', () => {
    const fit = fitImageOnPage({
      pageWidth: 200,
      pageHeight: 200,
      imageWidth: 400,
      imageHeight: 100,
      fit: 'cover',
    });

    expect(fit.width / fit.height).toBeCloseTo(4);
    expect(fit.height).toBeGreaterThanOrEqual(200);
  });
});
