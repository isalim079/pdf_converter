# Deployment

## Topology

```text
api  →  host LibreOffice (soffice)
     →  host Chrome/Chromium
     →  local image converter
```

Start with:

```bash
yarn start
```

`yarn start` runs [scripts/ensure-runtime.mjs](../scripts/ensure-runtime.mjs), then boots the API. Docker Compose is unused for conversion.

| Environment | What `yarn start` does |
| --- | --- |
| macOS | Probes `soffice` and Chrome. Missing pieces are installed with Homebrew casks (LibreOffice, Google Chrome, Noto Bengali, Liberation). If brew is missing, prints the Homebrew install command and exits. |
| Debian/Ubuntu | `sudo apt-get install` LibreOffice writer/calc/impress, Chromium, and conversion fonts |
| Other Linux | Fails with the package list |
| Windows | wget or `curl.exe` downloads official LibreOffice and Chrome silent MSIs plus font files. Needs an elevated session for `msiexec /qn`. |

Set `PDF_ENSURE_SKIP=1` to skip ensure on already-provisioned hosts.

Ensure never stops other projects. If `:3050` belongs to something else, this app binds the next free localhost port and writes it to `.env`. Detected `LIBREOFFICE_BIN` and `CHROMIUM_BIN` are also written to `.env`.

### Linux packages

`scripts/install-linux.sh` installs Node 22, LibreOffice, Chromium, and Bengali/Noto/Liberation fonts. It does not install Gotenberg.

### Images

A Docker image of the API may still exist for packaging Node, but conversion requires LibreOffice and Chrome on the same machine (or a container that includes those binaries).
