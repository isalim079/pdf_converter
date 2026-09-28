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
    extension: '.webp',
    mimeTypes: ['image/webp'],
    family: 'image',
    engine: 'image',
  },
  {
    extension: '.doc',
    mimeTypes: ['application/msword'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.docm',
    mimeTypes: ['application/vnd.ms-word.document.macroEnabled.12'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.dot',
    mimeTypes: ['application/msword'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.dotx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.template'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.rtf',
    mimeTypes: ['application/rtf', 'text/rtf'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.odt',
    mimeTypes: ['application/vnd.oasis.opendocument.text'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.txt',
    mimeTypes: ['text/plain'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.xls',
    mimeTypes: ['application/vnd.ms-excel'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.xlsx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.xlsm',
    mimeTypes: ['application/vnd.ms-excel.sheet.macroEnabled.12'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.ods',
    mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.csv',
    mimeTypes: ['text/csv', 'application/csv', 'text/plain'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.ppt',
    mimeTypes: ['application/vnd.ms-powerpoint'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.pptx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.pptm',
    mimeTypes: ['application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.odp',
    mimeTypes: ['application/vnd.oasis.opendocument.presentation'],
    family: 'office',
    engine: 'libreoffice',
  },
  {
    extension: '.html',
    mimeTypes: ['text/html'],
    family: 'html',
    engine: 'chromium',
  },
  {
    extension: '.htm',
    mimeTypes: ['text/html'],
    family: 'html',
    engine: 'chromium',
  },
];

export function findFormatByExtension(extension: string): SupportedFormat | undefined {
  return SUPPORTED_FORMATS.find((format) => format.extension === extension.toLowerCase());
}

export function findFormatByMime(mimeType: string): SupportedFormat | undefined {
  return SUPPORTED_FORMATS.find((format) => format.mimeTypes.includes(mimeType.toLowerCase()));
}
