#!/usr/bin/env bash
# run_chart_tests.sh — run the full chart regression suite against a running
# local-mode frontend (default http://localhost:3000).
#
# Usage:
#   ./run_chart_tests.sh                 # all suites
#   ./run_chart_tests.sh phase-d         # one suite
#   BASE_URL=http://localhost:3000 ./run_chart_tests.sh
#
# Requires: python3 + playwright (pip install playwright && playwright install chromium)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
export BASE_URL

SUITES=(
  "chart-phase-d.py:Phase D (17 checks)"
  "chart-deep-3000.py:Deep regression (6 steps)"
  "chart-phase-d-extras.py:Extras (undo/redo/hotkeys/overlays)"
  "chart-alerts-layouts.py:Alerts + Layouts"
  "chart-e2-types.py:Alternative chart types (Kagi/P&F/Range/Line Break)"
)

run_one() {
  local file="$1" label="$2"
  echo "── $label ──"
  python3 "$DIR/$file"
  echo
}

if [[ $# -eq 1 ]]; then
  for entry in "${SUITES[@]}"; do
    file="${entry%%:*}"
    label="${entry#*:}"
    if [[ "$file" == *"$1"* ]]; then
      run_one "$file" "$label"
      exit 0
    fi
  done
  echo "No suite matches '$1'. Available: ${SUITES[*]}" >&2
  exit 1
fi

for entry in "${SUITES[@]}"; do
  file="${entry%%:*}"
  label="${entry#*:}"
  run_one "$file" "$label"
done

echo "All chart suites passed ✔"