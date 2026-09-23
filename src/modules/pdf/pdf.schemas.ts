import { z } from 'zod';

import { PAGE_SIZES } from '../../common/utils/page-sizes.js';

const metadataString = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value), {
    message: 'Metadata contains control characters',
  });

const namedPageSize = z.enum([
  'auto',
  'AUTO',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'LETTER',
  'LEGAL',
  'TABLOID',
  'CUSTOM',
]);

const customPageSize = z.object({
  width: z.number().positive().max(2000),
  height: z.number().positive().max(2000),
  unit: z.enum(['mm', 'in', 'pt']).default('mm'),
});

export const conversionOptionsSchema = z.object({
  page: z
    .object({
      size: namedPageSize.default('auto'),
      custom: customPageSize.optional(),
      orientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
      margin: z
        .object({
          top: z.number().min(0).max(100).default(0),
          right: z.number().min(0).max(100).default(0),
          bottom: z.number().min(0).max(100).default(0),
          left: z.number().min(0).max(100).default(0),
          unit: z.literal('mm').default('mm'),
        })
        .default({ top: 0, right: 0, bottom: 0, left: 0, unit: 'mm' }),
    })
    .default({
      size: 'auto',
      orientation: 'auto',
      margin: { top: 0, right: 0, bottom: 0, left: 0, unit: 'mm' },
    }),
  image: z
    .object({
      fit: z.enum(['contain', 'cover', 'original']).default('contain'),
      dpi: z.number().int().min(72).max(600).default(300),
    })
    .default({ fit: 'contain', dpi: 300 }),
  pdf: z
    .object({
      pdfa: z.literal(false).default(false),
      title: metadataString.optional(),
      metadata: z
        .object({
          title: metadataString.optional(),
          author: metadataString.optional(),
          subject: metadataString.optional(),
          keywords: metadataString.optional(),
          creator: metadataString.optional(),
          producer: metadataString.optional(),
        })
        .default({}),
    })
    .default({ pdfa: false, metadata: {} }),
});

export type ConversionOptionsInput = z.input<typeof conversionOptionsSchema>;

export function parsePageSizeField(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

export function normalizePageSizeName(
  size: z.infer<typeof namedPageSize>,
): 'AUTO' | keyof typeof PAGE_SIZES | 'CUSTOM' {
  if (size === 'auto' || size === 'AUTO') {
    return 'AUTO';
  }
  return size;
}
