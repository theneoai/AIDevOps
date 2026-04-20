#!/bin/bash
# check-dify-compat.sh
# Run this script before upgrading the Dify submodule.
# It verifies the new Dify version is compatible with DevKit by running contract tests.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CURRENT_SHA=$(git -C "${REPO_ROOT}/dify" rev-parse HEAD 2>/dev/null || echo "uninitialized")
PINNED_SHA=$(cat "${REPO_ROOT}/DIFY_VERSION" | awk '{print $1}')

echo "Pinned SHA : ${PINNED_SHA}"
echo "Current SHA: ${CURRENT_SHA}"

if [ "${CURRENT_SHA}" = "${PINNED_SHA}" ]; then
  echo "Dify submodule is at pinned version. No compatibility check needed."
  exit 0
fi

echo ""
echo "WARNING: Dify submodule (${CURRENT_SHA}) differs from pinned version (${PINNED_SHA})."
echo "Running contract tests to verify compatibility..."
echo ""

cd "${REPO_ROOT}/enterprise/dev-kit"
npm run test -- --testPathPattern=contract --runInBand --forceExit

echo ""
echo "Contract tests PASSED."
echo "To accept the upgrade, update DIFY_VERSION:"
echo "  echo '${CURRENT_SHA} # dify@upgraded-$(date +%Y-%m-%d)' > ${REPO_ROOT}/DIFY_VERSION"
