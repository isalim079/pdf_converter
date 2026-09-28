# Deployment

## Topology

```text
api  →  gotenberg (private)
```

Start with:

```bash
yarn start
```

`yarn start` runs [scripts/ensure-runtime.mjs](../scripts/ensure-runtime.mjs), then boots the API. Validate Compose with `docker compose config`.

| Environment | What `yarn start` does |
| --- | --- |
| Linux/macOS/Windows with Docker | Builds and starts Gotenberg from `docker/gotenberg/Dockerfile` if it is down |
| Linux without Docker | Runs `scripts/install-linux.sh` if Gotenberg is missing, then the app |
| macOS without Docker | Images still convert. Office/HTML need Docker Desktop or Linux Gotenberg |
| Windows with WSL Ubuntu | Re-executes `yarn start` inside WSL |
| Windows without Docker/WSL | `wsl --install -d Ubuntu`, or [scripts/windows/setup-hyperv-ubuntu.ps1](../scripts/windows/setup-hyperv-ubuntu.ps1) |

Set `PDF_ENSURE_SKIP=1` to skip ensure.

Ensure never stops other projects. If `:3000` or `:3050` belong to something else, this app binds the next free localhost ports and writes them to `.env`. Compose project name is `pdf-converter-api`.

### Linux without Docker

`scripts/install-linux.sh` installs Node 22, LibreOffice, Chromium, Bengali and metric-compatible fonts, unoconverter, and a Gotenberg Linux binary.

Set `GOTENBERG_BIN`. After ensure, `src/start.ts` spawns Gotenberg on `127.0.0.1` unless `GOTENBERG_URL` is already healthy.

### Images

Gotenberg is built from [docker/gotenberg/Dockerfile](../docker/gotenberg/Dockerfile) so Noto, Bengali, Liberation, and Caladea/Carlito fonts are present.

The API image is a multi-stage Node 24 build. It does not include Prisma, Redis, or MinIO.
