#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  deploy.sh — deploy the VijayMaruthi BACKEND to Vercel
#
#  Creates / links a Vercel project (default name: vijaymaruthi-backend)
#  in your account, syncs the shared engine modules, sets environment
#  variables, and deploys to production.
#
#  Usage:  ./deploy.sh
#  First run: a browser opens for `vercel login` — sign in, then re-run.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_NAME="${VERCEL_PROJECT_NAME:-vijaymaruthi-backend}"

echo "════════ VijayMaruthi BACKEND → Vercel ════════"

# ── 1. Login (first time only) ──
if ! npx vercel whoami >/dev/null 2>&1; then
  echo "→ Vercel login required — a browser window will open. Sign in, then re-run this script."
  npx vercel login
fi

# ── 2. Sync shared engine modules from the repo root ──
echo "→ Syncing shared engine modules into lib/ …"
python3 sync-lib.py

# ── 3. Link / create the project ──
if [ ! -f ".vercel/project.json" ]; then
  echo "→ Creating/linking Vercel project: $PROJECT_NAME"
  npx vercel link --project "$PROJECT_NAME" --yes
fi

# ── 4. Environment variables (production) ──
set_env() {
  local name="$1" value="$2"
  npx vercel env rm "$name" production -y >/dev/null 2>&1 || true
  printf '%s' "$value" | npx vercel env add "$name" production >/dev/null
  echo "  env: $name ✓"
}

echo "→ Setting environment variables (production)…"
set_env VM_SHARE_DIR "/tmp"
set_env CACHE_TTL_HOURS "6"
set_env DASHBOARD_CACHE_TTL "30"
# Allow the deployed frontend to call this API (comma-separated origins)
set_env CORS_ORIGINS "https://vijaymaruthi.vercel.app,https://frontend.vercel.app"

# ── 5. Deploy ──
echo "→ Deploying to production (first build takes a few minutes — large Python deps)…"
npx vercel --prod --yes

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Backend live at: https://$PROJECT_NAME.vercel.app"
echo "     Health check:    https://$PROJECT_NAME.vercel.app/api/v1/health"
echo ""
echo "  Next: point the frontend at this backend — in the frontend's"
echo "  Vercel project set NEXT_PUBLIC_API_URL to:"
echo "     https://$PROJECT_NAME.vercel.app/api/v1"
echo "═══════════════════════════════════════════════════════════"
