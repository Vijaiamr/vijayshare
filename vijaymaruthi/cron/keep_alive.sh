#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  keep_alive.sh — make sure the local dev stack (backend :8765 + frontend
#  :3001) is running, and restart `npm run dev` if either is down.
#
#  NOTE: For a Mac that stays on during market hours, launchd with
#  KeepAlive=true is a better fit than cron for this job (see CRON.md §7).
#  This script is the cron-compatible alternative — run it every 5 minutes:
#
#    */5 * * * * /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/keep_alive.sh
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/cron_keep_alive.log"
stamp() { date '+%Y-%m-%d %H:%M:%S'; }

port_listening() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }

# If both ports are up, nothing to do.
if port_listening 8765 && port_listening 3001; then
  exit 0
fi

echo "[$(stamp)] ! Backend(8765) or frontend(3001) down — restarting dev stack" >> "$LOG"

# Stop any half-dead processes from a previous run
pkill -f "uvicorn api.main:app" >/dev/null 2>&1 || true
pkill -f "next dev -p 3001" >/dev/null 2>&1 || true
sleep 2

# Start fresh, detached, logging to logs/dev.log (same as a manual `npm run dev`)
cd "$ROOT" || exit 1
nohup npm run dev > "$ROOT/logs/dev.log" 2>&1 &
disown

# Wait up to 60s for both ports
for i in $(seq 1 12); do
  sleep 5
  if port_listening 8765 && port_listening 3001; then
    echo "[$(stamp)] ✓ Dev stack is back up" >> "$LOG"
    exit 0
  fi
done

echo "[$(stamp)] ✗ Dev stack did not come up within 60s — check logs/dev.log" >> "$LOG"
exit 1
