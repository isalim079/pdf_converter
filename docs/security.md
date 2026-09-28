# Security

This version has no API authentication. Do not expose it on the public internet without a reverse proxy, network policy, or auth in front of it. Rate limiting is enabled because conversion is CPU-heavy.

## Upload checks

- filename sanitization and path-traversal rejection
- extension allow-list
- magic-byte / ZIP-structure checks
- size limit (`PDF_MAX_FILE_SIZE_MB`)
- HTML assets: flat names only, bounded count and total bytes

Never interpolate user input into a shell command. Gotenberg is called over HTTP with `FormData`.

## Isolation

- Gotenberg is not public
- conversion timeout per request
- concurrent conversion cap
- temp directories deleted in `finally`
- no host Docker socket
- do not log document contents

## Fonts

Install needed fonts in the Gotenberg image rather than mounting the host font directory. Missing fonts are substituted and can change layout.
