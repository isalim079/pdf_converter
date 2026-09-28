#!/usr/bin/env bash
set -euo pipefail

# Start Gotenberg for this project. Never stops existing services.

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

port_busy() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "${port}" >/dev/null 2>&1
    return $?
  fi
  bash -c "echo >/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Starting Gotenberg for this project only (compose project pdf-converter-api)."
  echo "Existing containers and host processes are left running."
  if port_busy 3000 && ! curl -fsS http://127.0.0.1:3000/health 2>/dev/null | grep -qiE 'gotenberg|libreoffice|chromium'; then
    echo "Port 3000 is in use by another process. Set PDF_GOTENBERG_PORT to a free port and rerun."
    echo "This script will not stop the process on 3000."
    exit 1
  fi
  docker compose -p pdf-converter-api up -d --build gotenberg
  echo
  echo "Gotenberg: http://127.0.0.1:${PDF_GOTENBERG_PORT:-3000}"
  echo "Keep yarn dev running, then POST a file to /v1/pdf/convert."
  exit 0
fi

echo "Docker is not available."
echo "Images (JPG/PNG/WebP) convert without Gotenberg."
echo "Office and HTML conversion need Docker Desktop or a Linux host with scripts/install-linux.sh."
exit 1
