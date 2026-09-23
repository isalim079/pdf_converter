import { describe, expect, it } from 'vitest';

import { parseOptions } from '../src/modules/pdf/pdf.service.js';

describe('conversion options', () => {
  it('defaults office page size to AUTO', () => {
    expect(parseOptions({}).page.size).toBe('AUTO');
    expect(parseOptions({}).image.fit).toBe('contain');
    expect(parseOptions({}).pdf.pdfa).toBe(false);
  });

  it('rejects PDF/A until it is supported', () => {
    expect(() => parseOptions({ pdf: { pdfa: true } })).toThrow();
  });

  it('rejects control characters in metadata', () => {
    expect(() =>
      parseOptions({
        pdf: { metadata: { title: 'Invoice\u0000#1' } },
      }),
    ).toThrow();
  });
});
