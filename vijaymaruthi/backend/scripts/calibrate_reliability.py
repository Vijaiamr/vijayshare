#!/usr/bin/env python3
"""Recalibrate PATTERN_RELIABILITY weights against the repaired pattern engine.

Phase R follow-up: the weights shipped in pattern_engine.py / patterns.ts were
derived from the PRE-repair backtest (look-ahead swings, dropped stop-outs,
no costs, optimistic fills). Those numbers are invalid. This script re-runs
the repaired simulator across a liquid NSE universe and derives new weights
from honest expectancy.

Method
------
1. Run simulate_trades (production defaults: min_confidence=60, min_rr=1.5,
   trend_filter=True) per ticker over `--years` of daily bars.
2. Aggregate per-pattern trades across tickers.
3. Expectancy (avg R per trade including costs) drives the weight:

     expectancy >= +0.25          -> 1.15
     +0.10 <= exp < +0.25         -> 1.10
     -0.05 <= exp < +0.10         -> 1.00
     -0.20 <= exp < -0.05         -> 0.90
     -0.40 <= exp < -0.20         -> 0.80
     expectancy < -0.40           -> 0.65

4. Patterns with fewer than `--min-n` total trades keep weight 1.0
   (insufficient evidence). Weights are clamped to [0.60, 1.20].

Caveats (stated plainly)
------------------------
- In-sample calibration: weights are coarse ranking priors, not alpha.
- Small samples are common for some pattern types; the Wilson interval is
  reported so nobody over-trusts a 5-trade win rate.
- Scratches (neither stop nor target within 120 bars) count toward n and
  dilute expectancy, matching how the engine reports performance.

Usage
-----
    python3 scripts/calibrate_reliability.py [--years 5] [--min-n 15]
        [--tickers RELIANCE.NS,TCS.NS,...]
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine"))

from pattern_engine import run_pattern_backtest  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("calibrate")

DEFAULT_TICKERS = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
    "SBIN.NS", "ITC.NS", "LT.NS", "BHARTIARTL.NS", "TATAMOTORS.NS",
    "MARUTI.NS", "ASIANPAINT.NS",
]

WEIGHT_TIERS = [
    (0.25, 1.15),
    (0.10, 1.10),
    (-0.05, 1.00),
    (-0.20, 0.90),
    (-0.40, 0.80),
]

WEIGHT_FLOOR = 0.60
WEIGHT_CAP = 1.20


def wilson_interval(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion."""
    if n == 0:
        return (0.0, 0.0)
    p = wins / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def tier_weight(expectancy: float) -> float:
    for threshold, weight in WEIGHT_TIERS:
        if expectancy >= threshold:
            return weight
    return 0.65


def derive_weight(expectancy: float, n: int, min_n: int,
                  wins: int = -1) -> tuple[float, str]:
    if n < min_n:
        return 1.0, f"insufficient data (n={n} < {min_n})"
    w = max(WEIGHT_FLOOR, min(WEIGHT_CAP, tier_weight(expectancy)))
    # Zero-win guard: a pattern that NEVER reaches target over a meaningful
    # sample has a materially negative binomial signal (P(0 wins | p>=0.2,
    # n=15) < 0.035) even when slow time-exits keep expectancy near zero.
    if wins == 0:
        w = min(w, 0.70)
    return round(w, 2), f"expectancy {expectancy:+.2f}R over n={n}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--min-n", type=int, default=15,
                    help="minimum trade sample to deviate from weight 1.0")
    ap.add_argument("--tickers", type=str, default=",".join(DEFAULT_TICKERS))
    ap.add_argument("--experimental", action="store_true",
                    help="also calibrate EXPERIMENTAL_PATTERNS (dispatcher gate "
                         "is lifted for the run; production default stays off)")
    args = ap.parse_args()

    if args.experimental:
        import pattern_engine as _pe
        _pe.ENABLE_EXPERIMENTAL_PATTERNS = True
        log.info("experimental patterns ENABLED for this calibration run")

    tickers = [t.strip() for t in args.tickers.split(",") if t.strip()]
    agg: Dict[str, Dict[str, float]] = {}
    per_ticker_summary: Dict[str, Any] = {}

    for tic in tickers:
        try:
            res = run_pattern_backtest(tic, years=args.years)
        except Exception as exc:  # yfinance/network failures must not kill the run
            log.warning("%s failed: %s", tic, exc)
            per_ticker_summary[tic] = {"error": str(exc)}
            continue
        if "error" in res:
            log.warning("%s skipped: %s", tic, res["error"])
            per_ticker_summary[tic] = {"error": res["error"]}
            continue

        per_ticker_summary[tic] = {
            "trades": res["total_trades"],
            "win_rate": res["win_rate"],
            "total_r": res["total_r"],
        }
        log.info("%s: %d trades, WR %.1f%%, %.2fR",
                 tic, res["total_trades"], res["win_rate"], res["total_r"])

        for ptype, pp in res["per_pattern"].items():
            slot = agg.setdefault(
                ptype, {"n": 0, "wins": 0, "losses": 0, "scratches": 0, "total_r": 0.0})
            slot["n"] += pp["count"]
            slot["wins"] += pp["wins"]
            slot["losses"] += pp["losses"]
            slot["scratches"] += pp["scratches"]
            slot["total_r"] += pp["total_r"]

    # ── Derive weights ──
    proposal: Dict[str, Dict[str, Any]] = {}
    header = (f"{'pattern':<28}{'n':>5}{'W':>4}{'L':>4}{'Scr':>4}"
              f"{'WR%':>7}{'WR 95% CI':>16}{'exp R':>8}{'weight':>8}  basis")
    print("\n" + header)
    print("-" * len(header))
    for ptype in sorted(agg):
        s = agg[ptype]
        n = int(s["n"])
        decided = int(s["wins"] + s["losses"])
        wr = s["wins"] / decided * 100 if decided else 0.0
        lo, hi = wilson_interval(int(s["wins"]), decided)
        exp = s["total_r"] / n if n else 0.0
        w, basis = derive_weight(exp, n, args.min_n, wins=int(s["wins"]))
        proposal[ptype] = {
            "n": n, "wins": int(s["wins"]), "losses": int(s["losses"]),
            "scratches": int(s["scratches"]),
            "decided_win_rate_pct": round(wr, 1),
            "wr_ci95_pct": [round(lo * 100, 1), round(hi * 100, 1)],
            "expectancy_r": round(exp, 3),
            "proposed_weight": w,
            "basis": basis,
        }
        print(f"{ptype:<28}{n:>5}{int(s['wins']):>4}{int(s['losses']):>4}"
              f"{int(s['scratches']):>4}{wr:>7.1f}"
              f"{f'[{lo*100:.0f},{hi*100:.0f}]':>16}{exp:>+8.2f}{w:>8.2f}  {basis}")

    # Patterns never traded keep the current default of 1.0 implicitly.
    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "years": args.years,
        "min_n": args.min_n,
        "universe": tickers,
        "per_ticker": per_ticker_summary,
        "aggregate": proposal,
        "method": {
            "tiers": [{"max_expectancy_ge": t, "weight": w} for t, w in WEIGHT_TIERS],
            "below_worst_tier": 0.65,
            "clamp": [WEIGHT_FLOOR, WEIGHT_CAP],
            "insufficient_data_weight": 1.0,
            "zero_win_guard": "wins==0 and n>=min_n caps weight at 0.70",
        },
    }
    out_path = Path(__file__).resolve().parent / "reliability_calibration.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nReport written to {out_path}")

    print("\nProposed PATTERN_RELIABILITY block:")
    entries = ",\n".join(f'  "{k}": {v["proposed_weight"]}' for k, v in sorted(proposal.items()))
    print("PATTERN_RELIABILITY = {\n" + entries + ",\n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
