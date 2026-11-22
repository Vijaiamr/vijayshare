#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  deploy-vercel.sh — deploy the VijayMaruthi frontend to Vercel (free)
#
#  Does everything:
#    1. Vercel login (browser opens — only the first time)
#    2. Reads Supabase URL + service key from sync/.env
#    3. Generates & stores an APP_TOKEN (sync/.app_token)
#    4. Sets all environment variables for production
#    5. Deploys with `vercel --prod`
#
#  Usage:
#    ./deploy-vercel.sh
#
#  Prerequisites: sync/.env filled in (cp .env.example .env)
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
SYNC_ENV="$ROOT/sync/.env"
TOKEN_FILE="$ROOT/sync/.app_token"

echo "════════ VijayMaruthi → Vercel deploy ════════"

# ── 1. Login (first time only) ──
if ! npx vercel whoami >/dev/null 2>&1; then
  echo "→ Vercel login required — a browser window will open. Sign in, then return here."
  npx vercel login || { echo "✗ Login failed"; exit 1; }
fi

# ── 2. Require Supabase config ──
if [ ! -f "$SYNC_ENV" ]; then
  echo "✗ $SYNC_ENV not found."
  echo "  Run: cp $ROOT/sync/.env.example $SYNC_ENV"
  echo "  Then paste your Supabase project URL and service_role key into it."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SYNC_ENV"
set +a

[ -n "${SUPABASE_URL:-}" ] || { echo "✗ SUPABASE_URL is missing in $SYNC_ENV"; exit 1; }
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || { echo "✗ SUPABASE_SERVICE_ROLE_KEY is missing in $SYNC_ENV"; exit 1; }

# ── 3. APP_TOKEN (generate once, reuse) ──
if [ -f "$TOKEN_FILE" ]; then
  APP_TOKEN="$(cat "$TOKEN_FILE")"
else
  APP_TOKEN="$(openssl rand -hex 24)"
  printf '%s' "$APP_TOKEN" > "$TOKEN_FILE"
  echo "→ Generated APP_TOKEN → saved to $TOKEN_FILE (keep it safe)"
fi

cd "$FRONTEND"

# ── 4. Link / create the Vercel project ──
if [ -f ".vercel/project.json" ]; then
  echo "→ Project already linked: $(grep -o '"projectName":"[^"]*"' .vercel/project.json)"
else
  echo "→ Linking project (first time: accept the defaults, choose your team/account)…"
  npx vercel link || { echo "✗ Link failed — run 'npx vercel link' manually in $FRONTEND"; exit 1; }
fi

# ── 5. Environment variables (production) ──
set_env() {
  local name="$1" value="$2"
  npx vercel env rm "$name" production -y >/dev/null 2>&1 || true
  printf '%s' "$value" | npx vercel env add "$name" production >/dev/null
  echo "  env: $name ✓"
}

echo "→ Setting environment variables (production)…"
set_env NEXT_PUBLIC_DATA_MODE "supabase"
set_env NEXT_PUBLIC_APP_TOKEN "$APP_TOKEN"
set_env APP_TOKEN "$APP_TOKEN"
set_env SUPABASE_URL "$SUPABASE_URL"
set_env SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"

# ── 6. Deploy ──
echo "→ Deploying to production (first build takes a few minutes)…"
npx vercel --prod --yes

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Done! Your app is live at:"
echo "     https://vijaymaruthi.vercel.app"
echo "     (deployment: $(grep -o '"projectName":"[^"]*"' .vercel/project.json | cut -d'"' -f4)-$(date +%H%M%S).vercel.app)"
echo "═══════════════════════════════════════════════════════════"
