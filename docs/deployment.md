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
yarn start
```

`yarn start` runs [scripts/ensure-runtime.mjs](../scripts/ensure-runtime.mjs) first, then boots the API and worker. Validate Compose with `docker compose config` when you change images.

## How to run

Ensure is idempotent: healthy services are left alone. Extra workers use `yarn start:worker` (no ensure, no second Gotenberg).

| Environment | What `yarn start` does |
| --- | --- |
| Linux/macOS/Windows with Docker | Starts missing Compose services (`postgres`, `redis`, `gotenberg`). MinIO is not started when `STORAGE_DRIVER=fs`. |
| Linux without Docker | Runs `scripts/install-linux.sh` if Postgres, Redis, or Gotenberg are missing, then Prisma, then the app |
| macOS without Docker | Homebrew Postgres + Redis (via `scripts/infra.sh`). Office conversion still needs Docker or Linux Gotenberg |
| Windows with WSL Ubuntu | Re-executes `yarn start` inside WSL so DOC/DOCX use Linux Gotenberg |
| Windows without Docker/WSL | Starts `wsl --install -d Ubuntu` when possible, otherwise [scripts/windows/setup-hyperv-ubuntu.ps1](../scripts/windows/setup-hyperv-ubuntu.ps1). Does not use Windows LibreOffice |
| Scale-out | Same app; extra `yarn start:worker` processes; shared Postgres, Redis, and storage |

Set `PDF_ENSURE_SKIP=1` to skip ensure on hosts that already have infrastructure.

Ensure never stops other projects: it does not run `docker compose down`, `brew services stop`, or kill foreign PIDs. It reuses Postgres/Redis/Gotenberg only after an identity check. If `:5432`, `:6379`, `:3000`, or `:3050` belong to something else, this app binds the next free localhost ports and writes them to `.env`. Compose uses project name `pdf-converter-api` so it cannot attach to another directory’s stack.

### Linux without Docker

`scripts/install-linux.sh` installs Node 22, PostgreSQL, Redis, LibreOffice, Chromium, Bengali and metric-compatible fonts, unoconverter, and a Gotenberg **Linux** binary (extracted from `gotenberg/gotenberg:8.21.0` when Docker is available on the build host, otherwise built from source if Go is installed).

Set `GOTENBERG_BIN` to that binary. After ensure, `src/start.ts` spawns Gotenberg on `127.0.0.1` unless `GOTENBERG_URL` is already healthy.

A systemd unit template lives at `scripts/systemd/pdf-converter.service`. The install script copies it to `/etc/systemd/system/pdf-converter.service` but does not enable it.

### Windows (Gotenberg stays Linux)

Gotenberg cannot run as a Windows `.exe`. `yarn start` on Windows without Docker prefers **WSL Ubuntu** (often one reboot after `wsl --install`).

On Windows Server 2019, if WSL is unavailable, run in an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/setup-hyperv-ubuntu.ps1
```

Optional: `-IsoPath C:\iso\ubuntu-22.04.5-live-server-amd64.iso`. After Ubuntu is installed in the VM, run `scripts/install-linux.sh` and `yarn start` **inside the guest**. Clients call `http://<vm-ip>:3050`.

If Hyper-V and WSL are both forbidden, Gotenberg-level office conversion is not possible on that host.

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
# GOTENBERG_BIN=/usr/local/bin/gotenberg

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

Bengali and mixed-script documents are a first-class requirement. Install and test fonts inside the Gotenberg image, or on the Linux host via `scripts/install-linux.sh`. Do not rely on Windows host fonts.
