#!/usr/bin/env python3
"""Propagate the canonical engine + rule package to every deploy copy.

The market-analysis engine is physically duplicated across the workspace:

  1. vijaymaruthi/engine/            ← git canonical (SOURCE OF TRUTH)
  2. <share-root>/                   ← live backend / cron
  3. vijaymaruthi/vercel-backend/lib/ ← deployed serverless
  4. <share-root>/pi-bundle/          ← Raspberry Pi bundle

There is no automated sync, so edits to the canonical copy silently drift from
production. This script copies the canonical engine module(s) and the whole
``rules/`` package to each target, then verifies byte-for-byte (sha256) equality
and that each target still imports its engine with the rule engine active.

Usage:
    python3 scripts/sync_engine.py --dry-run   # show planned actions
    python3 scripts/sync_engine.py             # copy + verify
    python3 scripts/sync_engine.py --check     # verify only (no copy)
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

# scripts/ -> vijaymaruthi/
APP_ROOT = Path(__file__).resolve().parents[1]
SHARE_ROOT = APP_ROOT.parent

CANONICAL_DIR = APP_ROOT / "engine"
RULES_DIR = CANONICAL_DIR / "rules"

# Engine modules that must stay in lockstep. Only files that exist in a target
# get synced there (targets have different subsets).
ENGINE_FILES = [
    "technical_analysis_report.py",
]

# (label, directory)
TARGETS = [
    ("share-root", SHARE_ROOT),
    ("vercel-lib", APP_ROOT / "vercel-backend" / "lib"),
    ("pi-bundle", SHARE_ROOT / "pi-bundle"),
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _rule_files() -> list[Path]:
    return sorted(p for p in RULES_DIR.glob("*.py") if p.is_file())


def _plan() -> list[tuple[Path, Path]]:
    """Return [(src, dst), ...] pairs to copy."""
    pairs: list[tuple[Path, Path]] = []
    for _label, tdir in TARGETS:
        for name in ENGINE_FILES:
            src = CANONICAL_DIR / name
            if src.exists():
                pairs.append((src, tdir / name))
        for src in _rule_files():
            pairs.append((src, tdir / "rules" / src.name))
    return pairs


def _copy(src: Path, dst: Path) -> str:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return "copied" if _sha256(src) == _sha256(dst) else "MISMATCH"


def _verify_import(tdir: Path) -> tuple[bool, str]:
    """Import the target's engine module in a subprocess; confirm rules active."""
    engine_mod = "technical_analysis_report"
    code = (
        "import sys; "
        f"sys.path.insert(0, r'{tdir}'); "
        f"import {engine_mod} as m; "
        "print('HAS_RULES', getattr(m, 'HAS_RULES', False))"
    )
    try:
        out = subprocess.run([sys.executable, "-c", code], capture_output=True,
                             text=True, timeout=120, cwd=str(tdir))
    except Exception as e:  # pragma: no cover - defensive
        return False, f"exec failed: {e}"
    ok = out.returncode == 0 and "HAS_RULES True" in out.stdout
    return ok, (out.stdout.strip() or out.stderr.strip()[-400:])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Show actions only.")
    ap.add_argument("--check", action="store_true",
                    help="Verify only (no copy): report drift + import health.")
    args = ap.parse_args()

    if not CANONICAL_DIR.exists():
        print(f"canonical engine dir missing: {CANONICAL_DIR}")
        return 1

    pairs = _plan()
    rc = 0

    if args.check:
        drift = []
        for src, dst in pairs:
            state = "ok" if dst.exists() and _sha256(src) == _sha256(dst) else "DRIFT"
            if state == "DRIFT":
                drift.append(dst)
        if drift:
            print(f"{len(drift)} file(s) drifted from canonical:")
            for d in drift:
                print(f"  {d}")
            rc = 1
        else:
            print(f"all {len(pairs)} engine/rules files match canonical")
    else:
        for src, dst in pairs:
            if args.dry_run:
                print(f"[dry-run] {src} -> {dst}")
            else:
                print(f"{_copy(src, dst):8s} {src.name} -> {dst}")
        if not args.dry_run:
            print()

    # Import health per target (always).
    if not args.dry_run:
        for label, tdir in TARGETS:
            ok, detail = _verify_import(tdir)
            print(f"[{label}] import {'OK' if ok else 'FAIL'} — {detail}")
            if not ok:
                rc = 1

    return rc


if __name__ == "__main__":
    raise SystemExit(main())
