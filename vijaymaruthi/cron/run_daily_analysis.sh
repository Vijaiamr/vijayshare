#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  run_daily_analysis.sh — re-run the NSE quantamental analysis with the
#  latest market data and persist results to the local SQLite DB.
#
#  Uses run_latest_analysis.py (resumable: skips tickers already analysed
#  today, so an interrupted run can simply be restarted).
#
#  Options:
#    --limit N   analyse at most N tickers (0 = all ~2400, takes 1.5-3h)
#    --force     re-run even if analysed today
#    SYNC_AFTER=1  chain: run Supabase sync when analysis finishes
#
#  Recommended crontab (weekdays 19:30 IST, after market close):
#    30 19 * * 1-5 /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/run_daily_analysis.sh
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHARE="$(cd "$ROOT/.." && pwd)"
LOG="$ROOT/logs/cron_analysis.log"

PYTHON="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="$(command -v python3 || echo /usr/bin/python3)"
fi

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Forward any extra args (--limit N / --force) to the analysis script
ARGS=("$@")

echo "[$(stamp)] ── Daily analysis start (args: ${ARGS[*]:-none}) ──" >> "$LOG"
if "$PYTHON" "$SHARE/run_latest_analysis.py" "${ARGS[@]}" >> "$LOG" 2>&1; then
  echo "[$(stamp)] ✓ Daily analysis completed" >> "$LOG"
  if [ "${SYNC_AFTER:-0}" = "1" ]; then
    echo "[$(stamp)] → Chaining Supabase sync…" >> "$LOG"
    "$PYTHON" "$ROOT/sync/sync_to_supabase.py" >> "$LOG" 2>&1 \
      && echo "[$(stamp)] ✓ Supabase sync completed" >> "$LOG" \
      || echo "[$(stamp)] ✗ Supabase sync FAILED" >> "$LOG"
  fi
  exit 0
else
  echo "[$(stamp)] ✗ Daily analysis FAILED (partial results are kept — rerun resumes)" >> "$LOG"
  exit 1
fi
