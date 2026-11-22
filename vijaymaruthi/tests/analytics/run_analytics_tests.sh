#!/usr/bin/env bash
# run_analytics_tests.sh — run the analytics admin regression suite against a
# running frontend (default http://localhost:3000; use BASE_URL for prod).
#
# Usage:
#   ./run_analytics_tests.sh                          # local
#   BASE_URL=https://vijaymaruthi.vercel.app ./run_analytics_tests.sh
#
# Requires: python3 + playwright (pip install playwright && playwright install chromium)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
export BASE_URL

echo "── Analytics admin smoke suite (BASE_URL=$BASE_URL) ──"
python3 "$DIR/analytics-admin-smoke.py"
echo
echo "── Analytics filters + drill-down suite (BASE_URL=$BASE_URL) ──"
python3 "$DIR/analytics-filters-drilldown.py"
echo
echo "✓ Analytics suite complete"