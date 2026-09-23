#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Starting Gotenberg for Office conversion..."
  echo "Postgres, Redis, and file storage already run locally — not starting those in Docker."
  docker compose up -d gotenberg
  echo
  echo "Gotenberg: http://127.0.0.1:3000"
  echo "Keep yarn dev and yarn dev:worker running, then convert a .docx in Postman."
  exit 0
fi

echo "Docker is not available. Starting local Postgres and Redis via Homebrew..."

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required when Docker is not installed."
  echo "Install Docker Desktop, or install Homebrew and rerun: yarn infra"
  exit 1
fi

brew list postgresql@18 >/dev/null 2>&1 || brew install postgresql@18
brew list redis >/dev/null 2>&1 || brew install redis

brew services start postgresql@18
brew services start redis

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

"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
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

echo "Local infrastructure is ready:"
echo "  PostgreSQL  localhost:5432  pdf/pdf  db=pdf_service"
echo "  Redis       localhost:6379"
echo "  Storage     STORAGE_DRIVER=fs  (/tmp/pdf-service-objects)"
echo
echo "Office conversion still needs Gotenberg. Install Docker Desktop for that."
echo "Images can be converted without Gotenberg."
