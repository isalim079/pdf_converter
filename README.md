# PDF Conversion Service

Upload a document or image with multipart form data. The API converts it and returns the PDF in the same HTTP response.

Office files go through host LibreOffice (`soffice`). HTML goes through host Chrome/Chromium print-to-PDF. Raster images are converted locally.

Docker is not used. `yarn start` and `yarn dev` detect missing LibreOffice, Chrome/Chromium, and conversion fonts, then install them for that OS: Homebrew on macOS, `sudo apt-get` on Debian/Ubuntu, wget silent installers on Windows.

This is not a universal converter. It covers common office, HTML, and image formats well. Fonts, colors, and images are preserved when the source file contains them (or the host has matching fonts). Microsoft-only layout, macros, and missing fonts can still change the result.

## Contents

- [How conversion works](#how-conversion-works)
- [Supported formats](#supported-formats)
- [Fidelity](#fidelity)
- [Quick start](#quick-start)
- [API](#api)
- [Configuration](#configuration)
- [Development](#development)
- [Documentation](#documentation)

## How conversion works

```text
multipart upload
  → validate type and size
  → write a request-scoped temp folder
  → route by format
       office  → soffice --headless --convert-to pdf
       HTML    → chrome --headless --print-to-pdf
       images  → local image converter
  → validate the PDF
  → stream application/pdf
  → delete the temp folder
```

There is no authentication, job queue, database, Redis, or object storage. Temporary files live under `PDF_TEMP_DIR` for the length of the request only.

## Supported formats

| Family | Extensions | Engine |
| --- | --- | --- |
| Images | `.jpg` `.jpeg` `.png` `.webp` | local |
| Word / Writer | `.doc` `.docx` `.docm` `.dot` `.dotx` `.rtf` `.odt` `.txt` | LibreOffice |
| Excel / Calc | `.xls` `.xlsx` `.xlsm` `.ods` `.csv` | LibreOffice |
| PowerPoint / Impress | `.ppt` `.pptx` `.pptm` `.odp` | LibreOffice |
| HTML | `.html` `.htm` plus optional flat assets | Chromium |

Unsupported types are rejected with `UNSUPPORTED_FILE_TYPE`.

## Fidelity

Office export uses LibreOffice PDF filter JSON: `EmbedStandardFonts`, `UseLosslessCompression`, `Quality=100`, `ReduceImageResolution=false`. Each request gets its own `--env:UserInstallation` profile.

HTML uses Chromium `--headless --print-to-pdf --no-pdf-header-footer`. Chromium prints backgrounds and prefers CSS `@page` size.

- Missing fonts are substituted. Embed fonts in the document, or send font files as HTML assets, when typography must match.
- LibreOffice is not Microsoft Office. Complex Word/Excel/PowerPoint effects, SmartArt, macros, and some embedded objects can shift.
- Images keep aspect ratio. They are never stretched.
- Office `pageSize=auto` keeps the source page setup when LibreOffice supports it.

Bengali and mixed Bengali/English rendering needs Noto/Bengali and Liberation fonts on the host. `yarn start` installs those when they are missing.

## Quick start

```bash
yarn install
yarn start
```

Development with reload:

```bash
yarn install
yarn dev
```

`yarn start` / `yarn dev` run `scripts/ensure-runtime.mjs` first. They copy `.env` if needed, probe for `soffice` and Chrome, install what is missing, write `LIBREOFFICE_BIN` / `CHROMIUM_BIN` into `.env`, then boot the API. Use `PDF_ENSURE_SKIP=1` on CI or already-provisioned hosts.

Postman: `POST http://localhost:3050/v1/pdf/convert` with form-data field `file` (the document). No auth header. The response body is the PDF.

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -F "file=@./fixtures/documents/basic.docx" \
  -o out.pdf
```

HTML with a local image or font (flat filenames only):

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -F "file=@./page.html" \
  -F "assets=@./logo.png" \
  -o out.pdf
```

### Host installers

| OS | When engines are missing |
| --- | --- |
| macOS | `brew install --cask libreoffice google-chrome` plus Noto Bengali and Liberation font casks. If Homebrew is absent, the command to install it is printed and start exits. |
| Debian/Ubuntu | `sudo apt-get install` LibreOffice writer/calc/impress, Chromium, and conversion fonts |
| Other Linux | Start fails with the package list to install |
| Windows | wget (or `curl.exe`) downloads LibreOffice and Chrome silent MSIs and font files. Run the terminal as Administrator; otherwise the exact `msiexec` command is printed. |

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/pdf/convert` | Convert a file and return the PDF |
| `GET` | `/health` | Process liveness |
| `GET` | `/ready` | LibreOffice and Chromium readiness |
| `GET` | `/docs` | OpenAPI UI (when enabled) |

`POST /v1/pdf/convert` is `multipart/form-data`.

| Field | Required | Purpose |
| --- | --- | --- |
| `file` | yes | The document or image (`File` is also accepted) |
| `assets` | no | Extra HTML files (css, images, fonts). Repeat the field. |
| `pageSize` | no | `auto`, `A4`, `LETTER`, … |
| `orientation` | no | `auto`, `portrait`, `landscape` |
| `fit` | no | Image fit: `contain`, `cover`, `original` |
| `options` | no | JSON object that overrides the fields above |

Success: `200` with `Content-Type: application/pdf`.

Headers on success: `Content-Disposition`, `X-Page-Count`, `X-Conversion-Engine`, `X-Request-Id`.

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

Missing LibreOffice or Chrome returns `ENGINE_UNAVAILABLE` with an install hint for that OS.

## Configuration

Copy `.env.example`. Never commit `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3050` | API listen port |
| `LIBREOFFICE_BIN` | auto-detect | Path to `soffice` |
| `CHROMIUM_BIN` | auto-detect | Path to Chrome or Chromium |
| `ENGINES_REQUIRED` | `true` in production | `/ready` fails if a host engine is missing |
| `PDF_MAX_FILE_SIZE_MB` | `25` | Upload ceiling |
| `PDF_MAX_PAGES` | `300` | Output page ceiling |
| `PDF_JOB_TIMEOUT_SECONDS` | `120` | Per-request conversion timeout |
| `PDF_MAX_CONCURRENT_JOBS` | `2` | In-flight conversions |
| `PDF_MAX_HTML_ASSETS` | `32` | Extra HTML files per request |
| `PDF_TEMP_DIR` | `/tmp/pdf-service` | Request-scoped local folder |
| `API_RATE_LIMIT_MAX` | `30` | Requests per window |
| `API_RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window |
| `PDF_ENSURE_SKIP` | unset | `1` skips engine probes on start |

## Development

```bash
yarn typecheck
yarn lint
yarn test
```

## Documentation

| Document | Topic |
| --- | --- |
| [Architecture](docs/architecture.md) | Engines, request flow, temp files |
| [API](docs/api.md) | Endpoint, fields, errors |
| [Security](docs/security.md) | Validation, isolation |
| [Deployment](docs/deployment.md) | Host install, env |
| [Operations](docs/operations.md) | Logs, metrics, runbook |
| [Development](docs/development.md) | Structure, tests |
