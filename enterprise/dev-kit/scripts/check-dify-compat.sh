#!/bin/bash
# check-dify-compat.sh
#
# Verifies that the Dify submodule (or a target semver string) is within
# the version bounds declared in dify-dev.yaml, then runs contract tests.
#
# Usage (called by CI or manually before an upgrade):
#   ./check-dify-compat.sh [<sha-or-semver>]
#
# If the argument is a git SHA it compares submodule commits.
# If it is a semver string (e.g. "1.14.0") it validates against minVersion/maxVersion.
#
# Exit codes:
#   0 — version within bounds, contract tests passed
#   1 — version out of bounds or contract tests failed

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
DEVKIT_DIR="${REPO_ROOT}/enterprise/dev-kit"
CONFIG_FILE="${DEVKIT_DIR}/dify-dev.yaml"
PINNED_SHA=$(awk '{print $1}' "${REPO_ROOT}/DIFY_VERSION")

TARGET="${1:-}"

# ─────────────────────────────────────────────────────────────
# Helper: parse a field from dify-dev.yaml without yq dependency
# ─────────────────────────────────────────────────────────────
read_config_field() {
  local field="$1"
  grep -E "^\s+${field}:" "${CONFIG_FILE}" 2>/dev/null \
    | head -1 \
    | sed -E 's/.*:\s*"?([^"#]+)"?.*/\1/' \
    | tr -d '[:space:]'
}

MIN_VERSION=$(read_config_field "minVersion")
MAX_VERSION=$(read_config_field "maxVersion")

echo "────────────────────────────────────────────────"
echo "Dify Compatibility Check"
echo "  Pinned SHA  : ${PINNED_SHA}"
echo "  Min version : ${MIN_VERSION:-<unset>}"
echo "  Max version : ${MAX_VERSION:-<unset>}"
echo "  Target arg  : ${TARGET:-<none, using submodule SHA>}"
echo "────────────────────────────────────────────────"

# ─────────────────────────────────────────────────────────────
# Semver comparison: returns 0 (true) if $1 <= $2 segment-by-segment.
# "x" in a segment is treated as a wildcard (matches any value).
# ─────────────────────────────────────────────────────────────
semver_lte() {
  local a="$1" b="$2"
  IFS='.' read -r -a va <<< "${a//x/9999}"
  IFS='.' read -r -a vb <<< "${b//x/9999}"
  for i in 0 1 2; do
    local ai="${va[$i]:-0}" bi="${vb[$i]:-0}"
    if (( ai < bi )); then return 0; fi
    if (( ai > bi )); then return 1; fi
  done
  return 0  # equal
}

# ─────────────────────────────────────────────────────────────
# Semver validation when a version string is passed directly
# ─────────────────────────────────────────────────────────────
if [[ "${TARGET}" =~ ^[0-9]+\.[0-9]+ ]]; then
  echo "Validating semver target: ${TARGET}"

  if [[ -n "${MIN_VERSION}" ]]; then
    if ! semver_lte "${MIN_VERSION}" "${TARGET}"; then
      echo ""
      echo "ERROR: Dify ${TARGET} is below the required minimum version ${MIN_VERSION}."
      echo "       Upgrade Dify to >= ${MIN_VERSION} or lower minVersion in dify-dev.yaml."
      exit 1
    fi
    echo "  ✓ ${TARGET} >= ${MIN_VERSION} (minVersion OK)"
  fi

  if [[ -n "${MAX_VERSION}" ]]; then
    if ! semver_lte "${TARGET}" "${MAX_VERSION}"; then
      echo "  ⚠ ${TARGET} exceeds validated maxVersion ${MAX_VERSION} — contract tests required."
    else
      echo "  ✓ ${TARGET} <= ${MAX_VERSION} (maxVersion OK)"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────
# SHA-based check: compare submodule HEAD to pinned commit
# ─────────────────────────────────────────────────────────────
if [[ -z "${TARGET}" ]] || [[ "${TARGET}" =~ ^[0-9a-f]{7,40}$ ]]; then
  CURRENT_SHA="${TARGET:-}"
  if [[ -z "${CURRENT_SHA}" ]]; then
    CURRENT_SHA=$(git -C "${REPO_ROOT}/dify" rev-parse HEAD 2>/dev/null || echo "uninitialized")
  fi

  if [[ "${CURRENT_SHA}" == "${PINNED_SHA}" ]]; then
    echo "Dify submodule is at pinned version. No compatibility check needed."
    exit 0
  fi

  echo ""
  echo "WARNING: Dify submodule (${CURRENT_SHA}) differs from pinned version (${PINNED_SHA})."
  echo "Running contract tests to verify compatibility..."
fi

# ─────────────────────────────────────────────────────────────
# Run contract tests — this is the authoritative compatibility gate
# ─────────────────────────────────────────────────────────────
echo ""
cd "${DEVKIT_DIR}"
npm run test -- --testPathPattern=contract --runInBand --forceExit

echo ""
echo "✓ Contract tests PASSED. Version is compatible."
if [[ -n "${TARGET:-}" ]] && [[ "${TARGET}" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo ""
  echo "To accept the upgrade, update DIFY_VERSION:"
  echo "  echo '${TARGET} # dify@upgraded-$(date +%Y-%m-%d)' > ${REPO_ROOT}/DIFY_VERSION"
fi
