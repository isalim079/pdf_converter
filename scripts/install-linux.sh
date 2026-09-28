#!/usr/bin/env bash
set -euo pipefail

# Linux host install: LibreOffice, Chromium, and conversion fonts. No Docker, no Gotenberg.

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
  die "This script is for Linux hosts."
fi

if [[ ! -f /etc/os-release ]]; then
  die "Cannot detect the Linux distribution."
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  debian:*|ubuntu:*|*:debian*|*:ubuntu*) ;;
  *) die "Unsupported distribution '${ID:-unknown}'. Use Debian or Ubuntu, or install LibreOffice, Chromium, Noto/Bengali, and Liberation fonts yourself." ;;
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

log "Installing LibreOffice, Chromium, and conversion fonts..."

install_available \
  ca-certificates curl gnupg \
  libreoffice-writer libreoffice-calc libreoffice-impress \
  chromium chromium-browser \
  fonts-lohit-beng-bengali fonts-beng fonts-noto-core fonts-noto-ui-core \
  fonts-liberation fonts-liberation2 fonts-dejavu-core fonts-noto-color-emoji \
  fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-cjk

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  log "Installing Node.js 22 from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

corepack enable >/dev/null 2>&1 || true
fc-cache -f >/dev/null 2>&1 || true

SOFFICE_BIN=""
for candidate in /usr/bin/soffice /usr/lib/libreoffice/program/soffice /usr/bin/libreoffice; do
  if [[ -x "${candidate}" ]]; then
    SOFFICE_BIN="${candidate}"
    break
  fi
done

CHROMIUM_BIN=""
for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
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
set_env PDF_TEMP_DIR /tmp/pdf-service
set_env ENGINES_REQUIRED true
if [[ -n "${SOFFICE_BIN}" ]]; then
  set_env LIBREOFFICE_BIN "${SOFFICE_BIN}"
fi
if [[ -n "${CHROMIUM_BIN}" ]]; then
  set_env CHROMIUM_BIN "${CHROMIUM_BIN}"
fi

install -d -m 0755 /tmp/pdf-service
if id -u "${APP_USER}" >/dev/null 2>&1 && [[ "${APP_USER}" != "root" ]]; then
  chown "${APP_USER}:${APP_USER}" "${ENV_FILE}" || true
fi

cat <<EOF

Linux host is ready for native LibreOffice and Chromium conversion.

  LibreOffice  ${SOFFICE_BIN:-not found}
  Chromium     ${CHROMIUM_BIN:-not found}
  App env      ${ENV_FILE}

From the repo:

  yarn start
EOF
