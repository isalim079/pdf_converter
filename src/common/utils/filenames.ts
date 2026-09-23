const SAFE_FILENAME = /[^\w.\- ()[\]]+/g;

export function sanitizeFilename(original: string): string {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? 'upload';
  const cleaned = base.replace(SAFE_FILENAME, '_').replace(/^\.+/, '').slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'upload';
}

export function extensionOf(filename: string): string {
  const base = sanitizeFilename(filename);
  const index = base.lastIndexOf('.');
  if (index <= 0 || index === base.length - 1) {
    return '';
  }
  return base.slice(index).toLowerCase();
}

export function isPathTraversal(filename: string): boolean {
  return filename.includes('..') || filename.includes('\0') || /[/\\]/.test(filename);
}
