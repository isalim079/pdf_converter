# Security

The conversion engine processes untrusted files. Treat every upload as hostile until validation, optional malware scanning, and authorization checks succeed.

## File validation

Never trust the client filename or declared MIME type. Validate all of:

```text
filename
extension
MIME type
magic bytes / file signature
file size
```

A file named `invoice.docx` must contain a valid DOCX/ZIP structure. A renamed executable (`malware.exe` → `invoice.docx`) is rejected with `415 Unsupported Media Type`.

## Filename handling

Do not use the uploaded filename as a filesystem path.

```text
# reject
/tmp/${filename}

# accept
/tmp/pdf-service/${jobId}/input
```

Sanitize the original name only for display and metadata. Storage keys are generated.

## Resource limits

All limits are environment-driven. A single request must not allocate unbounded CPU, memory, disk, or queue depth.

```env
PDF_MAX_FILE_SIZE_MB=25
PDF_MAX_PAGES=300
PDF_JOB_TIMEOUT_SECONDS=120
PDF_TEMP_DIR=/tmp/pdf-service
PDF_JOB_RETENTION_HOURS=24
PDF_MAX_CONCURRENT_JOBS=2
PDF_WORKER_CONCURRENCY=2
```

Enforce maximum upload size, page count, conversion time, worker concurrency, memory, CPU, and queue depth.

## Process execution

Do not build shell command strings from user input.

```ts
// reject
exec(`convert ${userInput}`)
```

If a CLI is required, pass an argument array. Never interpolate filenames, options, or metadata into a shell string.

## Malware scanning

Optional, behind an interface so ClamAV (or another scanner) can be added without coupling the app:

```ts
interface MalwareScanner {
  scan(filePath: string): Promise<ScanResult>;
}
```

Order: upload → file validation → virus scan → queue. Conversion starts only after the security stage completes.

## Authentication and authorization

Production endpoints require authentication. Job access is owner-scoped. See [API](./api.md#authentication).

## Gotenberg isolation

Gotenberg is an isolated security boundary, not a public service.

| Control | Requirement |
| --- | --- |
| Network | Internal Docker network only |
| Image | Pinned version, never `latest` |
| Resources | CPU, memory, and conversion timeouts |
| Filesystem | No host mounts except required temp/storage |
| Privileges | No Docker socket, no unnecessary capabilities |
| Debug | Disabled in production |
| SSRF | Review outbound-network settings before production |

Do not mount `/`, `/home`, `/etc`, or `/var` from the host.

## Object storage

Buckets stay private. Clients receive short-lived signed URLs. Do not make generated PDFs world-readable.

## Secrets

`.env` is for local development only. Never commit real secrets.

Production injects secrets from Docker secrets, Vault, AWS Secrets Manager, Cloudflare secrets, host environment, or the CI/CD secret store.

## Logging

Structured JSON logs include `requestId`, `jobId`, owner, engine, sizes, duration, and status.

Never log document contents, passwords, API keys, signed URLs, or access tokens. Do not use filenames as metric labels.

## Security test coverage

Minimum cases:

```text
malicious filename
path traversal
invalid / fake MIME
renamed executable
oversized upload
zip bomb
corrupt DOCX
SSRF / internal URL / file://
command-injection strings
HTML/script injection
unauthorized job access
expired signed URL
duplicate idempotency key
rate-limit bypass
```
