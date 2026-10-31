#!/usr/bin/env bash
# CSP on the REAL pages, not just the two marketing routes.
#
#   BASE_URL=http://127.0.0.1:3400 bash scripts/csp-real-routes.sh
#
# It creates one throwaway guest project and one share link (test server only),
# then runs the CSP check against:
#   /                      — public landing page
#   /builder               — the heavy client-side app
#   /report/<uuid>         — owner view (needs the owner cookie)
#   /s/<token>             — live share link, no cookie
#   /s/<unknown>           — 404 path, must still carry the policy
#   /report/<unknown>      — 404 path, must still carry the policy
#
# The 404 paths matter: an error page that skips the policy is still a hole.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3400}"
export BASE_URL

OUT="$(npx tsx scripts/share-fixture.ts)"
OWNER_PATHS="$(printf '%s\n' "$OUT" | grep '^CSP_PATHS=' | cut -d= -f2-)"
COOKIE="$(printf '%s\n' "$OUT" | grep '^CSP_COOKIE=' | cut -d= -f2-)"
TOKEN="${OWNER_PATHS##*/s/}"

if [ -z "$OWNER_PATHS" ] || [ -z "$COOKIE" ]; then
  echo "fixture did not produce paths/cookie" >&2
  exit 1
fi

CSP_PATHS="/,/builder,${OWNER_PATHS},/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,/report/00000000-0000-4000-8000-000000000000" \
  CSP_COOKIE="$COOKIE" \
  CSP_EXPECT_404="/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,/report/00000000-0000-4000-8000-000000000000" \
  npx tsx scripts/csp-check.ts

echo "share token under test: /s/${TOKEN}"
