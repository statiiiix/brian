#!/usr/bin/env bash
# Store one connector OAuth app's credentials in the production Edge environment.
# Usage: set-connector-oauth.sh <PREFIX> <client_id>
# The client secret is read from a hidden prompt (TTY) or one line on stdin.
# Prefixes: GOOGLE SLACK NOTION ATLASSIAN MICROSOFT LINEAR GITHUB ASANA CLICKUP
#           ZENDESK INTERCOM HUBSPOT SALESFORCE GONG ZOOM
set -euo pipefail

PROJECT_REF="${BRIAN_SUPABASE_PROJECT_REF:-foydcrwyakpkisxtvzgr}"

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <PREFIX> <client_id>" >&2
  exit 1
fi

PREFIX=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')

if [ -t 0 ]; then
  printf 'Client secret (input hidden): ' >&2
  IFS= read -r -s CLIENT_SECRET
  printf '\n' >&2
else
  IFS= read -r CLIENT_SECRET
fi

if [ -z "$CLIENT_SECRET" ]; then
  echo "client secret is required" >&2
  exit 1
fi

printf '%s=%s\n%s=%s\n' \
  "${PREFIX}_CLIENT_ID" "$2" \
  "${PREFIX}_CLIENT_SECRET" "$CLIENT_SECRET" \
  | supabase secrets set --project-ref "$PROJECT_REF" --env-file /dev/stdin
unset CLIENT_SECRET

echo "Stored ${PREFIX}_CLIENT_ID / ${PREFIX}_CLIENT_SECRET on project ${PROJECT_REF}."
echo "Configuration stored. Authorization remains disabled until dated production verification."
