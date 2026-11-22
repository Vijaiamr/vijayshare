#!/usr/bin/env python3
"""(Re)generate the rule-engine golden-master snapshots.

Runs the real TechnicalAnalysisPipeline over deterministic offline fixtures
(see ``backend/tests/fixtures``) and writes one JSON per case to
``backend/tests/golden/``. These files are the exact-equality contract the
rule-engine refactor must satisfy.

Usage:
    python3 backend/scripts/snapshot_golden.py            # write golden files
    python3 backend/scripts/snapshot_golden.py --check    # print, don't write
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make ``fixtures`` importable (lives in backend/tests/).
_TESTS_DIR = Path(__file__).resolve().parents[1] / "tests"
sys.path.insert(0, str(_TESTS_DIR))

from fixtures.snapshot import GOLDEN_DIR, golden_path, snapshot_all  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="Print snapshots instead of writing them.")
    args = parser.parse_args()

    snaps = snapshot_all()

    if args.check:
        print(json.dumps(snaps, indent=2, sort_keys=True))
        return 0

    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    for name, snap in snaps.items():
        path = golden_path(name)
        path.write_text(json.dumps(snap, indent=2, sort_keys=True) + "\n")
        print(f"wrote {path.relative_to(path.parents[2])}"
              f"  signal={snap['signal']} conf={snap['confidence']}"
              f" patterns={len(snap['patterns'])}")
    print(f"\n{len(snaps)} golden snapshot(s) written to {GOLDEN_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
