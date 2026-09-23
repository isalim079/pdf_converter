# PDF Conversion Service

Production document-to-PDF microservice. Clients upload a common office document or image; the service returns a validated PDF through a short-lived signed URL.

Conversion runs off the HTTP process. The API authenticates, validates, and enqueues. Workers convert, validate, store, and clean up.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Supported formats](#supported-formats)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [Security](#security)
- [Operations](#operations)
- [Development](#development)
- [Acceptance criteria](#acceptance-criteria)
- [Documentation](#documentation)

## Features

- Unified `/v1` API for office documents and images
- Asynchronous conversion by default (BullMQ + Redis)
- Layout-preserving office conversion via Gotenberg / LibreOffice
- Image-to-PDF via img2pdf with aspect-ratio-safe fitting
- Magic-byte file validation and optional malware scanning
- Private object storage with signed download URLs
- Owner-scoped jobs, idempotency keys, and rate limits
- Structured logs, metrics, liveness, and readiness probes
- Horizontal worker scaling independent of the API

## Architecture

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

Only Nginx and the API are public. Gotenberg, Redis, PostgreSQL, and object storage stay on the private network.

Full design: [docs/architecture.md](docs/architecture.md).

## Supported formats

| Family | Extensions | Engine | Default page size |
| --- | --- | --- | --- |
| Images | `.jpg` `.jpeg` `.png` | img2pdf | A4, `contain`, orientation `auto` |
| Office | `.doc` `.docx` `.docm` `.dot` `.dotx` `.rtf` `.odt` | Gotenberg / LibreOffice | `auto` (preserve source) |
| Text | `.txt` | LibreOffice or dedicated text path | engine default |

Planned, not in the first milestone: `.html`, `.htm`, `.md`.

Office `pageSize=auto` keeps the source section configuration (including mixed A4/A3 and portrait/landscape). Forcing A4 is an explicit override. Images are never stretched.

Bengali and mixed Bengali/English rendering is a first-class requirement. Fonts are installed in the Gotenberg image, not taken from the host.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS, TypeScript (strict) |
| API | Fastify, Zod, OpenAPI |
| Data | PostgreSQL, Prisma |
| Queue | BullMQ, Redis |
| Conversion | Gotenberg + LibreOffice, img2pdf |
| PDF checks | qpdf / pdfinfo or an equivalent library |
| Storage | S3-compatible (MinIO locally) |
| Auth | API key or JWT / OAuth2 |
| Observability | Pino, Prometheus-style metrics |
| Tests | Vitest, Fastify inject / Supertest |
| Runtime | Docker, Nginx |

Pin every dependency and container tag. Use a lockfile. Do not ship `latest` images.

## Quick start

```bash
cp .env.example .env
yarn infra
yarn install
yarn prisma:migrate
yarn dev
yarn dev:worker
```

`yarn infra` starts Postgres, Redis, MinIO, and Gotenberg via Docker when the daemon is running. If Docker is not installed, it starts local Postgres and Redis instead and uses filesystem storage (`STORAGE_DRIVER=fs`).

Local API keys are defined in `API_KEYS` as `key:ownerId:keyId`. The example key is `dev-local-key`.

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -H "Authorization: Bearer dev-local-key" \
  -F "file=@./fixtures/documents/basic.docx"
```

```bash
curl http://localhost:3050/v1/pdf/jobs/<JOB_ID> \
  -H "Authorization: Bearer dev-local-key"
```

A completed job includes a signed `output.url`. Sync conversion (`POST /v1/pdf/convert/sync`) is optional and only for small files after the async path is stable.

## Configuration

Copy `.env.example` for local development. Never commit `.env` or production secrets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3050` | API listen port |
| `DATABASE_URL` | — | PostgreSQL connection |
| `REDIS_URL` | — | Queue backend |
| `GOTENBERG_URL` | — | Private conversion engine |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_*` | — | Object storage |
| `PDF_MAX_FILE_SIZE_MB` | `25` | Upload ceiling |
| `PDF_MAX_PAGES` | `300` | Output page ceiling |
| `PDF_JOB_TIMEOUT_SECONDS` | `120` | Per-job timeout |
| `PDF_WORKER_CONCURRENCY` | `2` | In-flight conversions per worker |
| `PDF_JOB_RETENTION_HOURS` | `24` | Object and job TTL |
| `SIGNED_URL_EXPIRES_SECONDS` | `900` | Download URL lifetime |
| `API_RATE_LIMIT_MAX` | `30` | Requests per window |
| `API_RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window |

Full list and Docker topology: [docs/deployment.md](docs/deployment.md).

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/pdf/convert` | Enqueue a conversion (`multipart/form-data`) |
| `GET` | `/v1/pdf/jobs/:jobId` | Job status and signed download URL |
| `DELETE` | `/v1/pdf/jobs/:jobId` | Cancel or expire a job |
| `POST` | `/v1/pdf/convert/sync` | Optional small-file synchronous convert |
| `GET` | `/health` | Process liveness |
| `GET` | `/ready` | PostgreSQL, Redis, Gotenberg, storage |

Enqueue response:

```json
{
  "success": true,
  "jobId": "pdf_01JXYZ...",
  "status": "queued"
}
```

Job states: `queued`, `processing`, `completed`, `failed`, `cancelled`, `expired`.

Error envelope:

```json
{
  "success": false,
  "error": {
    "code": "UNSUPPORTED_FILE_TYPE",
    "message": "The uploaded file type is not supported.",
    "requestId": "req_01JXYZ"
  }
}
```

Send `Idempotency-Key` to make retries safe. Request schemas, codes, and auth: [docs/api.md](docs/api.md).

## Security

- Authenticate every conversion endpoint in production
- Scope job reads and deletes to the owning principal
- Validate filename, extension, MIME type, magic bytes, and size
- Scan malware before enqueue when a scanner is configured
- Isolate Gotenberg: internal network, pinned image, resource limits, no host mounts
- Keep buckets private; issue short-lived signed URLs
- Never interpolate user input into a shell command
- Never log document contents, secrets, or signed URLs

Details and the security test list: [docs/security.md](docs/security.md).

## Operations

| Concern | Behavior |
| --- | --- |
| Logs | JSON via Pino; `requestId` + `jobId` on every hop |
| Metrics | Conversion counts, duration, queue depth, bytes |
| Health | `/health` liveness, `/ready` dependency checks |
| Cleanup | Temp dirs deleted in `finally`; scheduled object/job TTL |
| Shutdown | Drain in-flight work on `SIGTERM` / `SIGINT` |
| Failure | Retry recoverable errors; fail permanent input errors; reclaim stale jobs |

Playbook: [docs/operations.md](docs/operations.md).

## Development

```bash
yarn typecheck
yarn lint
yarn test
docker compose config
```

TypeScript strict mode, small modules, centralized errors and configuration, no silent catches. Inspect existing Prisma, Redis, logging, and Docker setup before adding parallel infrastructure.

Phased build order, fixtures, visual regression, and the quality bar: [docs/development.md](docs/development.md).

### First milestone

Ship a stable pipeline for **JPG, JPEG, PNG, DOC, DOCX** with async jobs, storage, auth, rate limits, validation, health checks, structured logs, Docker, and automated tests. Expand formats only after that core path is reliable.

## Acceptance criteria

The service is not production-ready until these hold.

**Functional**

- [ ] JPG, JPEG, PNG, DOC, DOCX, DOCM, DOT, DOTX, RTF, ODT, TXT convert to valid PDFs
- [ ] A4, A5, Letter, Legal, and custom page sizes work
- [ ] Portrait, landscape, and automatic image orientation work
- [ ] Image aspect ratio is preserved
- [ ] Office `pageSize=auto` preserves the source page configuration
- [ ] Generated PDFs pass validation and are downloadable via signed URL

**Reliability**

- [ ] Recoverable failures retry; permanent failures do not
- [ ] Stale `processing` jobs recover; worker/API restarts do not lose queued work
- [ ] Temporary files and expired objects are cleaned up
- [ ] Storage and Gotenberg failures are handled

**Security**

- [ ] Size, MIME, and magic-byte limits enforced
- [ ] Path traversal and shell injection blocked
- [ ] Cross-tenant job access denied
- [ ] Rate limiting enabled; Gotenberg not public
- [ ] Secrets uncommitted; sensitive values unlogged

**Production**

- [ ] Non-root Docker image, resource limits, graceful shutdown
- [ ] `/health` and `/ready`, structured logs, metrics, OpenAPI
- [ ] Prisma migrations, Redis reconnect, automated and visual tests

## Documentation

| Document | Topic |
| --- | --- |
| [Architecture](docs/architecture.md) | Engines, queue, storage, data model |
| [API](docs/api.md) | Endpoints, schemas, errors, idempotency |
| [Security](docs/security.md) | Validation, isolation, secrets |
| [Deployment](docs/deployment.md) | Compose, images, env, health |
| [Operations](docs/operations.md) | Logs, metrics, cleanup, runbook |
| [Development](docs/development.md) | Structure, tests, implementation phases |
