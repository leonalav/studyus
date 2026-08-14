#!/usr/bin/env bash
# Install the latest Studyus macOS release and open it.
# Usage:
#   curl -fsSL https://github.com/leonalav/studyus/releases/latest/download/install.sh | bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly APP_NAME="Studyus"
readonly REPO="leonalav/studyus"
readonly RELEASE_BASE_URL="${STUDYUS_RELEASE_BASE_URL:-https://github.com/${REPO}/releases/latest/download}"
readonly ZIP_NAME="Studyus-macOS.zip"
readonly CHECKSUM_NAME="${ZIP_NAME}.sha256"
readonly INSTALL_DIR="${STUDYUS_INSTALL_DIR:-/Applications}"
readonly APP_PATH="${INSTALL_DIR}/${APP_NAME}.app"

TMP_DIR=""
STAGED_APP=""
BACKUP_APP=""
USE_SUDO=0

info() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

run_as_admin() {
  if [[ "${USE_SUDO}" -eq 1 ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

cleanup() {
  local status=$?

  if [[ -n "${BACKUP_APP}" && -e "${BACKUP_APP}" && ! -e "${APP_PATH}" ]]; then
    run_as_admin mv -- "${BACKUP_APP}" "${APP_PATH}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${STAGED_APP}" && -e "${STAGED_APP}" ]]; then
    run_as_admin rm -rf -- "${STAGED_APP}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf -- "${TMP_DIR}" >/dev/null 2>&1 || true
  fi

  exit "${status}"
}

trap cleanup EXIT
trap 'exit 130' HUP INT TERM

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer only supports macOS."

for command_name in curl ditto shasum xattr open; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "Required command not found: ${command_name}"
done

if [[ ! -d "${INSTALL_DIR}" ]]; then
  if ! mkdir -p -- "${INSTALL_DIR}" 2>/dev/null; then
    command -v sudo >/dev/null 2>&1 || fail "Cannot create ${INSTALL_DIR}; administrator access is required."
    USE_SUDO=1
    info "Administrator access is required to create ${INSTALL_DIR}."
    sudo -v
    run_as_admin mkdir -p -- "${INSTALL_DIR}"
  fi
elif [[ ! -w "${INSTALL_DIR}" ]]; then
  command -v sudo >/dev/null 2>&1 || fail "Cannot write to ${INSTALL_DIR}; administrator access is required."
  USE_SUDO=1
  info "Administrator access is required to install in ${INSTALL_DIR}."
  sudo -v
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/studyus-install.XXXXXX")"
readonly TMP_DIR
readonly ZIP_PATH="${TMP_DIR}/${ZIP_NAME}"
readonly CHECKSUM_PATH="${TMP_DIR}/${CHECKSUM_NAME}"
readonly EXTRACT_DIR="${TMP_DIR}/extracted"

info "Downloading ${APP_NAME}..."
curl -fL --retry 3 --connect-timeout 15 --progress-bar \
  "${RELEASE_BASE_URL}/${ZIP_NAME}" -o "${ZIP_PATH}"
curl -fL --retry 3 --connect-timeout 15 --progress-bar \
  "${RELEASE_BASE_URL}/${CHECKSUM_NAME}" -o "${CHECKSUM_PATH}"

info "Verifying download..."
expected_checksum="$(awk 'NR == 1 { print $1 }' "${CHECKSUM_PATH}")"
actual_checksum="$(shasum -a 256 "${ZIP_PATH}" | awk '{ print $1 }')"
[[ "${expected_checksum}" =~ ^[[:xdigit:]]{64}$ ]] || fail "The release checksum is malformed."
[[ "${actual_checksum}" == "${expected_checksum}" ]] || fail "The downloaded archive failed its SHA-256 check."

mkdir -p -- "${EXTRACT_DIR}"
ditto -x -k "${ZIP_PATH}" "${EXTRACT_DIR}"
readonly SOURCE_APP="${EXTRACT_DIR}/${APP_NAME}.app"
[[ -d "${SOURCE_APP}" ]] || fail "The release archive does not contain ${APP_NAME}.app."
[[ -f "${SOURCE_APP}/Contents/Info.plist" ]] || fail "The release archive does not contain a valid macOS app bundle."

info "Installing to ${APP_PATH}..."
STAGED_APP="${INSTALL_DIR}/.${APP_NAME}.app.install.$$"
BACKUP_APP="${INSTALL_DIR}/.${APP_NAME}.app.backup.$$"

run_as_admin rm -rf -- "${STAGED_APP}" "${BACKUP_APP}"
run_as_admin ditto "${SOURCE_APP}" "${STAGED_APP}"

# Command-line downloads normally have no quarantine attribute. Clear any
# residual extended attributes before launch as an additional safeguard.
run_as_admin xattr -cr "${STAGED_APP}" 2>/dev/null || true

if [[ -e "${APP_PATH}" ]]; then
  run_as_admin mv -- "${APP_PATH}" "${BACKUP_APP}"
fi

if run_as_admin mv -- "${STAGED_APP}" "${APP_PATH}"; then
  STAGED_APP=""
  if [[ -e "${BACKUP_APP}" ]]; then
    run_as_admin rm -rf -- "${BACKUP_APP}"
  fi
  BACKUP_APP=""
else
  warn "Could not put the new app in place; restoring the previous installation."
  if [[ -e "${BACKUP_APP}" ]]; then
    run_as_admin mv -- "${BACKUP_APP}" "${APP_PATH}" || true
  fi
  fail "Installation failed."
fi

info "${APP_NAME} installed successfully!"
if ! open "${APP_PATH}"; then
  warn "${APP_NAME} was installed, but it could not be opened automatically."
  warn "Open it manually from ${APP_PATH}."
fi
