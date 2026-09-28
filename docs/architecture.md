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
   +-- office ---- host LibreOffice (soffice)
   +-- HTML ------ host Chrome/Chromium print-to-pdf
   |
PDF validation
   |
HTTP application/pdf
```

LibreOffice and Chromium run as host binaries. The API never calls Gotenberg HTTP and does not start Docker for conversion.

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

| Input | Engine | Host command |
| --- | --- | --- |
| JPG, JPEG, PNG, WebP | ImageConverter | — |
| DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, ODP, RTF, TXT, CSV, … | LibreOffice | `soffice --headless --convert-to pdf:*_pdf_Export:{JSON}` |
| HTML, HTM + optional flat assets | Chromium | `chrome --headless --print-to-pdf --no-pdf-header-footer` |

LibreOffice owns office layout. Chromium owns HTML/CSS. The API does not parse Word XML.

Office default `pageSize=auto` preserves the source page configuration when LibreOffice supports it. PDF export JSON embeds standard fonts, uses lossless image compression, quality 100, and does not reduce image resolution. Each LibreOffice job uses a unique `--env:UserInstallation` directory. Chromium print-to-pdf keeps backgrounds and CSS page size.

## Why there is no Prisma

Prisma and PostgreSQL existed to store async jobs, owners, and idempotency keys. This version converts in the request and returns the PDF immediately, so there is no job record to persist. Local temp folders replace object storage.

## Isolation

Untrusted files are converted by host binaries:

- unique LibreOffice user profile per request
- conversion timeout per request
- concurrent conversion cap
- temp directories deleted in `finally`
- no Docker socket
