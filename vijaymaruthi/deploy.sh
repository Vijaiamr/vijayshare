#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  deploy.sh — unified VijayMaruthi deployment (frontend + backend → Vercel)
#
#  Orchestrates the full production deployment:
#    1. Pre-flight checks  — Vercel login, Supabase config, TS check, build
#    2. Frontend deploy    — env vars + `vercel --prod` (supabase mode)
#    3. Backend deploy     — sync engine libs + env vars + `vercel --prod`
#    4. Verification       — backend health check + frontend page load
#
#  Usage:
#    ./deploy.sh                     # full deploy (frontend + backend)
#    ./deploy.sh --frontend-only     # deploy only the frontend
#    ./deploy.sh --backend-only      # deploy only the backend
#    ./deploy.sh --skip-build        # skip the local TS/build verification
#    ./deploy.sh --sync              # push local SQLite → Supabase first
#    ./deploy.sh --commit "msg"      # git-commit the working tree first
#
#  Prerequisites: sync/.env filled in (cp sync/.env.example sync/.env)
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND_DEPLOY="$ROOT/vercel-backend"
SYNC_ENV="$ROOT/sync/.env"
TOKEN_FILE="$ROOT/sync/.app_token"

# ── Flags ──
DO_FRONTEND=1
DO_BACKEND=1
DO_BUILD=1
DO_SYNC=0
COMMIT_MSG=""

for arg in "$@"; do
  case "$arg" in
    --frontend-only) DO_BACKEND=0 ;;
    --backend-only)  DO_FRONTEND=0 ;;
    --skip-build)    DO_BUILD=0 ;;
    --sync)          DO_SYNC=1 ;;
    --commit)        COMMIT_MSG="deploy: $(date +%Y-%m-%d) snapshot" ;;
    --commit=*)      COMMIT_MSG="${arg#--commit=}" ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "✗ Unknown flag: $arg (see ./deploy.sh --help)"; exit 1 ;;
  esac
done

echo "════════ VijayMaruthi → Vercel deploy ════════"
echo "  frontend: $([ $DO_FRONTEND -eq 1 ] && echo YES || echo no)"
echo "  backend:  $([ $DO_BACKEND -eq 1 ] && echo YES || echo no)"
echo "  build:    $([ $DO_BUILD -eq 1 ] && echo verify || echo skip)"
echo ""

# ── 1. Pre-flight ──
echo "── Pre-flight ──"

# Vercel login
if ! npx vercel whoami >/dev/null 2>&1; then
  echo "→ Vercel login required — a browser window will open. Sign in, then re-run."
  npx vercel login || { echo "✗ Login failed"; exit 1; }
fi
echo "✓ Vercel: $(npx vercel whoami 2>/dev/null)"

# Supabase config (needed for frontend env vars)
if [ ! -f "$SYNC_ENV" ]; then
  echo "✗ $SYNC_ENV not found. Run: cp $ROOT/sync/.env.example $SYNC_ENV"; exit 1
fi
set -a; # shellcheck disable=SC1090
source "$SYNC_ENV"; set +a
[ -n "${SUPABASE_URL:-}" ] || { echo "✗ SUPABASE_URL missing in $SYNC_ENV"; exit 1; }
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || { echo "✗ SUPABASE_SERVICE_ROLE_KEY missing in $SYNC_ENV"; exit 1; }
echo "✓ Supabase config present"

# APP_TOKEN (generate once, reuse)
if [ -f "$TOKEN_FILE" ]; then
  APP_TOKEN="$(cat "$TOKEN_FILE")"
else
  APP_TOKEN="$(openssl rand -hex 24)"
  printf '%s' "$APP_TOKEN" > "$TOKEN_FILE"
  echo "→ Generated APP_TOKEN → saved to $TOKEN_FILE (keep it safe)"
fi

# Optional git snapshot
if [ -n "$COMMIT_MSG" ]; then
  echo "→ Committing working tree: $COMMIT_MSG"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -m "$COMMIT_MSG" || echo "  (nothing to commit)"
fi

# Optional data sync
if [ $DO_SYNC -eq 1 ]; then
  echo "→ Syncing local SQLite → Supabase…"
  python3 "$ROOT/sync/sync_to_supabase.py" || { echo "✗ Sync failed"; exit 1; }
fi

# ── 2. Frontend build verification ──
if [ $DO_FRONTEND -eq 1 ] && [ $DO_BUILD -eq 1 ]; then
  echo "── Frontend verification ──"
  cd "$FRONTEND"
  echo "→ TypeScript check…"
  npx tsc --noEmit || { echo "✗ tsc failed — fix before deploying"; exit 1; }
  echo "✓ tsc clean"
  echo "→ Production build…"
  npm run build || { echo "✗ build failed — fix before deploying"; exit 1; }
  echo "✓ build clean"
fi

# ── 3. Deploy frontend ──
if [ $DO_FRONTEND -eq 1 ]; then
  echo "── Deploying frontend → Vercel ──"
  cd "$FRONTEND"
  [ -f ".vercel/project.json" ] || { echo "✗ Frontend not linked. Run: npx vercel link"; exit 1; }
  PROJECT_NAME="$(grep -o '"projectName":"[^"]*"' .vercel/project.json | cut -d'"' -f4)"

  set_env() {
    local name="$1" value="$2" type="${3:-secret}"
    npx vercel env rm "$name" production -y >/dev/null 2>&1 || true
    printf '%s' "$value" | npx vercel env add "$name" production --type "$type" >/dev/null
    echo "  env: $name ✓"
  }
  echo "→ Setting environment variables (production)…"
  set_env NEXT_PUBLIC_DATA_MODE "supabase" config
  set_env NEXT_PUBLIC_APP_TOKEN "$APP_TOKEN" config
  set_env APP_TOKEN "$APP_TOKEN" secret
  set_env SUPABASE_URL "$SUPABASE_URL" secret
  set_env SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY" secret

  # CRON_SECRET guards the analytics rollup cron route (Bearer auth).
  # Persist a stable value in sync/.env so it survives redeploys.
  CRON_SECRET="$(grep -E '^CRON_SECRET=' "$SYNC_ENV" 2>/dev/null | cut -d= -f2- || true)"
  if [ -z "$CRON_SECRET" ]; then
    CRON_SECRET="$(openssl rand -hex 24)"
    printf '\nCRON_SECRET=%s\n' "$CRON_SECRET" >> "$SYNC_ENV"
    echo "  CRON_SECRET generated → sync/.env"
  fi
  set_env CRON_SECRET "$CRON_SECRET" secret

  echo "→ Deploying (first build takes a few minutes)…"
  npx vercel --prod --yes
  echo "✓ Frontend deployed (project: $PROJECT_NAME)"
fi

# ── 4. Deploy backend ──
if [ $DO_BACKEND -eq 1 ]; then
  echo "── Deploying backend → Vercel ──"
  cd "$BACKEND_DEPLOY"
  [ -f ".vercel/project.json" ] || { echo "✗ Backend not linked. Run: npx vercel link"; exit 1; }
  BACKEND_PROJECT="$(grep -o '"projectName":"[^"]*"' .vercel/project.json | cut -d'"' -f4)"

  echo "→ Syncing shared engine modules into lib/…"
  python3 sync-lib.py

  set_env() {
    local name="$1" value="$2" type="${3:-secret}"
    npx vercel env rm "$name" production -y >/dev/null 2>&1 || true
    printf '%s' "$value" | npx vercel env add "$name" production --type "$type" >/dev/null
    echo "  env: $name ✓"
  }
  echo "→ Setting environment variables (production)…"
  set_env VM_SHARE_DIR "/tmp" config
  set_env CACHE_TTL_HOURS "6" config
  set_env DASHBOARD_CACHE_TTL "30" config
  set_env CORS_ORIGINS "https://vijaymaruthi.vercel.app,https://frontend.vercel.app" config

  echo "→ Deploying (large Python deps — takes a few minutes)…"
  npx vercel --prod --yes
  echo "✓ Backend deployed (project: $BACKEND_PROJECT)"
fi

# ── 5. Verification ──
echo "── Verification ──"
if [ $DO_BACKEND -eq 1 ]; then
  BACKEND_URL="https://${BACKEND_PROJECT:-vijaymaruthi-backend}.vercel.app"
  echo "→ Backend health: $BACKEND_URL/api/v1/health"
  for i in 1 2 3 4 5; do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$BACKEND_URL/api/v1/health" || true)"
    if [ "$CODE" = "200" ]; then echo "✓ Backend healthy (HTTP 200)"; break; fi
    echo "  attempt $i: HTTP $CODE — waiting…"; sleep 10
  done
  [ "$CODE" = "200" ] || echo "⚠ Backend health check did not return 200 yet (cold start can take a while)"
fi

if [ $DO_FRONTEND -eq 1 ]; then
  FRONTEND_URL="https://${PROJECT_NAME:-frontend}.vercel.app"
  echo "→ Frontend page: $FRONTEND_URL"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$FRONTEND_URL" || true)"
  echo "  HTTP $CODE"
  [ "$CODE" = "200" ] && echo "✓ Frontend is live" || echo "⚠ Frontend returned $CODE (may still be building)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Deploy complete"
echo "     Frontend: https://${PROJECT_NAME:-frontend}.vercel.app"
echo "     Backend:  https://${BACKEND_PROJECT:-vijaymaruthi-backend}.vercel.app"
echo "═══════════════════════════════════════════════════════════"