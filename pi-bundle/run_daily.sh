#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  run_daily.sh — NSE quantamental analysis -> SQLite -> (optional) Supabase
#
#  Usage:
#    bash run_daily.sh              # all tickers (~2400, 6-12h on Pi 3B)
#    bash run_daily.sh --limit 100  # first 100 tickers (~15-30 min on Pi 3B)
#    bash run_daily.sh --force      # re-run even if analysed today
#    SYNC_AFTER=1 bash run_daily.sh # chain Supabase push when analysis finishes
#
#  Pi 3B safety: always runs with --workers 1 (1 GB RAM cannot handle
#  parallel workers without OOM). Resumable — interrupted runs can simply
#  be restarted (tickers already analysed today are skipped).
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOG="$ROOT/logs/daily_analysis.log"
mkdir -p "$(dirname "$LOG")"

PYTHON="$ROOT/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
    echo "[ERROR] .venv not found — run setup.sh first." | tee -a "$LOG"
    exit 1
fi

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

echo "[$(stamp)] ── Daily analysis start (args: ${*:-none}) ──" >> "$LOG"

# Pi 3B safety: force 1 worker regardless of what the caller passes.
# --workers is always appended AFTER user args so it wins.
"$PYTHON" run_latest_analysis.py "$@" --workers 1 >> "$LOG" 2>&1
RC=$?

if [ $RC -eq 0 ]; then
    echo "[$(stamp)] ✓ Daily analysis completed" >> "$LOG"
    if [ "${SYNC_AFTER:-0}" = "1" ]; then
        echo "[$(stamp)] → Chaining Supabase sync…" >> "$LOG"
        "$PYTHON" vijaymaruthi/sync/sync_to_supabase.py >> "$LOG" 2>&1 \
            && echo "[$(stamp)] ✓ Supabase sync completed" >> "$LOG" \
            || echo "[$(stamp)] ✗ Supabase sync FAILED" >> "$LOG"
    fi
    exit 0
else
    echo "[$(stamp)] ✗ Daily analysis FAILED (partial results kept — rerun resumes)" >> "$LOG"
    exit 1
fi