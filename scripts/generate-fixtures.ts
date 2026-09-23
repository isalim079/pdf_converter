import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMinimalDocx, JPEG_1X1, PNG_1X1 } from '../tests/helpers/zip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

await mkdir(join(root, 'images'), { recursive: true });
await mkdir(join(root, 'documents'), { recursive: true });
await writeFile(join(root, 'images', 'square.png'), PNG_1X1);
await writeFile(join(root, 'images', 'portrait.jpg'), JPEG_1X1);
await writeFile(join(root, 'images', 'landscape.jpg'), JPEG_1X1);
await writeFile(join(root, 'documents', 'basic.docx'), createMinimalDocx());

console.log('Wrote fixtures to', root);
