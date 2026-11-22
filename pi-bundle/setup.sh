#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  setup.sh — one-time setup for the VijayMaruthi engine on Raspberry Pi
#
#  Run on the Pi:   bash setup.sh
#
#  What it does:
#    1. Checks this is a 64-bit OS (REQUIRED — pandas/scipy/matplotlib
#       no longer ship 32-bit ARM wheels).
#    2. Checks RAM and creates a 2 GB swap file if the Pi has <= 2 GB
#       (Pi 3B has 1 GB — swap is essential to avoid OOM crashes).
#    3. Installs system packages (python3-venv, etc.).
#    4. Creates .venv and installs the Python dependencies.
#    5. Verifies all imports work.
#    6. Runs a 2-ticker smoke test (RELIANCE + TCS, no DB writes).
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== VijayMaruthi engine — Raspberry Pi setup ==="
echo "Root: $ROOT"
echo

# ── 1. 64-bit OS check ──
ARCH="$(uname -m)"
echo "[1/6] Architecture: $ARCH"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
    echo "  [FAIL] 32-bit OS detected."
    echo "  The engine needs pandas/scipy/matplotlib, which no longer ship"
    echo "  32-bit ARM wheels. Reinstall Raspberry Pi OS 64-bit (Lite):"
    echo "    https://www.raspberrypi.com/software/operating-systems/"
    echo "  Then re-run this script."
    exit 1
fi
echo "  [OK] 64-bit OS"
echo

# ── 2. RAM + swap check ──
TOTAL_RAM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))
echo "[2/6] RAM: ${TOTAL_RAM_GB} GB"
if [ "$TOTAL_RAM_GB" -le 2 ]; then
    SWAPFILE=/swapfile
    if [ -f "$SWAPFILE" ]; then
        echo "  [OK] Swap file already exists: $SWAPFILE"
    else
        echo "  Creating 2 GB swap file (essential on 1 GB RAM)..."
        sudo fallocate -l 2G "$SWAPFILE" || sudo dd if=/dev/zero of="$SWAPFILE" bs=1M count=2048
        sudo chmod 600 "$SWAPFILE"
        sudo mkswap "$SWAPFILE"
        sudo swapon "$SWAPFILE"
        # Persist across reboots
        if ! grep -q "$SWAPFILE" /etc/fstab; then
            echo "$SWAPFILE none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
        fi
        echo "  [OK] Swap created and enabled"
    fi
    echo "  Current swap:"
    free -h | grep -i swap
else
    echo "  [OK] RAM >= 2 GB — swap not required"
fi
echo

# ── 3. System packages ──
echo "[3/6] Installing system packages..."
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip python3-dev build-essential
echo "  [OK] System packages installed"
echo

# ── 4. Python venv + dependencies ──
echo "[4/6] Creating virtual environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
echo "  Python: $(python --version)"

echo "  Installing dependencies (this takes a few minutes on a Pi)..."
pip install --upgrade pip --quiet
pip install numpy pandas scipy matplotlib requests yfinance nsetools --quiet
echo "  [OK] Dependencies installed"
echo

# ── 5. Verify imports ──
echo "[5/6] Verifying imports..."
python -c "import numpy, pandas, scipy, matplotlib, requests, yfinance; print('  [OK] all imports verified')"
echo

# ── 6. Smoke test (2 tickers, no DB writes) ──
echo "[6/6] Smoke test: RELIANCE + TCS (no DB writes)..."
python - <<'PY'
import sys, os
sys.path.insert(0, os.getcwd())
from engine.runner import AnalysisRunner
runner = AnalysisRunner()
for t in ("RELIANCE.NS", "TCS.NS"):
    r = runner.run_ticker(t, period="1y", sentiment=False, save_db=False)
    if "error" in r:
        print(f"  {t}: ERROR {r['error']}")
    else:
        print(f"  {t}: OK — close={r.get('price')}")
PY

echo
echo "=== Setup complete ==="
echo
echo "Next steps:"
echo "  1. Test a small run:      bash run_daily.sh --limit 20"
echo "  2. Full daily run:        bash run_daily.sh            (all ~2400, 6-12h on Pi 3B)"
echo "  3. Schedule it:           bash install_service.sh      (systemd timer, daily 19:30 IST)"
echo "  4. Cloud OHLCV sync:      bash run_cloud_sync.sh"
echo
echo "NOTE: On a Pi 3B (1 GB RAM) always use --workers 1 (run_daily.sh does this)."
echo "      The full 2400-ticker scan is slow on a Pi — start with --limit 50-100."