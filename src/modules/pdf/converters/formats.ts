import type { SupportedFormat } from '../pdf.types.js';

export const SUPPORTED_FORMATS: SupportedFormat[] = [
  {
    extension: '.jpg',
    mimeTypes: ['image/jpeg'],
    family: 'image',
    engine: 'image',
  },
  {
    extension: '.jpeg',
    mimeTypes: ['image/jpeg'],
    family: 'image',
    engine: 'image',
  },
  {
    extension: '.png',
    mimeTypes: ['image/png'],
    family: 'image',
    engine: 'image',
  },
  {
    extension: '.doc',
    mimeTypes: ['application/msword'],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.docx',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.docm',
    mimeTypes: ['application/vnd.ms-word.document.macroEnabled.12'],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.dot',
    mimeTypes: ['application/msword'],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.dotx',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    ],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.rtf',
    mimeTypes: ['application/rtf', 'text/rtf'],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.odt',
    mimeTypes: ['application/vnd.oasis.opendocument.text'],
    family: 'office',
    engine: 'gotenberg',
  },
  {
    extension: '.txt',
    mimeTypes: ['text/plain'],
    family: 'office',
    engine: 'gotenberg',
  },
];

export function findFormatByExtension(extension: string): SupportedFormat | undefined {
  return SUPPORTED_FORMATS.find((format) => format.extension === extension.toLowerCase());
}

export function findFormatByMime(mimeType: string): SupportedFormat | undefined {
  return SUPPORTED_FORMATS.find((format) => format.mimeTypes.includes(mimeType.toLowerCase()));
}
