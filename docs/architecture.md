# Architecture

The service converts documents and images to PDF through a single public API. HTTP request handling and conversion never share a process.

## System overview

```text
                         Internet
                            |
                          Nginx
                            |
                     Node.js REST API
                            |
               Authentication / Validation
                            |
                       PostgreSQL
                            |
                       BullMQ Queue
                            |
                          Redis
                            |
                   PDF Conversion Worker
                            |
              +-------------+-------------+
              |                           |
       Office Documents                 Images
              |                           |
          Gotenberg                    img2pdf
              |                           |
         LibreOffice                       |
              +-------------+-------------+
                            |
                       PDF Validation
                            |
                     Object Storage
                    S3 / MinIO / etc.
                            |
                     Signed Download URL
```

CPU-heavy conversion runs in workers, not in the API process. The API accepts the upload, persists a job, and returns a job ID. Workers scale independently of HTTP capacity.

## Request lifecycle

```text
upload
  → authenticate
  → validate file and options
  → optional malware scan
  → persist job (PostgreSQL)
  → enqueue reference (BullMQ)
  → worker converts
  → validate PDF
  → store object
  → issue signed URL
  → delete temporary files
```

Job payloads contain storage keys and metadata only. Binary files never enter Redis.

## Conversion engines

Do not convert every format with one library. Route by type.

| Input | Engine |
| --- | --- |
| JPG, JPEG, PNG | img2pdf |
| DOC, DOCX, DOCM, DOT, DOTX, RTF, ODT | Gotenberg / LibreOffice |
| TXT | LibreOffice or a dedicated text-to-PDF path |
| HTML (planned) | Gotenberg Chromium |
| Markdown (planned) | Controlled render, then Gotenberg Chromium |

Gotenberg is a private conversion engine. It is not a public API. The Node.js service owns the external contract.

## Converter model

Every engine implements the same interface:

```ts
interface PdfConverter {
  supports(input: ConversionInput): boolean;
  convert(input: ConversionInput, options: ConversionOptions): Promise<ConversionResult>;
}
```

`ConverterResolver` selects the engine from MIME type and extension. Controllers do not contain routing logic.

Initial implementations:

- `GotenbergConverter` for office documents
- `ImageConverter` for raster images

### Office documents

LibreOffice owns layout. The service does not parse Word XML or reconstruct pages.

Default:

```text
pageSize = auto
```

`auto` preserves the source page configuration whenever LibreOffice supports it, including mixed sections:

```text
Section 1 → A4 portrait
Section 2 → A3 landscape
Section 3 → A4 portrait
```

An explicit override such as `{ "pageSize": "A4" }` is an intentional transformation, not the default.

### Images

Defaults:

```text
pageSize     = A4
orientation  = auto
fit          = contain
```

Images are never stretched. Supported fit modes are `contain`, `cover`, and `original`. Orientation may be `auto`, `portrait`, or `landscape`.

Custom page dimensions are allowed:

```json
{
  "pageSize": {
    "width": 210,
    "height": 297,
    "unit": "mm"
  }
}
```

`ImageConverter` validates the image, reads dimensions and EXIF orientation, resolves page geometry, generates the PDF, and validates the result. JPEG input should avoid unnecessary re-encoding.

## Page sizes

Supported sizes: `A0`–`A6`, `LETTER`, `LEGAL`, `TABLOID`, `CUSTOM`.

Dimensions live in one registry. Do not duplicate page measurements across the codebase.

## Queue

Queue name: `pdf-conversion`.

Payload example:

```json
{
  "jobId": "pdf_01JABC",
  "inputStorageKey": "uploads/pdf_01JABC/input.docx",
  "outputStorageKey": "pdf/pdf_01JABC/output.pdf",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "conversionEngine": "gotenberg",
  "options": {
    "pageSize": "auto",
    "orientation": "auto"
  }
}
```

Retries apply only to recoverable failures (Gotenberg unavailable, transient storage or network errors, worker restart). Permanent input errors — invalid DOCX, unsupported type, corrupt image, oversized file, password-protected documents when unsupported — use BullMQ's unrecoverable-error path.

Recommended starting policy: 3 attempts, exponential backoff.

LibreOffice conversions are expensive. Start at `PDF_WORKER_CONCURRENCY=2` and raise only after benchmarks show spare CPU and memory.

Job states:

```text
queued → processing ┬─ completed
                    ├─ retry (recoverable)
                    └─ failed (permanent)
```

A job must not remain in `processing` indefinitely. Recover stale jobs after worker crashes.

## Storage

Generated PDFs are not stored on the application container filesystem or in PostgreSQL.

```ts
interface ObjectStorage {
  upload(...): Promise<StoredObject>;
  download(...): Promise<Readable>;
  delete(...): Promise<void>;
  createSignedUrl(...): Promise<string>;
}
```

Production uses any S3-compatible store (AWS S3, Cloudflare R2, Wasabi, MinIO). Local development uses MinIO. The application depends on the interface, not a vendor SDK call site.

Uploads use generated keys such as `/tmp/pdf-service/<job-id>/`, never the client filename. After `upload → convert → store`, temporary files are deleted in a `finally` block. Startup cleanup removes abandoned directories.

## Data model

PostgreSQL is the source of truth for jobs. Prefer ULID identifiers.

```prisma
model PdfJob {
  id                String    @id
  status            PdfJobStatus

  originalFilename  String
  inputMimeType     String
  inputSize         BigInt
  inputStorageKey   String

  outputStorageKey  String?
  outputMimeType    String?
  outputSize        BigInt?
  pageCount         Int?

  conversionEngine  String?
  pageSize          String?
  orientation       String?
  options           Json?

  attempts          Int       @default(0)
  errorCode         String?
  errorMessage      String?

  createdAt         DateTime  @default(now())
  startedAt         DateTime?
  completedAt       DateTime?
  expiresAt         DateTime?

  @@index([status])
  @@index([createdAt])
  @@index([expiresAt])
}
```

Store object keys, not PDF bytes.

## PDF validation

A job is `completed` only after the output passes validation:

- file exists and is non-empty
- valid PDF header and parseable document
- `page count > 0` and within the configured maximum
- file size within the configured maximum

Optional: `qpdf --check` or an equivalent library. A corrupt PDF is a failed job, not a successful download.

## Isolation

Gotenberg processes untrusted files. Treat it as a security boundary:

- internal Docker network only, or `127.0.0.1` when `yarn start` spawns a local binary
- pinned image version, never `latest`
- CPU, memory, and conversion timeouts
- no host filesystem mounts except required temp/storage paths
- no Docker socket
- no debug routes in production
- review outbound-network / SSRF settings before go-live

Public traffic path: `Internet → Nginx → API`. Gotenberg, Redis, PostgreSQL, and MinIO stay private.
