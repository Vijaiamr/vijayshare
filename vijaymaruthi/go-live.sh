#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  go-live.sh — one command to take your app live (after you paste 2 keys)
#
#  Flow:
#    1. Validates sync/.env (errors if you haven't pasted your keys yet)
#    2. Runs the sync: local SQLite → Supabase (pushes all analyzed stocks)
#    3. Installs the daily launchd job (18:45 IST auto-sync)
#    4. Deploys the frontend to Vercel
#
#  Usage:  ./go-live.sh
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SYNC="$ROOT/sync"
ENV_FILE="$SYNC/.env"

echo "════════ VijayMaruthi — Go Live ════════"

# ── 1. Validate sync/.env ──
if [ ! -f "$ENV_FILE" ]; then
  cp "$SYNC/.env.example" "$ENV_FILE"
  echo "→ Created $ENV_FILE"
  echo "  ✗ But it's still empty. Open it and paste your Supabase URL + service key."
  echo "  Then run ./go-live.sh again."
  exit 1
fi

if grep -qE "PASTE-YOUR|^SUPABASE_URL=\s*$|^SUPABASE_SERVICE_ROLE_KEY=\s*$" "$ENV_FILE"; then
  echo "✗ $ENV_FILE still contains placeholder values."
  echo ""
  echo "  Do this now (2 minutes):"
  echo "   1. Open supabase.com → sign in → New project (name: vijaymaruthi)"
  echo "   2. SQL Editor → paste sync/supabase_schema.sql → Run"
  echo "   3. Settings → API → copy Project URL + service_role key"
  echo "   4. Edit $ENV_FILE and paste both values"
  echo ""
  echo "  Then run: ./go-live.sh"
  exit 1
fi
echo "✓ Supabase credentials found"

# ── 2. Sync local analysis → Supabase ──
echo "→ Syncing local SQLite → Supabase (your analyzed stocks)…"
python3 "$SYNC/sync_to_supabase.py" || { echo "✗ Sync failed — check the log above"; exit 1; }

# ── 3. Install daily launchd job ──
PLIST="$SYNC/com.vijaymaruthi.supabase-sync.plist"
DEST="$HOME/Library/LaunchAgents/com.vijaymaruthi.supabase-sync.plist"
mkdir -p "$HOME/Library/LaunchAgents"
if [ ! -f "$DEST" ]; then
  cp "$PLIST" "$DEST"
  echo "→ Daily auto-sync installed (18:45 IST)"
else
  echo "→ Daily auto-sync already installed"
fi
launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST" 2>/dev/null || true

# ── 4. Deploy to Vercel ──
echo "→ Deploying frontend to Vercel…"
"$ROOT/deploy-vercel.sh"

echo ""
echo "🎉 GO LIVE COMPLETE — your dashboard is on the internet!"
