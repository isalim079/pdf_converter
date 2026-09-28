# Development

```text
src/
  app/                 Fastify server, config, container
  infrastructure/      Gotenberg client, logging, metrics
  modules/pdf/         convert route, converters, validation
  common/              errors, temp dirs, filenames
```

Converters implement one interface. `ConverterResolver` picks by extension. Controllers do not contain routing logic.

## Tests

```bash
yarn typecheck
yarn lint
yarn test
```

Cover:

- magic-byte validation for supported types
- PNG/JPEG local conversion
- mocked LibreOffice and Chromium routes
- HTML assets
- unsupported and missing files
- temp-dir cleanup
- ensure-runtime decision table

Generate tiny fixtures with `yarn fixtures`.

## Quality bar

TypeScript strict mode, small modules, centralized errors and configuration, no silent catches. Do not add PostgreSQL, Redis, or S3 unless the product needs async jobs again.
