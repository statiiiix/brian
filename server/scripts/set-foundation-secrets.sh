#!/usr/bin/env bash
# One-time foundation for connector OAuth: pushes CONNECTOR_ENCRYPTION_KEY from
# the gitignored server/.env (plus the public base URL) to the production Edge
# environment. Safe to re-run; values are idempotent.
set -euo pipefail

PROJECT_REF="${BRIAN_SUPABASE_PROJECT_REF:-foydcrwyakpkisxtvzgr}"
ENV_FILE="$(dirname "$0")/../.env"

KEY=$(grep '^CONNECTOR_ENCRYPTION_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2)
if [ -z "$KEY" ]; then
  echo "CONNECTOR_ENCRYPTION_KEY not found in $ENV_FILE" >&2
  exit 1
fi

supabase secrets set --project-ref "$PROJECT_REF" \
  "BRIAN_OAUTH_BASE_URL=https://brianthebrain.app" \
  "CONNECTOR_ENCRYPTION_KEY=$KEY"

echo "Foundation secrets set on ${PROJECT_REF}."
