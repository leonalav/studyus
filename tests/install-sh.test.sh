#!/usr/bin/env bash
# Dependency-free tests for install.sh. The macOS utilities are mocked so the
# installer can also be checked from non-macOS development environments.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly INSTALLER="${REPO_ROOT}/install.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/studyus-installer-test.XXXXXX")"
readonly TEST_ROOT
readonly MOCK_BIN="${TEST_ROOT}/bin"
readonly MOCK_LOG="${TEST_ROOT}/mock.log"
readonly GOOD_CHECKSUM="1111111111111111111111111111111111111111111111111111111111111111"

cleanup() {
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$1"
}

mkdir -p "${MOCK_BIN}"

cat > "${MOCK_BIN}/uname" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "${MOCK_OS:-Darwin}"
MOCK

cat > "${MOCK_BIN}/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while (($#)); do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    http://*|https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
[[ -n "${output}" && -n "${url}" ]]
if [[ "${url}" == *.sha256 ]]; then
  printf '%s  Studyus-macOS.zip\n' "${MOCK_RELEASE_CHECKSUM:-1111111111111111111111111111111111111111111111111111111111111111}" > "${output}"
else
  printf 'mock Studyus archive\n' > "${output}"
fi
MOCK

cat > "${MOCK_BIN}/shasum" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
file="${@: -1}"
printf '%s  %s\n' '1111111111111111111111111111111111111111111111111111111111111111' "${file}"
MOCK

cat > "${MOCK_BIN}/ditto" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-x" ]]; then
  destination="${@: -1}"
  mkdir -p "${destination}/Studyus.app/Contents"
  printf 'new app\n' > "${destination}/Studyus.app/Contents/Info.plist"
  printf 'new installation\n' > "${destination}/Studyus.app/new-marker"
else
  source_path="$1"
  destination="$2"
  cp -R "${source_path}" "${destination}"
fi
MOCK

cat > "${MOCK_BIN}/xattr" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'xattr %s\n' "$*" >> "${MOCK_LOG}"
MOCK

cat > "${MOCK_BIN}/open" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ -d "$1" ]]
printf 'open %s\n' "$1" >> "${MOCK_LOG}"
MOCK

chmod +x "${MOCK_BIN}"/*

run_installer() {
  local install_dir="$1"
  shift
  env \
    PATH="${MOCK_BIN}:${PATH}" \
    MOCK_LOG="${MOCK_LOG}" \
    STUDYUS_INSTALL_DIR="${install_dir}" \
    STUDYUS_RELEASE_BASE_URL="https://example.invalid/releases/latest/download" \
    "$@" \
    bash -s < "${INSTALLER}"
}

# A clean install verifies, extracts, installs, removes attributes, and opens.
install_dir="${TEST_ROOT}/clean/Applications"
mkdir -p "${install_dir}"
output="$(run_installer "${install_dir}" 2>&1)"
[[ "${output}" == *"Studyus installed successfully!"* ]] || fail "clean install did not report success"
[[ -f "${install_dir}/Studyus.app/new-marker" ]] || fail "clean install did not copy the app"
grep -Fq "xattr -cr ${install_dir}/.Studyus.app.install." "${MOCK_LOG}" || fail "clean install did not clear attributes"
grep -Fq "open ${install_dir}/Studyus.app" "${MOCK_LOG}" || fail "clean install did not launch the app"
pass "clean install and launch"

# Updating replaces the complete bundle rather than merging files into it.
install_dir="${TEST_ROOT}/update/Applications"
mkdir -p "${install_dir}/Studyus.app/Contents"
printf 'stale\n' > "${install_dir}/Studyus.app/stale-marker"
run_installer "${install_dir}" >/dev/null 2>&1
[[ -f "${install_dir}/Studyus.app/new-marker" ]] || fail "update did not install the new app"
[[ ! -e "${install_dir}/Studyus.app/stale-marker" ]] || fail "update retained a stale file"
if compgen -G "${install_dir}/.Studyus.app.install.*" >/dev/null ||
  compgen -G "${install_dir}/.Studyus.app.backup.*" >/dev/null; then
  fail "update left staging files behind"
fi
pass "existing installation is replaced cleanly"

# A corrupt download must leave an existing installation untouched.
install_dir="${TEST_ROOT}/checksum/Applications"
mkdir -p "${install_dir}/Studyus.app/Contents"
printf 'existing\n' > "${install_dir}/Studyus.app/existing-marker"
if run_installer "${install_dir}" MOCK_RELEASE_CHECKSUM="${GOOD_CHECKSUM%?}2" >"${TEST_ROOT}/checksum.out" 2>&1; then
  fail "checksum mismatch unexpectedly succeeded"
fi
grep -Fq "failed its SHA-256 check" "${TEST_ROOT}/checksum.out" || fail "checksum mismatch was not explained"
[[ -f "${install_dir}/Studyus.app/existing-marker" ]] || fail "checksum mismatch changed the existing app"
pass "checksum mismatch is rejected safely"

# Avoid presenting a macOS installer as usable on another operating system.
install_dir="${TEST_ROOT}/other-os/Applications"
mkdir -p "${install_dir}"
if run_installer "${install_dir}" MOCK_OS=Linux >"${TEST_ROOT}/os.out" 2>&1; then
  fail "non-macOS invocation unexpectedly succeeded"
fi
grep -Fq "only supports macOS" "${TEST_ROOT}/os.out" || fail "non-macOS error was not explained"
pass "non-macOS systems are rejected"

printf 'All install.sh tests passed.\n'
