#!/usr/bin/env python3
"""
sync-lib.py — copy the shared analysis modules from the repository root
(share/) into vercel-backend/lib/ so the Vercel bundle is self-contained.

The heavy analysis engine lives at the repo root, one level above the
vijaymaruthi/ project (e.g. share/technical_analysis_report.py). Vercel can
only bundle files inside the project directory, so before deploying we copy
the modules this backend imports at runtime.

Run:  python3 sync-lib.py   (from vercel-backend/)
"""

import os
import shutil
import sys

# This file lives at <share>/vijaymaruthi/vercel-backend/sync-lib.py
# → repo root is ../../  (the share/ directory)
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
LIB_DIR = os.path.join(HERE, "lib")

# Modules imported by backend/engine/*.py and backend/api/*.py at runtime.
REQUIRED_MODULES = [
    "analysis_db.py",
    "technical_analysis_report.py",
    "quantamental_backtester.py",
    "portfolio_heatmap.py",
    "sentiment_analyzer.py",
    "pattern_validator.py",
    "backtest_hs_full.py",
    "nse_hs_scanner.py",
]

def main() -> int:
    os.makedirs(LIB_DIR, exist_ok=True)
    copied = []
    missing = []
    for name in REQUIRED_MODULES:
        src = os.path.join(REPO_ROOT, name)
        if not os.path.isfile(src):
            missing.append(name)
            continue
        dst = os.path.join(LIB_DIR, name)
        shutil.copy2(src, dst)
        copied.append(name)

    print(f"Synced {len(copied)} modules → {LIB_DIR}")
    for name in copied:
        print(f"  ✓ {name}")
    if missing:
        print("Missing (skipped, optional):")
        for name in missing:
            print(f"  ✗ {name}")
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
