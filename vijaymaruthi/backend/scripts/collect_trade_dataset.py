#!/usr/bin/env python3
"""Collect the pattern-trade feature/outcome dataset for failure-risk modeling.

Replicates pe.simulate_trades semantics exactly (anchored against the
official simulator during the ST autopsy: n 412 vs 411, mean R within
0.001) across all pattern types, recording per accepted trade:

  pattern_type, direction, confidence_raw, confidence_adj, rr_at_signal,
  trend_at_entry, atr_ratio (atr14/atr50), height_pct, outcome, r_multiple,
  bars_held

Output: scripts/trade_dataset.jsonl  (one JSON object per trade)

Usage: python3 scripts/collect_trade_dataset.py [--years 5]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

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
    end = datetime.now()
    start = end - timedelta(days=years * 365)
    df = yf.download(ticker, start=start.strftime("%Y-%m-%d"),
                     end=end.strftime("%Y-%m-%d"), progress=False, auto_adjust=True)
    if df is None or df.empty or len(df) < 100:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    candles: List[pe.Candle] = []
    for date_idx, row in df.iterrows():
        if pd.isna(row.get("Open")) or pd.isna(row.get("High")) or \
           pd.isna(row.get("Low")) or pd.isna(row.get("Close")):
            continue
        ds = date_idx.strftime("%Y-%m-%d") if hasattr(date_idx, "strftime") else str(date_idx)[:10]
        candles.append(pe.Candle(time=ds, open=float(row["Open"]), high=float(row["High"]),
                                 low=float(row["Low"]), close=float(row["Close"]),
                                 volume=float(row.get("Volume", 0))))
    return candles if len(candles) >= 100 else None


def walk_exit(candles: List[pe.Candle], direction: str, entry_idx: int,
              entry_price: float, sl: float, tgt: float):
    """Exact replica of the sim hold loop (see ST autopsy anchor)."""
    stop_level = min(sl, entry_price * 0.97) if direction == "bullish" \
        else max(sl, entry_price * 1.03)
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
                hit_sl, exit_idx, exit_price = True, j, min(eff_sl, candles[j].open)
                break
            if high >= tgt:
                hit_tgt, exit_idx, exit_price = True, j, max(tgt, candles[j].open)
                break
        else:
            if high >= eff_sl:
                hit_sl, exit_idx, exit_price = True, j, max(eff_sl, candles[j].open)
                break
            if low <= tgt:
                hit_tgt, exit_idx, exit_price = True, j, min(tgt, candles[j].open)
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
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "trade_dataset.jsonl"))
    args = ap.parse_args()

    rows: List[Dict[str, Any]] = []
    total_official = 0
    total_replica = 0

    for ticker in TICKERS:
        candles = fetch_candles(ticker, args.years)
        if candles is None:
            print(f"  skip {ticker}")
            continue
        try:
            trades = pe.simulate_trades(candles, [], min_confidence=60,
                                        min_rr=1.5, trend_filter=True)
            total_official += len(trades)
        except Exception:
            pass

        swing_highs, swing_lows = pe.find_swing_points(candles)
        t2i = {c.time: k for k, c in enumerate(candles)}
        all_pats: List[Any] = []
        for i in range(50, len(candles)):
            window = candles[max(0, i - 60):i + 1]
            wtimes = {c.time for c in window}
            wh = [h for h in swing_highs if t2i.get(h.time, -1) <= i - 2 and h.time in wtimes]
            wl = [l for l in swing_lows if t2i.get(l.time, -1) <= i - 2 and l.time in wtimes]
            try:
                for p in pe.detect_patterns(window, wh, wl):
                    if p.confidence >= 60:
                        all_pats.append((p, i))
            except Exception:
                continue

        last_sig: Dict[str, int] = {}
        used: set = set()
        for pat, b in all_pats:
            key = f"{pat.type}|{pat.direction}"
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
            floor = pe._rr_floor_for(pat.type, 1.5)
            if rr is None or rr < floor:
                continue
            atr14 = pe._atr(candles, e, 14)
            atr50 = pe._atr(candles, e, 50)
            atr_ratio = atr14 / atr50 if atr50 > 0 else 1.0
            if atr_ratio > 1.5:
                continue
            ma50 = pe._sma(candles, e, 50)
            trend = "uptrend" if entry > ma50 else ("downtrend" if entry < ma50 else "neutral")
            if pat.type in pe.CONTINUATION_PATTERNS:
                if pat.direction == "bullish" and trend == "downtrend":
                    continue
                if pat.direction == "bearish" and trend == "uptrend":
                    continue
            adj = min(99, pe._round_half_up(pat.confidence * pe.PATTERN_RELIABILITY.get(pat.type, 1.0)))
            if adj < 60:
                continue
            used.add(b)
            last_sig[key] = b

            height_pct = None
            if pat.entry and pat.target:
                k = pe.TARGET_MULT_CONTINUATION if pat.type in pe.CONTINUATION_PATTERNS else pe.TARGET_MULT_REVERSAL
                if k:
                    height_pct = abs(pat.target - pat.entry) / k / pat.entry

            pnl, bars, res = walk_exit(candles, pat.direction, e, entry, sl, pat.target)
            total_replica += 1
            rows.append({
                "ticker": ticker,
                "pattern_type": pat.type,
                "direction": pat.direction,
                "confidence_raw": pat.confidence,
                "confidence_adj": adj,
                "rr_at_signal": round(rr, 3),
                "trend_at_entry": trend,
                "atr_ratio": round(atr_ratio, 3),
                "height_pct": round(height_pct, 4) if height_pct else None,
                "family": ("continuation" if pat.type in pe.CONTINUATION_PATTERNS else "reversal"),
                "outcome": res,
                "r_multiple": round(pnl, 3),
                "bars_held": bars,
            })

    out = Path(args.out)
    with out.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"\nreplica trades: {total_replica}  (official across universe: {total_official})")
    print(f"wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
