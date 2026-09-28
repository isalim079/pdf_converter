#!/usr/bin/env bash
set -euo pipefail

# One-time Linux host install: Node, PostgreSQL, Redis, LibreOffice, fonts, Gotenberg binary.
# Does not require Docker at runtime. Prefer Docker Compose when the daemon is available.

GOTENBERG_VERSION="${GOTENBERG_VERSION:-8.21.0}"
GOTENBERG_IMAGE="gotenberg/gotenberg:${GOTENBERG_VERSION}"
INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local}"
UNOCONVERTER_URL="${UNOCONVERTER_URL:-https://raw.githubusercontent.com/gotenberg/unoconverter/v0.3.0/unoconv}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-${USER}}"

log() {
  echo "[install-linux] $*"
}

die() {
  echo "[install-linux] $*" >&2
  exit 1
}

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This script is for Linux hosts. On Windows Server, run Ubuntu 22.04 in Hyper-V and execute it there."
fi

if [[ ! -f /etc/os-release ]]; then
  die "Cannot detect the Linux distribution."
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  debian:*|ubuntu:*|*:debian*|*:ubuntu*) ;;
  *) die "Unsupported distribution '${ID:-unknown}'. Use Debian or Ubuntu." ;;
esac

if [[ "${EUID}" -ne 0 ]]; then
  die "Re-run as root: sudo bash scripts/install-linux.sh"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

package_available() {
  apt-cache show "$1" >/dev/null 2>&1
}

install_available() {
  local selected=()
  local pkg
  for pkg in "$@"; do
    if package_available "$pkg"; then
      selected+=("$pkg")
    else
      log "Skipping unavailable package: $pkg"
    fi
  done
  if [[ "${#selected[@]}" -gt 0 ]]; then
    apt-get install -y --no-install-recommends "${selected[@]}"
  fi
}

log "Installing Node.js 22, PostgreSQL, Redis, LibreOffice, Chromium, and fonts..."

install_available \
  ca-certificates curl gnupg git \
  postgresql postgresql-contrib \
  redis-server \
  libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw python3 python3-uno \
  chromium chromium-browser \
  qpdf libimage-exiftool-perl default-jre-headless \
  fonts-lohit-beng-bengali fonts-beng fonts-noto-core fonts-noto-ui-core \
  fonts-freefont-ttf fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
  fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation2 fonts-noto-cjk

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  log "Installing Node.js 22 from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

corepack enable >/dev/null 2>&1 || true

port_busy() {
  local port="$1"
  bash -c "echo >/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1
}

SKIP_PG=0
if port_busy 5432; then
  if PGPASSWORD=pdf psql -h 127.0.0.1 -U pdf -d pdf_service -c 'SELECT 1' >/dev/null 2>&1; then
    log "Using existing pdf_service on port 5432."
  else
    log "Port 5432 is in use by another PostgreSQL. Not modifying or stopping it."
    SKIP_PG=1
  fi
elif command -v systemctl >/dev/null 2>&1; then
  if ! systemctl is-active --quiet postgresql && ! systemctl is-active --quiet postgresql@16-main; then
    systemctl enable --now postgresql >/dev/null 2>&1 || true
  else
    log "PostgreSQL is already running; leaving it as-is."
  fi
fi

SKIP_REDIS=0
if port_busy 6379; then
  log "Port 6379 is in use. Not starting or stopping Redis."
  SKIP_REDIS=1
elif command -v systemctl >/dev/null 2>&1; then
  if ! systemctl is-active --quiet redis-server && ! systemctl is-active --quiet redis; then
    systemctl enable --now redis-server >/dev/null 2>&1 || systemctl enable --now redis >/dev/null 2>&1 || true
  else
    log "Redis is already running; leaving it as-is."
  fi
fi

if [[ "${SKIP_PG}" -eq 0 ]] && command -v pg_isready >/dev/null 2>&1; then
  for _ in $(seq 1 30); do
    if pg_isready -q; then
      break
    fi
    sleep 0.5
  done
fi

if [[ "${SKIP_PG}" -eq 0 ]] && command -v psql >/dev/null 2>&1; then
  log "Ensuring PostgreSQL role and database exist..."
  sudo -u postgres psql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pdf') THEN
    CREATE ROLE pdf LOGIN PASSWORD 'pdf';
  END IF;
END
$$;
SQL
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='pdf_service'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE pdf_service OWNER pdf;" >/dev/null
  fi
fi

fc-cache -f >/dev/null 2>&1 || true

install -d -m 0755 "${INSTALL_PREFIX}/bin"
UNOCONVERTER_BIN="${INSTALL_PREFIX}/bin/unoconverter"
if [[ ! -x "${UNOCONVERTER_BIN}" ]]; then
  log "Installing unoconverter..."
  curl -fsSL "${UNOCONVERTER_URL}" -o "${UNOCONVERTER_BIN}"
  chmod +x "${UNOCONVERTER_BIN}"
fi
ln -sf /usr/bin/python3 /usr/local/bin/python >/dev/null 2>&1 || true

GOTENBERG_BIN="${INSTALL_PREFIX}/bin/gotenberg"
if [[ -x "${GOTENBERG_BIN}" ]]; then
  log "Gotenberg binary already present at ${GOTENBERG_BIN}"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Extracting Gotenberg ${GOTENBERG_VERSION} from ${GOTENBERG_IMAGE}..."
  docker pull "${GOTENBERG_IMAGE}"
  cid="$(docker create "${GOTENBERG_IMAGE}")"
  docker cp "${cid}:/usr/bin/gotenberg" "${GOTENBERG_BIN}"
  if docker cp "${cid}:/usr/bin/unoconverter" "${UNOCONVERTER_BIN}.from-image" >/dev/null 2>&1; then
    mv "${UNOCONVERTER_BIN}.from-image" "${UNOCONVERTER_BIN}"
    chmod +x "${UNOCONVERTER_BIN}"
  fi
  docker rm "${cid}" >/dev/null
  chmod +x "${GOTENBERG_BIN}"
elif command -v go >/dev/null 2>&1; then
  log "Building Gotenberg ${GOTENBERG_VERSION} from source (Go is installed, Docker is not)..."
  tmpdir="$(mktemp -d)"
  git clone --depth 1 --branch "v${GOTENBERG_VERSION}" https://github.com/gotenberg/gotenberg.git "${tmpdir}/gotenberg"
  (cd "${tmpdir}/gotenberg" && CGO_ENABLED=0 go build -o "${GOTENBERG_BIN}" -ldflags "-s -w -X 'github.com/gotenberg/gotenberg/v8/cmd.Version=${GOTENBERG_VERSION}'" cmd/gotenberg/main.go)
  rm -rf "${tmpdir}"
  chmod +x "${GOTENBERG_BIN}"
else
  cat >&2 <<EOF
[install-linux] Could not install the Gotenberg binary automatically.

On a machine that has Docker, copy it out of the official image:

  docker pull ${GOTENBERG_IMAGE}
  cid=\$(docker create ${GOTENBERG_IMAGE})
  docker cp "\$cid:/usr/bin/gotenberg" ${GOTENBERG_BIN}
  docker rm "\$cid"
  chmod +x ${GOTENBERG_BIN}

Then re-run this script, or set GOTENBERG_BIN=${GOTENBERG_BIN} and run yarn start.
EOF
fi

SOFFICE_BIN=""
for candidate in /usr/lib/libreoffice/program/soffice.bin /usr/lib/libreoffice/program/soffice; do
  if [[ -x "${candidate}" ]]; then
    SOFFICE_BIN="${candidate}"
    break
  fi
done

CHROMIUM_BIN=""
for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
  if [[ -x "${candidate}" ]]; then
    CHROMIUM_BIN="${candidate}"
    break
  fi
done

ENV_FILE="${ROOT_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  log "Writing ${ENV_FILE} from .env.example..."
  if [[ -f "${ROOT_DIR}/.env.example" ]]; then
    cp "${ROOT_DIR}/.env.example" "${ENV_FILE}"
  else
    touch "${ENV_FILE}"
  fi
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

set_env NODE_ENV production
set_env STORAGE_DRIVER fs
set_env STORAGE_FS_ROOT /var/lib/pdf-service/objects
set_env PDF_TEMP_DIR /var/lib/pdf-service/tmp
set_env GOTENBERG_URL http://127.0.0.1:3000
set_env GOTENBERG_REQUIRED true
if [[ -x "${GOTENBERG_BIN}" ]]; then
  set_env GOTENBERG_BIN "${GOTENBERG_BIN}"
fi
if [[ -n "${SOFFICE_BIN}" ]]; then
  set_env LIBREOFFICE_BIN_PATH "${SOFFICE_BIN}"
fi
if [[ -x "${UNOCONVERTER_BIN}" ]]; then
  set_env UNOCONVERTER_BIN_PATH "${UNOCONVERTER_BIN}"
fi
if [[ -n "${CHROMIUM_BIN}" ]]; then
  set_env CHROMIUM_BIN_PATH "${CHROMIUM_BIN}"
fi

install -d -m 0755 /var/lib/pdf-service/objects /var/lib/pdf-service/tmp
if id -u "${APP_USER}" >/dev/null 2>&1 && [[ "${APP_USER}" != "root" ]]; then
  chown -R "${APP_USER}:${APP_USER}" /var/lib/pdf-service
  chown "${APP_USER}:${APP_USER}" "${ENV_FILE}" || true
fi

if [[ -f "${ROOT_DIR}/package.json" ]]; then
  log "Installing npm dependencies as ${APP_USER}..."
  if [[ "${APP_USER}" != "root" ]] && id -u "${APP_USER}" >/dev/null 2>&1; then
    sudo -u "${APP_USER}" bash -lc "cd '${ROOT_DIR}' && corepack enable >/dev/null 2>&1 || true; yarn install"
  else
    (cd "${ROOT_DIR}" && yarn install)
  fi
fi

SYSTEMD_UNIT="${ROOT_DIR}/scripts/systemd/pdf-converter.service"
if [[ -f "${SYSTEMD_UNIT}" ]] && command -v systemctl >/dev/null 2>&1; then
  NODE_BIN="$(command -v node || echo /usr/bin/node)"
  APP_GROUP="$(id -gn "${APP_USER}" 2>/dev/null || echo "${APP_USER}")"
  sed \
    -e "s|/opt/pdf-converter-api|${ROOT_DIR}|g" \
    -e "s|User=pdf|User=${APP_USER}|g" \
    -e "s|Group=pdf|Group=${APP_GROUP}|g" \
    -e "s|/usr/bin/node|${NODE_BIN}|g" \
    "${SYSTEMD_UNIT}" > /etc/systemd/system/pdf-converter.service
  systemctl daemon-reload
  log "Installed systemd unit pdf-converter.service (not enabled). Start with: systemctl enable --now pdf-converter"
fi

cat <<EOF

Linux host is ready for Gotenberg-level conversion without Docker at runtime.

  PostgreSQL   localhost:5432  pdf/pdf  db=pdf_service
  Redis        localhost:6379
  Storage      STORAGE_DRIVER=fs  (/var/lib/pdf-service/objects)
  Gotenberg    ${GOTENBERG_BIN:-not installed}
  App env      ${ENV_FILE}

From the repo:

  yarn prisma:migrate
  yarn build
  yarn start

yarn start launches the API, the worker, and local Gotenberg when GOTENBERG_BIN is set
and nothing is already listening on GOTENBERG_URL.

If Docker is available, yarn infra remains the preferred way to run Gotenberg.
EOF
