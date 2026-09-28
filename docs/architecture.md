# Architecture

The service converts common office documents, HTML, and images to PDF through one public endpoint. Conversion happens inside the request. There is no job table and no worker process.

## System overview

```text
Internet
   |
Node.js REST API
   |
validate + temp folder
   |
   +-- images ---- local ImageConverter
   +-- office ---- Gotenberg LibreOffice
   +-- HTML ------ Gotenberg Chromium
   |
PDF validation
   |
HTTP application/pdf
```

Gotenberg is private. Clients never call it directly.

## Request lifecycle

```text
multipart upload
  → validate filename, extension, MIME, magic bytes, size
  → write input (and HTML assets) under PDF_TEMP_DIR/<conversionId>/
  → convert with the matching engine
  → validate PDF header, parse, page count, size
  → return the PDF bytes
  → delete the temp folder in finally
```

## Conversion engines

| Input | Engine | Gotenberg route |
| --- | --- | --- |
| JPG, JPEG, PNG, WebP | ImageConverter | — |
| DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, ODP, RTF, TXT, CSV, … | LibreOffice | `/forms/libreoffice/convert` |
| HTML, HTM + optional flat assets | Chromium | `/forms/chromium/convert/html` |

LibreOffice owns office layout. Chromium owns HTML/CSS. The API does not parse Word XML.

Office default `pageSize=auto` preserves the source page configuration when LibreOffice supports it. HTML conversion always enables `printBackground` so CSS colors are not dropped. Images are never stretched.

## Why there is no Prisma

Prisma and PostgreSQL existed to store async jobs, owners, and idempotency keys. This version converts in the request and returns the PDF immediately, so there is no job record to persist. Local temp folders replace object storage.

## Isolation

Gotenberg processes untrusted files:

- internal Docker network, or `127.0.0.1` when `yarn start` spawns a local binary
- pinned image version, never `latest`
- CPU, memory, and conversion timeouts
- no host filesystem mounts except required temp paths
- no Docker socket
