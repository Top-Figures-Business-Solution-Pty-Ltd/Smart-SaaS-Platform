#!/usr/bin/env bash
set -euo pipefail

SITE_NAME="${1:-}"
EXPECTED_BRANCH="${EXPECTED_BRANCH:-main}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BENCH_DIR="${BENCH_DIR:-$(cd "${APP_DIR}/../.." && pwd)}"

failures=0

info() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*"
}

fail() {
  printf '[FAIL] %s\n' "$*"
  failures=$((failures + 1))
}

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing command: $1"
  fi
}

info "Smart Accounting production preflight"
info "This script is read-only. It does not pull, migrate, build, restart, or write backups."

check_cmd git
check_cmd bench

if [ ! -d "${APP_DIR}/.git" ]; then
  fail "App directory is not a git repository: ${APP_DIR}"
else
  info "App directory: ${APP_DIR}"
fi

if [ ! -d "${BENCH_DIR}/sites" ] || [ ! -d "${BENCH_DIR}/apps" ]; then
  fail "Bench directory does not look valid: ${BENCH_DIR}"
else
  info "Bench directory: ${BENCH_DIR}"
fi

if [ -z "${SITE_NAME}" ]; then
  fail "Site name is required. Usage: bash ops/release/production-preflight.sh [site-name]"
elif [ ! -f "${BENCH_DIR}/sites/${SITE_NAME}/site_config.json" ]; then
  fail "Site config not found: ${BENCH_DIR}/sites/${SITE_NAME}/site_config.json"
else
  info "Site found: ${SITE_NAME}"
fi

if [ -d "${APP_DIR}/.git" ]; then
  current_branch="$(git -C "${APP_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  current_sha="$(git -C "${APP_DIR}" rev-parse --short HEAD 2>/dev/null || true)"
  info "Current branch: ${current_branch:-unknown}"
  info "Current commit: ${current_sha:-unknown}"

  if [ "${current_branch}" != "${EXPECTED_BRANCH}" ]; then
    warn "Expected production branch '${EXPECTED_BRANCH}', but current branch is '${current_branch:-unknown}'."
  fi

  if [ -n "$(git -C "${APP_DIR}" status --short)" ]; then
    fail "App repository has uncommitted changes. Review them before production deployment."
    git -C "${APP_DIR}" status --short
  else
    info "App repository is clean."
  fi

  if git -C "${APP_DIR}" rev-parse --verify "origin/${EXPECTED_BRANCH}" >/dev/null 2>&1; then
    ahead_behind="$(git -C "${APP_DIR}" rev-list --left-right --count "HEAD...origin/${EXPECTED_BRANCH}" 2>/dev/null || true)"
    if [ -n "${ahead_behind}" ]; then
      info "HEAD vs origin/${EXPECTED_BRANCH}: ${ahead_behind} (left=ahead, right=behind)"
    fi
  else
    warn "origin/${EXPECTED_BRANCH} is not available locally. Run git fetch manually if needed."
  fi
fi

if [ "${failures}" -gt 0 ]; then
  fail "Preflight found ${failures} blocking issue(s). Stop and fix them before deploying."
  exit 1
fi

cat <<EOF

[OK] Preflight checks passed.

Recommended manual deployment sequence:

  cd ${BENCH_DIR}
  bench --site ${SITE_NAME} backup --with-files
  git -C apps/smart_accounting pull --ff-only origin ${EXPECTED_BRANCH}
  bench setup requirements
  bench --site ${SITE_NAME} migrate
  bench build --app smart_accounting
  bench restart
  bench --site ${SITE_NAME} clear-cache

After deployment, run the smoke test in:
  project-docs/system/production-deployment-safety-checklist.md

EOF
