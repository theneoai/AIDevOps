#!/usr/bin/env bash
# ==================================================================
# init-secrets.sh — Initialize the secrets/ directory
#
# Creates placeholder files for Docker Secrets.
# Edit each file and replace the placeholder with the real value.
#
# Usage:
#   bash scripts/init-secrets.sh
#   # Then edit secrets/ files:
#   echo "your-real-secret" > secrets/wechat_app_secret.txt
# ==================================================================

set -euo pipefail

SECRETS_DIR="$(dirname "$0")/../secrets"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

declare -A SECRETS=(
  ["wechat_app_secret.txt"]="REPLACE_WITH_WECHAT_APP_SECRET"
  ["dify_db_password.txt"]="REPLACE_WITH_DIFY_DB_PASSWORD"
  ["feishu_app_secret.txt"]="REPLACE_WITH_FEISHU_APP_SECRET"
  ["dingtalk_app_secret.txt"]="REPLACE_WITH_DINGTALK_APP_SECRET"
)

created=0
skipped=0

for file in "${!SECRETS[@]}"; do
  target="$SECRETS_DIR/$file"
  if [ -f "$target" ]; then
    echo "  [skip]    $file (already exists)"
    ((skipped++)) || true
  else
    echo "${SECRETS[$file]}" > "$target"
    chmod 600 "$target"
    echo "  [created] $file"
    ((created++)) || true
  fi
done

echo ""
echo "Done. $created created, $skipped skipped."
echo ""
echo "Next steps:"
echo "  1. Edit each file in $SECRETS_DIR/ with the real secret value"
echo "  2. Never commit the secrets/ directory (already in .gitignore)"
echo ""
echo "Example:"
echo "  echo 'your-real-wechat-secret' > secrets/wechat_app_secret.txt"
echo ""
echo "For standalone mode (no Docker Secrets), use .env instead:"
echo "  cp .env.example .env && edit .env"
