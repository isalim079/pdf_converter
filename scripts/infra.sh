#!/usr/bin/env bash
set -euo pipefail

# Start Gotenberg (Docker) or Homebrew Postgres/Redis. Never stops existing services.

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
  docker compose -p pdf-converter-api up -d gotenberg
  echo
  echo "Gotenberg: http://127.0.0.1:${PDF_GOTENBERG_PORT:-3000}"
  echo "Keep yarn dev running, then convert a .docx in Postman."
  exit 0
fi

echo "Docker is not available. Starting local Postgres and Redis via Homebrew if those ports are free..."

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required when Docker is not installed."
  echo "Install Docker Desktop, or install Homebrew and rerun: yarn infra"
  exit 1
fi

if port_busy 5432; then
  echo "Port 5432 is already in use. Not starting or stopping PostgreSQL."
  SKIP_PG_START=1
else
  brew list postgresql@18 >/dev/null 2>&1 || brew install postgresql@18
  brew services start postgresql@18
  SKIP_PG_START=0
fi

if port_busy 6379; then
  echo "Port 6379 is already in use. Not starting or stopping Redis."
else
  brew list redis >/dev/null 2>&1 || brew install redis
  brew services start redis
fi

if [[ "${SKIP_PG_START}" -eq 1 ]]; then
  if PGPASSWORD=pdf psql -h 127.0.0.1 -U pdf -d pdf_service -c 'SELECT 1' >/dev/null 2>&1; then
    echo "Using existing pdf_service database on 5432."
  else
    echo "Port 5432 belongs to another project. This script will not change that PostgreSQL."
    exit 1
  fi
else
  for _ in $(seq 1 20); do
    if pg_isready -q; then
      break
    fi
    sleep 0.5
  done

  if ! pg_isready -q; then
    echo "PostgreSQL did not become ready."
    exit 1
  fi

  PSQL=(psql)
  if ! psql -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    if psql -U srs -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
      PSQL=(psql -U srs)
    fi
  fi

  "${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pdf') THEN
    CREATE ROLE pdf LOGIN PASSWORD 'pdf';
  END IF;
END
$$;
SQL
  if ! "${PSQL[@]}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='pdf_service'" | grep -q 1; then
    "${PSQL[@]}" -d postgres -c "CREATE DATABASE pdf_service OWNER pdf;"
  fi
fi

echo "Local infrastructure is ready:"
echo "  PostgreSQL  localhost:5432  pdf/pdf  db=pdf_service"
echo "  Redis       localhost:6379"
echo "  Storage     STORAGE_DRIVER=fs  (/tmp/pdf-service-objects)"
echo
echo "Office conversion still needs Gotenberg."
echo "On Linux without Docker, run: sudo bash scripts/install-linux.sh"
echo "Images can be converted without Gotenberg."
