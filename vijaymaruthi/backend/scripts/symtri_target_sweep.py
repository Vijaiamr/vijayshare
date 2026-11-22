#!/usr/bin/env python3
"""Symmetrical-triangle target-geometry sweep (deeper calibration rework).

Phase ST-2. Re-simulates the SAME accepted entries/stops as the official
simulator (production defaults: min_confidence=60, min_rr=1.5, trend_filter)
but sweeps the target multiple k over a fine grid, for symmetrical_triangle
only, split by direction.

Motivation (from trade_dataset.jsonl autopsy, 2026-09-03):
  - Overall symtri expectancy is -0.164R (n=409), WR 18.1%.
  - Bearish (-0.295R, n=170) is far worse than bullish (-0.072R, n=239).
  - bars_held: trades surviving 40-120 bars are strongly positive
    (+0.96R..+1.05R) while early stop-outs (0-10 bars) are -0.84R.
  - rr_at_signal: low-RR (2-3) trades are +0.06R; high-RR (6+) are -0.47R.
  These point to the 2.0x continuation target being too far: most trades get
  stopped out before the target is reached. This sweep tests whether a lower
  target multiple (or a direction split) rescues expectancy.

Usage: python3 scripts/symtri_target_sweep.py [--years 5]
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine"))
import pattern_engine as pe  # noqa: E402

TICKERS = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
    "SBIN.NS", "ITC.NS", "LT.NS", "BHARTIARTL.NS", "TATAMOTORS.NS",
    "MARUTI.NS", "ASIANPAINT.NS",
]
COST_R = 0.05
COOLDOWN = 20
# Fine grid of target multiples to test (continuation height multiple).
K_GRID = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]


def fetch_candles(ticker: str, years: int) -> Optional[List[pe.Candle]]:
    import yfinance as yf
    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365)
    df = yf.download(ticker, start=start_date.strftime("%Y-%m-%d"),
                     end=end_date.strftime("%Y-%m-%d"), progress=False,
                     auto_adjust=True)
    if df is None or df.empty or len(df) < 100:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    candles: List[pe.Candle] = []
    for date_idx, row in df.iterrows():
        if pd.isna(row.get("Open")) or pd.isna(row.get("High")) or \
           pd.isna(row.get("Low")) or pd.isna(row.get("Close")):
            continue
        date_str = date_idx.strftime("%Y-%m-%d") if hasattr(date_idx, "strftime") else str(date_idx)[:10]
        candles.append(pe.Candle(time=date_str, open=float(row["Open"]),
                                 high=float(row["High"]), low=float(row["Low"]),
                                 close=float(row["Close"]),
                                 volume=float(row.get("Volume", 0))))
    return candles if len(candles) >= 100 else None


def walk_exit(candles: List[pe.Candle], direction: str, entry_idx: int,
              entry_price: float, sl: float, tgt: float) -> Tuple[float, int, str]:
    """Exact replica of the sim hold loop."""
    if direction == "bullish":
        stop_level = min(sl, entry_price * 0.97)
    else:
        stop_level = max(sl, entry_price * 1.03)
    moved_to_be = False
    exit_idx, exit_price = entry_idx, entry_price
    hit_sl = hit_tgt = False
    for j in range(entry_idx + 1, min(entry_idx + 120, len(candles))):
        high, low = candles[j].high, candles[j].low
        if not moved_to_be:
            move_r = ((high - entry_price) / (entry_price - sl) if direction == "bullish"
                      else (entry_price - low) / (sl - entry_price))
            if move_r >= 1.0:
                moved_to_be = True
        eff_sl = entry_price if moved_to_be else stop_level
        if direction == "bullish":
            if low <= eff_sl:
                hit_sl = True
                exit_idx, exit_price = j, min(eff_sl, candles[j].open)
                break
            if high >= tgt:
                hit_tgt = True
                exit_idx, exit_price = j, max(tgt, candles[j].open)
                break
        else:
            if high >= eff_sl:
                hit_sl = True
                exit_idx, exit_price = j, max(eff_sl, candles[j].open)
                break
            if low <= tgt:
                hit_tgt = True
                exit_idx, exit_price = j, min(tgt, candles[j].open)
                break
        exit_idx, exit_price = j, candles[j].close
    pnl = ((exit_price - entry_price) / (entry_price - sl) if direction == "bullish"
           else (entry_price - exit_price) / (sl - entry_price)) - COST_R
    if hit_sl:
        result = "scratch" if moved_to_be else "loss"
    elif hit_tgt:
        result = "win"
    elif pnl > 0:
        result = "win"
    elif pnl < -0.5:
        result = "loss"
    else:
        result = "scratch"
    return pnl, exit_idx - entry_idx, result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=5)
    args = ap.parse_args()

    results: Dict[float, Dict[str, List[float]]] = {
        k: {"all": [], "bullish": [], "bearish": []} for k in K_GRID
    }

    for ticker in TICKERS:
        candles = fetch_candles(ticker, args.years)
        if candles is None:
            print(f"  skip {ticker}: insufficient data")
            continue
        swing_highs, swing_lows = pe.find_swing_points(candles)
        t2i = {c.time: k for k, c in enumerate(candles)}
        all_pats: List[Tuple[Any, int]] = []
        for i in range(50, len(candles)):
            window = candles[max(0, i - 60):i + 1]
            wtimes = {c.time for c in window}
            wh = [h for h in swing_highs if t2i.get(h.time, -1) <= i - 2 and h.time in wtimes]
            wl = [l for l in swing_lows if t2i.get(l.time, -1) <= i - 2 and l.time in wtimes]
            try:
                for p in pe.detect_patterns(window, wh, wl):
                    if p.type == "symmetrical_triangle" and p.confidence >= 60:
                        all_pats.append((p, i))
            except Exception:
                continue

        last_sig: Dict[str, int] = {}
        for pat, b in all_pats:
            key = pat.direction
            prev = last_sig.get(key)
            if prev is not None and b - prev < COOLDOWN:
                continue
            e = b + 2
            if e + 1 >= len(candles):
                continue
            entry = candles[e].close
            sl = pat.stop_loss
            if sl is None:
                continue
            if pat.direction == "bullish" and entry <= sl:
                continue
            if pat.direction == "bearish" and entry >= sl:
                continue
            rr = pe._calc_rr(entry, sl, pat.target)
            if rr is None or rr < 1.5:
                continue
            atr14 = pe._atr(candles, e, 14)
            atr50 = pe._atr(candles, e, 50)
            if atr50 > 0 and atr14 / atr50 > 1.5:
                continue
            ma50 = pe._sma(candles, e, 50)
            trend = "uptrend" if entry > ma50 else ("downtrend" if entry < ma50 else "neutral")
            if pat.direction == "bullish" and trend == "downtrend":
                continue
            if pat.direction == "bearish" and trend == "uptrend":
                continue
            adj = min(99, pe._round_half_up(pat.confidence * 0.90))
            if adj < 60:
                continue
            last_sig[key] = b
            height = abs(pat.target - entry) / pe.TARGET_MULT_CONTINUATION
            for k in K_GRID:
                tgt = (entry + k * height) if pat.direction == "bullish" \
                    else (entry - k * height)
                if tgt <= 0:
                    continue
                pnl, _, _ = walk_exit(candles, pat.direction, e, entry, sl, tgt)
                results[k][pat.direction].append(pnl)
                results[k]["all"].append(pnl)

    def fmt(rs):
        if not rs:
            return "n=0"
        n = len(rs)
        s = sum(rs)
        wins = sum(1 for x in rs if x > 0)
        return f"n={n:<4} {s/n:+.3f}R WR={wins/n*100:.1f}%"

    print(f"\n{'k':>5} | {'ALL':>22} | {'bullish':>22} | {'bearish':>22}")
    print("-" * 78)
    for k in K_GRID:
        r = results[k]
        print(f"{k:>5.2f} | {fmt(r['all']):>22} | {fmt(r['bullish']):>22} | {fmt(r['bearish']):>22}")

    def best(bucket):
        best_k, best_e = None, -1e9
        for k in K_GRID:
            rs = results[k][bucket]
            if not rs:
                continue
            e = sum(rs) / len(rs)
            if e > best_e:
                best_e, best_k = e, k
        return best_k, best_e

    for bucket in ["all", "bullish", "bearish"]:
        bk, be = best(bucket)
        print(f"\nbest {bucket:8s}: k={bk}  expectancy={be:+.3f}R")


if __name__ == "__main__":
    main()
