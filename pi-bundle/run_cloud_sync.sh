#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  run_cloud_sync.sh — refresh OHLCV candles in Supabase
#  Lightweight job — the ideal always-on Pi task.
#  Requires: vijaymaruthi/sync/.env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOG="$ROOT/logs/cloud_sync.log"
mkdir -p "$(dirname "$LOG")"

PYTHON="$ROOT/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
    echo "[ERROR] .venv not found — run setup.sh first." | tee -a "$LOG"
    exit 1
fi

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

echo "[$(stamp)] ── Cloud sync start ──" >> "$LOG"
"$PYTHON" vijaymaruthi/cloud/sync_cloud_prices.py >> "$LOG" 2>&1
RC=$?

if [ $RC -eq 0 ]; then
    echo "[$(stamp)] ✓ Cloud sync completed" >> "$LOG"
else
    echo "[$(stamp)] ✗ Cloud sync FAILED exitcode=$RC" >> "$LOG"
fi
exit $RC