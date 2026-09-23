# Operations

## Observability

Every request and conversion carries:

```text
requestId
jobId
ownerId
conversionEngine
inputMimeType
fileSize
duration
status
errorCode
```

The same `jobId` appears in API logs, worker logs, PostgreSQL, storage keys, metrics, and error records.

Example:

```json
{
  "level": "info",
  "msg": "PDF conversion completed",
  "requestId": "req_123",
  "jobId": "pdf_123",
  "engine": "gotenberg",
  "inputType": "docx",
  "inputSize": 284921,
  "outputSize": 391281,
  "pages": 4,
  "durationMs": 8241
}
```

Logging is structured JSON via Pino. Never log document contents, passwords, API keys, signed URLs, or access tokens.

## Metrics

| Metric | Purpose |
| --- | --- |
| `conversion_total` | All conversion attempts |
| `conversion_success_total` | Successful conversions |
| `conversion_failure_total` | Failed conversions |
| `conversion_duration_seconds` | Conversion latency |
| `conversion_queue_depth` | Waiting jobs |
| `conversion_active_jobs` | In-flight jobs |
| `conversion_input_bytes` | Ingested bytes |
| `conversion_output_bytes` | Produced bytes |

Later additions may include breakdowns by type, engine, or customer. Do not put filenames or document content in metric labels.

## Cleanup

A scheduled job deletes expired PDF objects, expired inputs, old failed and completed jobs, and leftover temporary files.

```env
PDF_JOB_RETENTION_HOURS=24
PDF_INPUT_RETENTION_HOURS=24
```

Workers also delete `/tmp/pdf-service/<job-id>/` in a `finally` block. On startup, remove abandoned temp directories.

## Worker failure handling

The worker must survive:

```text
Gotenberg unavailable or timed out
Redis reconnect
storage unavailable
PDF validation failure
process interruption
container restart
```

Job state stays consistent: recoverable errors retry, permanent errors fail, and stale `processing` jobs are reclaimed. An API restart must not lose queued work.

## Health

- `/health` — process liveness
- `/ready` — PostgreSQL, Redis, Gotenberg, object storage

See [Deployment](./deployment.md#health-checks).

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Jobs stay `queued` | Worker down or Redis unreachable | Worker logs, `/ready`, Redis connectivity |
| Jobs stay `processing` | Worker crash mid-job | Stale-job recovery, Gotenberg health |
| Immediate `failed` | Invalid input or validation | `errorCode`, file signature, size limits |
| Timeouts | Document too large or Gotenberg saturated | Duration metrics, concurrency, resource limits |
| `403` on job read | Ownership mismatch | Auth token vs `owner_id` |
| Signed URL 403 | Expiry or clock skew | `SIGNED_URL_EXPIRES_SECONDS`, object key |
| Broken Bengali glyphs | Missing fonts in Gotenberg image | Fonts baked into the conversion image |
| High memory | Concurrency too high | Worker/Gotenberg RAM, benchmark suite |

## Performance baseline

Benchmark before raising concurrency:

```text
1-page DOCX
10-page DOCX
50-page DOCX
100-page DOCX
large JPEG / PNG
batch of 10 images
complex Word document
```

Record queue wait, conversion time, end-to-end latency, CPU, RAM, output size, and failure rate. Keep the baseline with the repository.
