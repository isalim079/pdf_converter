# Operations

| Concern | Behavior |
| --- | --- |
| Logs | JSON via Pino; `requestId` on every hop |
| Metrics | Conversion counts, duration, in-flight work, bytes at `/metrics` |
| Health | `/health` liveness, `/ready` Gotenberg check |
| Cleanup | Request temp dirs deleted in `finally`; startup sweep of abandoned dirs |
| Shutdown | `SIGTERM` / `SIGINT` close the HTTP server |
| Limits | File size, page count, HTML asset count, rate limit, conversion timeout |

Gotenberg failures surface as `CONVERSION_FAILED` or `CONVERSION_TIMEOUT`. Permanent bad input (wrong type, corrupt file) is not retried; the request fails immediately.

Temp files live under `PDF_TEMP_DIR`. Do not put durable data there.
