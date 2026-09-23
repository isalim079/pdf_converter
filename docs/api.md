# API

The public contract is versioned from day one under `/v1`. Asynchronous conversion is the default.

## Authentication

Production conversion endpoints are authenticated.

| Deployment | Mechanism |
| --- | --- |
| Private / internal | API key |
| Multi-tenant platform | JWT / OAuth2 |

Every request has an identifiable owner (`userId`, `organizationId`, `applicationId`, or `apiKeyId`). Ownership is stored with the job.

Authorization is mandatory on job reads and deletes:

```text
WHERE id = :jobId AND owner_id = :authenticatedOwnerId
```

A caller must never receive another tenant's PDF.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/pdf/convert` | Enqueue conversion |
| `GET` | `/v1/pdf/jobs/:jobId` | Poll job status |
| `DELETE` | `/v1/pdf/jobs/:jobId` | Cancel or expire a job |
| `POST` | `/v1/pdf/convert/sync` | Optional small-file sync path |
| `GET` | `/health` | Process liveness |
| `GET` | `/ready` | Dependency readiness |

OpenAPI documents every endpoint, including examples, authentication, limits, supported formats, and error codes. Swagger UI is enabled in development and configurable in production.

### `POST /v1/pdf/convert`

`Content-Type: multipart/form-data`

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./fixtures/documents/basic.docx" \
  -F "pageSize=auto"
```

Response:

```json
{
  "success": true,
  "jobId": "pdf_01JXYZ...",
  "status": "queued"
}
```

### `GET /v1/pdf/jobs/:jobId`

```json
{
  "success": true,
  "job": {
    "id": "pdf_01JXYZ...",
    "status": "completed",
    "input": {
      "filename": "invoice.docx",
      "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "size": 284921
    },
    "output": {
      "mimeType": "application/pdf",
      "size": 392821,
      "pages": 4,
      "url": "https://storage.example.com/..."
    },
    "createdAt": "2026-09-23T07:00:00.000Z",
    "completedAt": "2026-09-23T07:00:08.000Z"
  }
}
```

Job states: `queued`, `processing`, `completed`, `failed`, `cancelled`, `expired`.

Download URLs are short-lived signed links to a private bucket. Default expiry is 15 minutes (`SIGNED_URL_EXPIRES_SECONDS`). The bucket is never public.

### `POST /v1/pdf/convert/sync`

Ship only after the async pipeline is stable. Intended for small files with hard limits, for example:

| Limit | Starting value |
| --- | --- |
| File size | 5 MB |
| Pages | 30 |
| Conversion time | 30 s |

Larger or expensive jobs must use the async API.

## Request options

Validate every field with Zod before it reaches a converter or process boundary. Unvalidated values must never reach a shell.

```json
{
  "page": {
    "size": "A4",
    "orientation": "portrait",
    "margin": {
      "top": 10,
      "right": 10,
      "bottom": 10,
      "left": 10,
      "unit": "mm"
    }
  },
  "image": {
    "fit": "contain",
    "dpi": 300
  },
  "pdf": {
    "pdfa": false,
    "title": "Invoice",
    "metadata": {
      "title": "Invoice #123",
      "author": "My Company",
      "subject": "Customer Invoice"
    }
  }
}
```

Office default remains `page.size = auto`. Image default remains A4 / auto / contain.

PDF metadata may include Title, Author, Subject, Keywords, Creator, and Producer. Reject arbitrary or unsafe metadata values. PDF/A is opt-in (`pdfa: false` by default) and only advertised after the chosen profile (`PDF/A-1b`, `2b`, `3b`) is tested.

## Idempotency

```http
Idempotency-Key: abc123
```

The first request creates a job. A retry with the same key and equivalent body returns the existing job. Persist the mapping in PostgreSQL so mobile clients and unreliable networks do not create duplicates.

## Errors

All errors use one envelope:

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

Unsupported files return `415 Unsupported Media Type`.

Never expose stack traces, filesystem paths, command lines, Redis or S3 credentials, or Gotenberg internals.

Central error codes:

```text
INVALID_REQUEST
FILE_REQUIRED
FILE_TOO_LARGE
UNSUPPORTED_FILE_TYPE
INVALID_FILE_SIGNATURE
MALWARE_DETECTED
CONVERSION_TIMEOUT
CONVERSION_FAILED
PDF_VALIDATION_FAILED
STORAGE_UPLOAD_FAILED
JOB_NOT_FOUND
UNAUTHORIZED
FORBIDDEN
RATE_LIMITED
```

## Rate limiting

Apply limits to convert and status endpoints. Scope separately for anonymous callers, authenticated users, organizations, and API keys. Protect the queue so one tenant cannot consume all conversion capacity.
