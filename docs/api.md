# API

The public contract is `/v1`. Conversion is synchronous: the PDF is the HTTP body.

There is no authentication on this version.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/pdf/convert` | Convert a file and return the PDF |
| `GET` | `/health` | Process liveness |
| `GET` | `/ready` | LibreOffice and Chromium readiness |

OpenAPI is served at `/docs` when `SWAGGER_ENABLED=true`.

### `POST /v1/pdf/convert`

`Content-Type: multipart/form-data`

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -F "file=@./fixtures/documents/basic.docx" \
  -F "pageSize=auto" \
  -o out.pdf
```

In Postman, use form-data with key `file` (not `File` if you want the documented name; the API also accepts `File`).

HTML assets must be flat filenames (`logo.png`, not `images/logo.png`) and referenced that way in the HTML.

```bash
curl -X POST http://localhost:3050/v1/pdf/convert \
  -F "file=@./index.html" \
  -F "assets=@./logo.png" \
  -F "assets=@./NotoSans.ttf" \
  -o out.pdf
```

Success:

- `200`
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="…pdf"`
- `X-Page-Count`
- `X-Conversion-Engine` (`image`, `libreoffice`, or `chromium`)
- `X-Request-Id`

Optional fields: `pageSize`, `orientation`, `fit`, or a JSON `options` field matching the conversion schema.

### Errors

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

| Code | Status |
| --- | --- |
| `FILE_REQUIRED` | 400 |
| `INVALID_REQUEST` | 400 |
| `FILE_TOO_LARGE` | 413 |
| `UNSUPPORTED_FILE_TYPE` | 415 |
| `INVALID_FILE_SIGNATURE` | 415 |
| `CONVERSION_FAILED` | 422 |
| `PDF_VALIDATION_FAILED` | 422 |
| `RATE_LIMITED` | 429 |
| `ENGINE_UNAVAILABLE` | 503 |
| `CONVERSION_TIMEOUT` | 504 |
| `INTERNAL_ERROR` | 500 |
