#!/usr/bin/env bash
# One-time foundation secrets: pushes values from the gitignored server/.env to
# the production Edge environment. Safe to re-run; values are idempotent.
#
# Includes DATABASE_URL when present in server/.env. Setting DATABASE_URL to the
# brian_app *pooler* URL is what stops the intermittent "DATABASE_URL is not set"
# error: it gives every edge isolate a stable connection string instead of
# depending on the platform-injected SUPABASE_DB_URL (which is the direct, IPv6,
# `postgres`-owner connection — it bypasses RLS and can be briefly absent on a
# cold-started isolate). Get the URL from the Supabase dashboard:
#   Project Settings -> Database -> Connection string -> Session pooler,
# then swap the user for brian_app, e.g.
#   DATABASE_URL=postgresql://brian_app:<PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
# (brian_app's password is set out-of-band: `alter role brian_app login password '…'`.)
# After running this, redeploy so the new secret is picked up cleanly:
#   npm --prefix server run edge:build && supabase functions deploy brian --project-ref <ref>
set -euo pipefail

PROJECT_REF="${BRIAN_SUPABASE_PROJECT_REF:-foydcrwyakpkisxtvzgr}"
ENV_FILE="$(dirname "$0")/../.env"

KEY=$(grep '^CONNECTOR_ENCRYPTION_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2)
if [ -z "$KEY" ]; then
  echo "CONNECTOR_ENCRYPTION_KEY not found in $ENV_FILE" >&2
  exit 1
fi

# -f2- (not -f2) so connection strings containing '=' (e.g. ?sslmode=require)
# survive intact. Empty when the line is absent; grep's non-zero exit is masked
# by the trailing cut, so `set -e` does not abort.
DB_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)

ARGS=(
  "BRIAN_OAUTH_BASE_URL=https://brianthebrain.app"
  "CONNECTOR_ENCRYPTION_KEY=$KEY"
)
if [ -n "${DB_URL:-}" ]; then
  ARGS+=("DATABASE_URL=$DB_URL")
  echo "Including DATABASE_URL (brian_app pooler) in the secrets push."
else
  echo "NOTE: no DATABASE_URL in $ENV_FILE. The edge will keep falling back to" >&2
  echo "      SUPABASE_DB_URL (postgres owner, RLS-bypassing, occasionally-absent)." >&2
  echo "      Add DATABASE_URL to $ENV_FILE to fix the intermittent 'DATABASE_URL is" >&2
  echo "      not set' error and to enforce RLS at the database. See the header above." >&2
fi

supabase secrets set --project-ref "$PROJECT_REF" "${ARGS[@]}"

echo "Foundation secrets set on ${PROJECT_REF}."
