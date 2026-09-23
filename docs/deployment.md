# Deployment

## Topology

```text
api
worker
postgres
redis
gotenberg
minio
nginx
```

Only Nginx (and through it, the API) is reachable from the public network.

```text
api     → postgres, redis
worker  → redis, postgres, gotenberg, minio
gotenberg / redis / postgres / minio → internal only
```

Start the full stack with:

```bash
docker compose up -d
```

Validate the compose file with `docker compose config` before applying changes.

## Images

Use multi-stage builds. Separate development and production targets (`Dockerfile`, `Dockerfile.dev`) when that keeps the production image smaller.

The production Node image contains only what is required to run the API or worker:

- no test files
- no `.git`
- no development dependencies
- no unnecessary build tooling
- source maps only if operations require them

Run as a non-root user. Pin every image tag. Do not use `latest` in production. Verify the current approved Gotenberg 8.x tag at implementation time and pin that exact version.

## Resource limits

Starting points only. Benchmark with real documents before production sizing.

| Service | CPU | RAM |
| --- | --- | --- |
| API | 1–2 | 512 MB–1 GB |
| Worker | 2 | 2 GB |
| Gotenberg | 2 | 2–4 GB |
| Redis | 0.5–1 | 512 MB–1 GB |

Do not raise `PDF_WORKER_CONCURRENCY` until benchmarks show spare capacity.

## Environment

Document every variable in `.env.example`. Never commit `.env`.

```env
NODE_ENV=development
PORT=3050

DATABASE_URL=postgresql://user:password@postgres:5432/pdf_service
REDIS_URL=redis://redis:6379
GOTENBERG_URL=http://gotenberg:3000

S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=pdf-service
S3_ACCESS_KEY=minio
S3_SECRET_KEY=change-me
S3_FORCE_PATH_STYLE=true

PDF_MAX_FILE_SIZE_MB=25
PDF_MAX_PAGES=300
PDF_JOB_TIMEOUT_SECONDS=120
PDF_WORKER_CONCURRENCY=2
PDF_JOB_RETENTION_HOURS=24
PDF_INPUT_RETENTION_HOURS=24

SIGNED_URL_EXPIRES_SECONDS=900

API_RATE_LIMIT_MAX=30
API_RATE_LIMIT_WINDOW_SECONDS=60
```

Production secrets come from the platform secret store, not Git. See [Security](./security.md#secrets).

Use a package lockfile. Do not depend on floating dependency versions. Run Node.js on an LTS release.

## Health checks

| Endpoint | Meaning |
| --- | --- |
| `GET /health` | Process is alive |
| `GET /ready` | PostgreSQL, Redis, Gotenberg, and object storage are reachable |

Return `200` from `/ready` only when required dependencies are available. Wire these endpoints into Kubernetes, Docker, and Nginx checks.

## Graceful shutdown

API and workers handle `SIGTERM` and `SIGINT`:

1. Stop accepting new HTTP requests and new queue jobs.
2. Finish the in-flight conversion when possible.
3. Close Redis, PostgreSQL, and HTTP clients.
4. Exit cleanly.

Do not kill a conversion process without cleanup unless its timeout has already been exceeded.

## Fonts

Bengali and mixed-script documents are a first-class requirement. Install and test fonts inside the Gotenberg image. Do not rely on fonts from the host.
