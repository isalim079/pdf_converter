import { describe, expect, it } from 'vitest';

import { extensionOf, isPathTraversal, sanitizeFilename } from '../src/common/utils/filenames.js';

describe('filenames', () => {
  it('strips path components from uploaded names', () => {
    expect(sanitizeFilename('../../etc/passwd.docx')).toBe('passwd.docx');
    expect(sanitizeFilename('C:\\\\Windows\\\\invoice.docx')).toBe('invoice.docx');
  });

  it('detects traversal attempts', () => {
    expect(isPathTraversal('../secret')).toBe(true);
    expect(isPathTraversal('ok.docx')).toBe(false);
  });

  it('reads extensions from the sanitized name', () => {
    expect(extensionOf('invoice.DOCX')).toBe('.docx');
  });
});
