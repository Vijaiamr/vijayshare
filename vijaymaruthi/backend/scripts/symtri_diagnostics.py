#!/usr/bin/env python3
"""Symmetrical-triangle loss autopsy + entry-model sweep.

Phase ST diagnostics. Mirrors pe.simulate_trades exit semantics EXACTLY
(entry=close[bar+2], F-1 reject, RR floor, vol filter, R10 trend gate,
confidence weight, 20-bar cooldown, 3%-buffer stop, BE-at-1R, gap-aware
fills, 120-bar timeout, cost_r=0.05) for symmetrical_triangle only, then:

  A. Anchors the replica against the official simulator (aggregate level;
     small drift expected from cross-pattern used_bars collisions).
  B. Segments expectancy by break distance / direction / trend alignment /
     height-as-%-of-price.
  C. Counterfactual sweeps:
     - target multiple k in {1.0, 1.5, 2.0} x measured-move height
     - retest-entry model (first touch of broken line within 10 bars)

Usage: python3 scripts/symtri_diagnostics.py [--years 5]
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
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

    orig_detect = pe._detect_symmetrical_triangle
    records: List[Dict[str, Any]] = []  # every detection event

    def recording_detect(candles, swing_highs, swing_lows):
        p = orig_detect(candles, swing_highs, swing_lows)
        if p is not None:
            records.append({"end_time": candles[-1].time, "pat": p})
        return p

    idx = pe._DETECTORS.index(orig_detect)
    pe._DETECTORS[idx] = recording_detect

    agg = defaultdict(lambda: [0, 0.0])   # replica trades
    seg = defaultdict(lambda: [0, 0.0])   # segment -> [n, sum_r]
    cf_targets = {1.0: [0, 0.0], 1.5: [0, 0.0], 2.0: [0, 0.0]}
    retest = [0, 0.0]
    retest_missed = 0
    official_agg = [0, 0.0]

    for ticker in TICKERS:
        candles = fetch_candles(ticker, args.years)
        if candles is None:
            print(f"  skip {ticker}: insufficient data")
            continue
        t2i = {c.time: k for k, c in enumerate(candles)}
        rec_by_time: Dict[str, Dict[str, Any]] = {}
        for r in records[-len(records):]:
            pass  # placeholder; records are global, filtered below per ticker

        # ── official baseline ──
        try:
            trades = pe.simulate_trades(candles, [], min_confidence=60,
                                        min_rr=1.5, trend_filter=True)
        except Exception:
            trades = []
        sym = [t for t in trades if t.pattern_type == "symmetrical_triangle"]
        official_agg[0] += len(sym)
        official_agg[1] += sum(t.r_multiple for t in sym)

        # ── replica of the sim loop, symtri only ──
        swing_highs, swing_lows = pe.find_swing_points(candles)
        time_to_idx = {c.time: k for k, c in enumerate(candles)}
        all_pats: List[Tuple[Any, int]] = []
        for i in range(50, len(candles)):
            window = candles[max(0, i - 60):i + 1]
            window_times = {c.time for c in window}
            wh = [h for h in swing_highs if time_to_idx.get(h.time, -1) <= i - 2
                  and h.time in window_times]
            wl = [l for l in swing_lows if time_to_idx.get(l.time, -1) <= i - 2
                  and l.time in window_times]
            try:
                pats = pe.detect_patterns(window, wh, wl)
                for p in pats:
                    if p.type == "symmetrical_triangle" and p.confidence >= 60:
                        all_pats.append((p, i))
            except Exception:
                continue

        last_sig: Dict[str, int] = {}
        used: set = set()
        for pat, b in all_pats:
            key = f"{pat.direction}"
            prev = last_sig.get(key)
            if prev is not None and b - prev < COOLDOWN:
                continue
            e = b + 2
            if e + 1 >= len(candles):
                continue
            entry = candles[e].close
            sl = pat.stop_loss
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
            used.add(b)
            last_sig[key] = b

            height = abs(pat.target - pat.entry) / pe.TARGET_MULT_CONTINUATION
            pnl, bars, res = walk_exit(candles, pat.direction, e, entry, sl, pat.target)
            agg["base"][0] += 1
            agg["base"][1] += pnl
            d = pat.direction
            bp = abs(entry - candles[b].close) / candles[b].close  # ~0: entry 2 bars later
            h_pct = height / entry
            seg[f"{d}|{trend}"][0] += 1
            seg[f"{d}|{trend}"][1] += pnl
            hband = "<5%" if h_pct < 0.05 else ("5-15%" if h_pct < 0.15 else ">15%")
            seg[f"{d}|{hband}"][0] += 1
            seg[f"{d}|{hband}"][1] += pnl
            seg[f"mix|{res}"][0] += 1
            seg[f"mix|{res}"][1] += pnl

            # ── counterfactual: target multiple sweep ──
            for k, bucket in cf_targets.items():
                tk = (entry + k * height) if d == "bullish" else (entry - k * height)
                if tk <= 0:
                    continue
                pk, _, _ = walk_exit(candles, d, e, entry, sl, tk)
                bucket[0] += 1
                bucket[1] += pk

            # ── counterfactual: retest entry ──
            line = pat.stop_loss  # NOT the broken line; recover from checklist? use entry-side ref
            # Broken-line reference: reconstruct as the pattern's stop side opposite.
            # Bullish: stop = lower_now*(1-cushion); bearish: stop = upper_now*(1+cushion).
            cushion = pe.STOP_CUSHION_PCT
            broken_line = (sl / (1 - cushion)) if d == "bullish" else (sl / (1 + cushion))
            entered = False
            for j in range(b + 3, min(b + 13, len(candles) - 1)):
                touched = (candles[j].low <= broken_line * 1.01 if d == "bullish"
                           else candles[j].high >= broken_line * 0.99)
                if not touched:
                    continue
                re_entry = candles[j].close
                if d == "bullish" and re_entry <= sl:
                    break
                if d == "bearish" and re_entry >= sl:
                    break
                rrr = pe._calc_rr(re_entry, sl, pat.target)
                if rrr is None or rrr < 1.5:
                    break
                a14 = pe._atr(candles, j, 14)
                a50 = pe._atr(candles, j, 50)
                if a50 > 0 and a14 / a50 > 1.5:
                    break
                m50 = pe._sma(candles, j, 50)
                tr = "uptrend" if re_entry > m50 else ("downtrend" if re_entry < m50 else "neutral")
                if d == "bullish" and tr == "downtrend":
                    break
                if d == "bearish" and tr == "uptrend":
                    break
                pr, _, _ = walk_exit(candles, d, j, re_entry, sl, pat.target)
                retest[0] += 1
                retest[1] += pr
                entered = True
                break
            if not entered:
                retest_missed += 1

    print("\n════ SYMMETRICAL TRIANGLE AUTOPSY ════")
    n, s = official_agg
    print(f"\nOFFICIAL  n={n}  mean={s / n:+.3f}R" if n else "\nOFFICIAL  n=0")
    n, s = agg["base"]
    print(f"REPLICA   n={n}  mean={s / n:+.3f}R" if n else "REPLICA   n=0")

    print(f"\n── segments (replica) ──")
    for k in sorted(seg):
        n, s = seg[k]
        print(f"  {k:<22} n={n:<4} mean={s / n:+.3f}R")

    print(f"\n── target-multiple sweep (same entries/stops) ──")
    for k in sorted(cf_targets):
        n, s = cf_targets[k]
        print(f"  k={k:<4} n={n:<4} mean={s / n:+.3f}R")

    n, s = retest
    print(f"\n── retest-entry model (touch within 10 bars) ──")
    print(f"  n={n}  mean={s / n:+.3f}R  missed(no-touch)={retest_missed}" if n
          else f"  n=0 missed={retest_missed}")


if __name__ == "__main__":
    main()
