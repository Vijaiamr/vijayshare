#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  run_supabase_sync.sh — push local analysis results to Supabase.
#
#  Safe to run from cron: logs to logs/cron_supabase_sync.log and always
#  exits 0 so cron doesn't keep mailing you on every failure.
#
#  Install in crontab (weekdays at 18:45 IST, after market close):
#    45 18 * * 1-5 /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/run_supabase_sync.sh
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/cron_supabase_sync.log"

# cron has a minimal PATH — use the absolute Python from this machine
PYTHON="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="$(command -v python3 || echo /usr/bin/python3)"
fi

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Forward any extra args (e.g. --skip-ohlcv for a fast daily sync,
# --ohlcv-limit 200 for a partial backfill, --dry-run to test).
# Default = full sync, same as the launchd job.
ARGS=("$@")

echo "[$(stamp)] ── Supabase sync start (args: ${ARGS[*]:-none}) ──" >> "$LOG"
if "$PYTHON" "$ROOT/sync/sync_to_supabase.py" "${ARGS[@]}" >> "$LOG" 2>&1; then
  echo "[$(stamp)] ✓ Supabase sync completed" >> "$LOG"
  exit 0
else
  echo "[$(stamp)] ✗ Supabase sync FAILED (see above)" >> "$LOG"
  exit 1
fi
