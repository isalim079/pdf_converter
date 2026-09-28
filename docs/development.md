# Development

## Prerequisites

- Node.js 24 LTS
- Yarn (or the repository package manager, once locked)
- Docker and Docker Compose, **or** a Linux host installed with `scripts/install-linux.sh`

## Local setup

```bash
yarn install
yarn dev
```

`yarn dev` runs ensure (Postgres/Redis/Gotenberg as needed) then starts the API and the worker. Use `yarn dev:api` / `yarn dev:worker` only when you need a single process. Set `PDF_ENSURE_SKIP=1` to skip probes.

Confirm PostgreSQL, Redis, Gotenberg, MinIO, the API, and the worker are healthy, then:

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -F "file=@./fixtures/documents/basic.docx"
```

```bash
curl http://localhost:3050/v1/pdf/jobs/<JOB_ID>
```

After each significant change:

```bash
yarn typecheck
yarn lint
yarn test
docker compose config
```

Build and start the stack when the change touches images or compose.

## Project structure

Adapt names to existing repository conventions. Do not invent a second Redis client, Prisma client, or configuration system.

```text
src/
├── app/
│   ├── server.ts
│   ├── config.ts
│   └── plugins/
├── modules/
│   └── pdf/
│       ├── pdf.controller.ts
│       ├── pdf.service.ts
│       ├── pdf.routes.ts
│       ├── pdf.schemas.ts
│       ├── pdf.types.ts
│       ├── converters/
│       ├── queue/
│       ├── storage/
│       ├── validation/
│       └── cleanup/
├── infrastructure/
│   ├── postgres/
│   ├── redis/
│   ├── gotenberg/
│   ├── storage/
│   └── logging/
├── common/
│   ├── errors/
│   ├── middleware/
│   └── utils/
├── start.ts
├── main.ts
└── worker.ts
```

## Quality bar

- TypeScript strict mode
- Small modules and typed interfaces
- Centralized configuration, errors, and page-size registry
- No magic constants, no duplicated conversion logic
- No `any` unless justified
- No silent `catch` blocks
- No shell-command concatenation
- Prefer explicit code over a framework-inside-the-service

Reuse existing Redis, BullMQ, Prisma, PostgreSQL, Nginx, logging, authentication, and storage when they already exist.

## Testing

### Unit

File-type resolver, page-size resolver, image fitting, orientation, request validation, error mapping, converter selection, storage, cleanup.

### Integration

API → Redis → worker; worker → Gotenberg; worker → storage; worker → PostgreSQL.

### End-to-end

Real fixtures under `fixtures/`:

```text
fixtures/
  images/
    portrait.jpg
    landscape.jpg
    square.png
  documents/
    basic.docx
    multipage.docx
    tables.docx
    header-footer.docx
    landscape.docx
    mixed-sections.docx
    unicode.docx
```

Required document cases include A4/Letter/A3, landscape and portrait, mixed section sizes, headers, footers, tables, images, Unicode, Bengali, mixed Bengali/English, empty documents, corrupt DOCX, password-protected documents, and very large files.

HTTP 200 is not sufficient. Inspect the generated PDF.

### Visual regression

```text
source document → PDF → render pages to PNG → compare to approved reference
```

Store references under `tests/visual/`. Use a tolerance; rendering engines introduce harmless differences.

### Performance and security

See [Operations](./operations.md#performance-baseline) and [Security](./security.md#security-test-coverage).

Do not hide failing tests or weaken assertions to force a pass.

## Implementation order

Implement incrementally. Do not land the entire system in one change.

1. Project structure and configuration
2. File validation
3. Database and Prisma
4. BullMQ queue
5. Gotenberg integration
6. Image conversion
7. PDF validation
8. Object storage
9. API endpoints
10. Authentication and authorization
11. Cleanup
12. Observability
13. Tests
14. Production Docker
15. Security hardening

Inspect `package.json`, `tsconfig`, Docker files, Prisma schema, Redis/BullMQ, logging, API conventions, and environment configuration before changing them.

When a requirement is ambiguous, choose the simplest production-safe default that preserves this architecture.

## First production milestone

Stabilize this set before adding formats:

```text
JPG, JPEG, PNG, DOC, DOCX
```

with async conversion, BullMQ, Redis, Gotenberg, LibreOffice, img2pdf, PostgreSQL, S3/MinIO, authentication, rate limiting, PDF validation, health checks, structured logging, Docker, and automated tests.

## Out of scope for v1

Keep the architecture open for these, but do not build them unless explicitly required:

```text
PDF merge / split / compression
password protection / encryption
PDF/A / PDF/UA
watermarks, page numbers, headers/footers
OCR
HTML / Markdown / email-to-PDF
batch conversion, webhooks
quotas, billing, multi-tenant analytics
```

## Definition of done

A DOCX (and the other supported types) can be uploaded, validated, queued, converted, validated as PDF, stored privately, completed, downloaded via a signed URL, and cleaned up. The implementation is not complete until the [acceptance checklist](../README.md#acceptance-criteria) is satisfied.

A change is not finished if typecheck, lint, tests, or compose validation fail.
