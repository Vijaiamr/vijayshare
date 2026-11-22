#!/usr/bin/env python3
"""
==============================================================================
HEAD & SHOULDERS PATTERN — COMPLETE BACKTEST with SUCCESS/FAILURE ANALYSIS
==============================================================================
Uses documented pattern rules from chart_patterns.md and HEAD_AND_SHOULDERS_PATTERN.md
Fetches real-time Yahoo Finance data for NSE + US stocks.
Generates:
  1. Success/Failure graph per stock (obey vs not-obey)
  2. Aggregate win/loss distribution
  3. Cumulative P&L curves
  4. Obey vs Not-Obey classification

Usage:
    python backtest_hs_full.py --scan 100        # Scan NSE + US stocks
    python backtest_hs_full.py --scan all --fresh  # Full scan with fresh data
    python backtest_hs_full.py --graph-only       # Just re-generate graphs from cached results
==============================================================================
"""

import argparse
import json
import os
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import pandas as pd
import requests
import yfinance as yf
from scipy.ndimage import gaussian_filter1d
from scipy.signal import argrelextrema

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# ─── Paths ───────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = BASE_DIR / "hs_backtest_results"
CACHE_DIR = BASE_DIR / ".hs_cache"
DOC_DIR = BASE_DIR / "document"

OUTPUT_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

NSE_EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

# ─── Colors ──────────────────────────────────────────────────────────────────
C_SUCCESS    = "#2d6a4f"
C_FAILURE    = "#e94560"
C_NEUTRAL    = "#0f3460"
C_BG         = "#f8f9fa"
C_GRID       = "#dee2e6"

# ─── Data Structures ─────────────────────────────────────────────────────────

@dataclass
class TradeResult:
    symbol: str
    pattern_type: str  # "H&S_TOP" or "IH&S_BOTTOM"
    timeframe: str     # "daily", "weekly"
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    exit_reason: str   # "TARGET_HIT", "STOP_LOSS_HIT", "TIME_EXIT"
    pnl_pct: float
    rr_ratio: float
    target_price: float
    head_price: float
    neckline_value: float
    confidence: float
    success: bool      # True if target was hit
    volume_ratio: float


# ─── NSE Symbols ─────────────────────────────────────────────────────────────

def fetch_nse_symbols() -> List[str]:
    local_csv = CACHE_DIR / "nse_equity_list.csv"
    if local_csv.exists() and (datetime.now() - datetime.fromtimestamp(local_csv.stat().st_mtime)).days < 1:
        df = pd.read_csv(local_csv)
        return df["SYMBOL"].dropna().str.strip().tolist()
    try:
        resp = requests.get(NSE_EQUITY_LIST_URL, timeout=30)
        if resp.status_code == 200:
            with open(local_csv, "wb") as f:
                f.write(resp.content)
            df = pd.read_csv(local_csv)
            return df["SYMBOL"].dropna().str.strip().tolist()
    except:
        pass
    return _fallback_symbols()

def _fallback_symbols() -> List[str]:
    return [
        "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR",
        "ITC","SBIN","BHARTIARTL","KOTAKBANK","BAJFINANCE","LT",
        "AXISBANK","WIPRO","MARUTI","HCLTECH","TITAN","ULTRACEMCO",
        "SUNPHARMA","ADANIPORTS","M&M","NTPC","POWERGRID","NESTLEIND",
        "ASIANPAINT","ONGC","JSWSTEEL","TATASTEEL","COALINDIA","ADANIENT",
    ]

def yf_sym(sym: str) -> str:
    sym = sym.strip().upper()
    return sym if sym.endswith(".NS") or "." in sym else sym + ".NS"

US_TICKERS = [
    "SPY", "QQQ", "DIA", "IWM",
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
    "JPM", "BAC", "GS", "V", "MA",
    "JNJ", "PFE", "UNH", "ABBV",
    "WMT", "HD", "MCD", "DIS", "NKE",
    "GLD", "SLV", "USO",
]


# ─── Data Loading ────────────────────────────────────────────────────────────

def load_data(symbol: str, months: int = 24, fresh: bool = False) -> Optional[pd.DataFrame]:
    ticker = yf_sym(symbol)
    cache_file = CACHE_DIR / f"{ticker.replace('.', '_')}.pkl"

    if not fresh and cache_file.exists():
        df = pd.read_pickle(cache_file)
        age = (datetime.now() - datetime.fromtimestamp(cache_file.stat().st_mtime)).days
        if age < 7 and len(df) >= months * 20:
            return df

    end = datetime.now()
    # Fetch more data for weekly timeframe
    start = end - timedelta(days=months * 35)
    try:
        data = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
    except:
        return None

    if data is None or data.empty:
        return None

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0].lower() for col in data.columns]
    else:
        data.columns = [c.lower() for c in data.columns]

    data.to_pickle(cache_file)
    return data


# ─── Pattern Detection ───────────────────────────────────────────────────────

def find_extrema(close: np.ndarray, order: int = 5):
    peaks = argrelextrema(close, np.greater, order=order)[0]
    troughs = argrelextrema(close, np.less, order=order)[0]
    return peaks, troughs

def _uptrend_slope(close, start, end) -> float:
    if end - start < 10:
        return 0.0
    x = np.arange(end - start + 1)
    y = close[start:end + 1]
    slope, _ = np.polyfit(x, y, 1)
    return slope


def detect_hs_top(df: pd.DataFrame, order: int = 5) -> List[Dict]:
    """
    Detect Head & Shoulders TOP patterns using documented strict criteria.
    """
    results = []
    close = df["close"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    low_prices = df["low"].values.astype(np.float64)
    n = len(close)

    if n < 80:
        return results

    smoothed = gaussian_filter1d(close, sigma=1.8)
    peaks, _ = find_extrema(smoothed, order=order)
    if len(peaks) < 3:
        return results

    for i in range(len(peaks) - 2):
        ls_idx  = int(peaks[i])
        head_idx = int(peaks[i + 1])
        rs_idx   = int(peaks[i + 2])

        # Minimum spacing
        if (head_idx - ls_idx) < 10 or (rs_idx - head_idx) < 10:
            continue
        if (rs_idx - ls_idx) > n * 0.8:
            continue

        ls_p  = close[ls_idx]
        h_p   = close[head_idx]
        rs_p  = close[rs_idx]

        # Head must be highest
        if not (h_p > ls_p and h_p > rs_p):
            continue

        # Head >= 2% above shoulders
        if (h_p - ls_p) / ls_p < 0.02 or (h_p - rs_p) / rs_p < 0.02:
            continue

        # Shoulder symmetry within 15%
        shoulder_diff = abs(ls_p - rs_p) / max(ls_p, rs_p)
        if shoulder_diff > 0.15:
            continue

        # Prior uptrend
        lookback = min(30, ls_idx - 5)
        trend_start = ls_idx - lookback
        if _uptrend_slope(close, trend_start, ls_idx) <= 0:
            continue

        # Troughs between shoulders and head
        seg1 = slice(ls_idx, head_idx + 1)
        seg2 = slice(head_idx, rs_idx + 1)
        t1_idx = int(np.argmin(low_prices[seg1]) + ls_idx)
        t2_idx = int(np.argmin(low_prices[seg2]) + head_idx)

        if t1_idx in (ls_idx, head_idx) or t2_idx in (head_idx, rs_idx):
            continue
        if (t1_idx - ls_idx) < 5 or (head_idx - t1_idx) < 3:
            continue
        if (t2_idx - head_idx) < 3 or (rs_idx - t2_idx) < 5:
            continue

        t1_p = close[t1_idx]
        t2_p = close[t2_idx]

        # Neckline
        m = (t2_p - t1_p) / (t2_idx - t1_idx) if (t2_idx - t1_idx) != 0 else 0
        c = t1_p - m * t1_idx

        def neck_val(idx):
            return m * idx + c

        # Find neckline break
        break_idx = None
        for j in range(rs_idx + 1, n):
            nv = neck_val(j)
            if close[j] < nv and (nv - close[j]) / nv >= 0.01:
                break_idx = j
                break

        if break_idx is None:
            continue

        # Sustained break check
        break_neck = neck_val(break_idx)
        if close[-1] >= break_neck or close[-1] >= h_p:
            continue

        # Volume confirmation
        vol_ls   = float(np.mean(volume[max(0, ls_idx-3):ls_idx+1]))
        vol_head = float(np.mean(volume[max(0, head_idx-3):head_idx+1]))
        vol_rs   = float(np.mean(volume[max(0, rs_idx-3):rs_idx+1]))
        if not (vol_ls > vol_rs and vol_head > vol_rs):
            continue

        # Time symmetry
        ls_dur = head_idx - ls_idx
        rs_dur = rs_idx - head_idx
        ratio = rs_dur / ls_dur if ls_dur > 0 else 99
        if ratio < 0.25 or ratio > 4.0:
            continue

        # Calculate target
        head_neck = neck_val(head_idx)
        projection = h_p - head_neck
        target = neck_val(break_idx) - projection

        # Stop loss: above right shoulder high
        stop_loss = float(np.max(close[max(0, rs_idx-3):rs_idx+1]))

        # Risk/Reward
        risk = stop_loss - close[break_idx]
        reward = close[break_idx] - target
        rr = reward / risk if risk > 0 else 0

        results.append({
            "type": "H&S_TOP",
            "ls_idx": ls_idx,
            "head_idx": head_idx,
            "rs_idx": rs_idx,
            "t1_idx": t1_idx,
            "t2_idx": t2_idx,
            "break_idx": break_idx,
            "ls_price": round(ls_p, 2),
            "head_price": round(h_p, 2),
            "rs_price": round(rs_p, 2),
            "neckline_slope": m,
            "neckline_intercept": c,
            "entry_price": round(close[break_idx], 2),
            "stop_loss": round(stop_loss, 2),
            "target_price": round(max(target, 0), 2),
            "rr_ratio": round(rr, 2),
            "volume_ratio": round(vol_rs / vol_ls if vol_ls > 0 else 1, 2),
            "confidence": 0.0,
        })

    return results


def detect_ihs_bottom(df: pd.DataFrame, order: int = 5) -> List[Dict]:
    """
    Detect Inverse Head & Shoulders BOTTOM patterns.
    """
    results = []
    close = df["close"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    high_prices = df["high"].values.astype(np.float64)
    n = len(close)

    if n < 80:
        return results

    smoothed = gaussian_filter1d(close, sigma=1.8)
    _, troughs = find_extrema(smoothed, order=order)
    if len(troughs) < 3:
        return results

    for i in range(len(troughs) - 2):
        ls_idx  = int(troughs[i])
        head_idx = int(troughs[i + 1])
        rs_idx   = int(troughs[i + 2])

        if (head_idx - ls_idx) < 10 or (rs_idx - head_idx) < 10:
            continue
        if (rs_idx - ls_idx) > n * 0.8:
            continue

        ls_p  = close[ls_idx]
        h_p   = close[head_idx]
        rs_p  = close[rs_idx]

        # Head must be lowest
        if not (h_p < ls_p and h_p < rs_p):
            continue

        # Head >= 2% below shoulders
        if (ls_p - h_p) / ls_p < 0.02 or (rs_p - h_p) / rs_p < 0.02:
            continue

        # Shoulder symmetry
        shoulder_diff = abs(ls_p - rs_p) / max(ls_p, rs_p)
        if shoulder_diff > 0.15:
            continue

        # Prior downtrend
        lookback = min(30, ls_idx - 5)
        trend_start = ls_idx - lookback
        if _uptrend_slope(close, trend_start, ls_idx) >= 0:
            continue

        # Peaks between troughs for neckline
        seg1 = slice(ls_idx, head_idx + 1)
        seg2 = slice(head_idx, rs_idx + 1)
        p1_idx = int(np.argmax(high_prices[seg1]) + ls_idx)
        p2_idx = int(np.argmax(high_prices[seg2]) + head_idx)

        p1_p = close[p1_idx]
        p2_p = close[p2_idx]

        # Neckline
        m = (p2_p - p1_p) / (p2_idx - p1_idx) if (p2_idx - p1_idx) != 0 else 0
        c = p1_p - m * p1_idx

        def neck_val(idx):
            return m * idx + c

        # Find breakout
        break_idx = None
        for j in range(rs_idx + 1, n):
            nv = neck_val(j)
            if close[j] > nv and (close[j] - nv) / nv >= 0.01:
                break_idx = j
                break

        if break_idx is None:
            continue

        break_neck = neck_val(break_idx)
        if close[-1] <= break_neck or close[-1] <= h_p:
            continue

        # Volume: RS volume should be higher than LS (accumulation)
        vol_ls   = float(np.mean(volume[max(0, ls_idx-3):ls_idx+1]))
        vol_rs   = float(np.mean(volume[max(0, rs_idx-3):rs_idx+1]))
        if vol_rs < vol_ls * 0.5:  # RS should NOT be too low
            continue

        # Target
        head_neck = neck_val(head_idx)
        projection = head_neck - h_p
        target = neck_val(break_idx) + projection

        # Stop loss: below right shoulder low
        stop_loss = float(np.min(close[max(0, rs_idx-3):rs_idx+1]))

        # Risk/Reward
        risk = close[break_idx] - stop_loss
        reward = target - close[break_idx]
        rr = reward / risk if risk > 0 else 0

        results.append({
            "type": "IH&S_BOTTOM",
            "ls_idx": ls_idx,
            "head_idx": head_idx,
            "rs_idx": rs_idx,
            "p1_idx": p1_idx,
            "p2_idx": p2_idx,
            "break_idx": break_idx,
            "ls_price": round(ls_p, 2),
            "head_price": round(h_p, 2),
            "rs_price": round(rs_p, 2),
            "neckline_slope": m,
            "neckline_intercept": c,
            "entry_price": round(close[break_idx], 2),
            "stop_loss": round(stop_loss, 2),
            "target_price": round(target, 2),
            "rr_ratio": round(rr, 2),
            "volume_ratio": round(vol_rs / vol_ls if vol_ls > 0 else 1, 2),
            "confidence": 0.0,
        })

    return results


# ─── Trade Simulator ─────────────────────────────────────────────────────────

def simulate_trade(df: pd.DataFrame, pattern: Dict, ticker: str, timeframe: str,
                   slippage: float = 0.001) -> Optional[TradeResult]:
    """Simulate a trade from pattern detection to exit."""
    close = df["close"].values
    dates = df.index
    n = len(close)

    break_idx = pattern["break_idx"]
    entry_price = pattern["entry_price"]
    stop_loss = pattern["stop_loss"]
    target = pattern["target_price"]
    direction = "SHORT" if pattern["type"] == "H&S_TOP" else "LONG"

    if entry_price <= 0 or target <= 0:
        return None

    # Simulation loop - walk forward from break
    max_lookahead = min(break_idx + 120, n)
    exit_idx = None
    exit_price_val = None
    exit_reason = "TIME_EXIT"

    for j in range(break_idx + 1, max_lookahead):
        if direction == "SHORT":
            # Stop loss hit (price goes up)
            if close[j] >= stop_loss:
                exit_idx = j
                exit_price_val = stop_loss * (1 + slippage)
                exit_reason = "STOP_LOSS_HIT"
                break
            # Target hit
            if close[j] <= target:
                exit_idx = j
                exit_price_val = target * (1 - slippage)
                exit_reason = "TARGET_HIT"
                break
        else:  # LONG
            if close[j] <= stop_loss:
                exit_idx = j
                exit_price_val = stop_loss * (1 - slippage)
                exit_reason = "STOP_LOSS_HIT"
                break
            if close[j] >= target:
                exit_idx = j
                exit_price_val = target * (1 + slippage)
                exit_reason = "TARGET_HIT"
                break

    if exit_idx is None:
        exit_idx = max_lookahead - 1
        exit_price_val = close[exit_idx]
        exit_reason = "TIME_EXIT"

    # Calculate P&L
    if direction == "SHORT":
        pnl_pct = (entry_price - exit_price_val) / entry_price * 100
    else:
        pnl_pct = (exit_price_val - entry_price) / entry_price * 100

    return TradeResult(
        symbol=ticker,
        pattern_type=pattern["type"],
        timeframe=timeframe,
        entry_date=str(dates[break_idx].date()),
        entry_price=round(entry_price, 2),
        exit_date=str(dates[exit_idx].date()),
        exit_price=round(exit_price_val, 2),
        exit_reason=exit_reason,
        pnl_pct=round(pnl_pct, 2),
        rr_ratio=pattern["rr_ratio"],
        target_price=pattern["target_price"],
        head_price=pattern["head_price"],
        neckline_value=pattern.get("neckline_value", 0),
        confidence=pattern.get("confidence", 0),
        success=(exit_reason == "TARGET_HIT"),
        volume_ratio=pattern["volume_ratio"],
    )


# ─── Scan a Single Symbol ────────────────────────────────────────────────────

def scan_symbol(symbol: str, fresh: bool = False) -> List[TradeResult]:
    """Scan a symbol for H&S patterns and simulate trades."""
    results = []

    # Daily timeframe
    df = load_data(symbol, months=24, fresh=fresh)
    if df is None or len(df) < 100:
        return results

    ticker = yf_sym(symbol)

    # Detect H&S Top
    hs_patterns = detect_hs_top(df, order=5)
    for p in hs_patterns:
        trade = simulate_trade(df, p, ticker, "daily")
        if trade:
            results.append(trade)

    # Detect IH&S Bottom
    ihs_patterns = detect_ihs_bottom(df, order=5)
    for p in ihs_patterns:
        trade = simulate_trade(df, p, ticker, "daily")
        if trade:
            results.append(trade)

    return results


# ─── Graph Generation ────────────────────────────────────────────────────────

def generate_graphs(all_trades: List[TradeResult], output_dir: Path):
    """Generate comprehensive success/failure graphs."""
    print(f"\n{'='*60}")
    print(f"  Generating Success/Failure Graphs...")
    print(f"{'='*60}")

    if not all_trades:
        print("  No trades to plot.")
        return

    df_trades = pd.DataFrame([t.__dict__ for t in all_trades])

    # ─── 1. Overall Success/Failure Pie Chart ───
    fig, axes = plt.subplots(2, 3, figsize=(20, 12))
    fig.patch.set_facecolor(C_BG)

    successes = df_trades[df_trades["success"] == True]
    failures = df_trades[df_trades["success"] == False]
    total = len(df_trades)
    win_rate = len(successes) / total * 100 if total > 0 else 0

    ax = axes[0, 0]
    labels = [f"Success (Target Hit)\n{len(successes)} trades", 
              f"Failure (No Target)\n{len(failures)} trades"]
    sizes = [len(successes), len(failures)]
    colors_pie = [C_SUCCESS, C_FAILURE]
    explode = (0.05, 0)
    ax.pie(sizes, explode=explode, labels=labels, colors=colors_pie,
           autopct="%1.1f%%", startangle=90, textprops={"fontsize": 11, "fontweight": "bold"})
    ax.set_title(f"Overall Win Rate: {win_rate:.1f}%\n(Total: {total} trades)", 
                 fontsize=13, fontweight="bold", pad=15)

    # ─── 2. Pattern Type Breakdown ───
    ax = axes[0, 1]
    pattern_types = df_trades["pattern_type"].value_counts()
    colors_pt = [C_SUCCESS if "IH&S" in p else C_FAILURE for p in pattern_types.index]
    bars = ax.bar(pattern_types.index, pattern_types.values, color=colors_pt, edgecolor="black", linewidth=1.2)
    for bar, val in zip(bars, pattern_types.values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(pattern_types.values)*0.01,
                str(val), ha="center", fontsize=11, fontweight="bold")
    ax.set_title("Pattern Type Distribution", fontsize=13, fontweight="bold")
    ax.set_ylabel("Count")
    ax.grid(True, alpha=0.15)
    ax.set_facecolor("white")

    # ─── 3. Exit Reason Distribution ───
    ax = axes[0, 2]
    exit_reasons = df_trades["exit_reason"].value_counts()
    colors_exit = {"TARGET_HIT": C_SUCCESS, "STOP_LOSS_HIT": C_FAILURE, "TIME_EXIT": "#f39c12"}
    bars = ax.bar(exit_reasons.index, exit_reasons.values, 
                  color=[colors_exit.get(r, "#95a5a6") for r in exit_reasons.index],
                  edgecolor="black", linewidth=1.2)
    for bar, val in zip(bars, exit_reasons.values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(exit_reasons.values)*0.01,
                str(val), ha="center", fontsize=11, fontweight="bold")
    ax.set_title("Exit Reason Breakdown", fontsize=13, fontweight="bold")
    ax.set_ylabel("Count")
    ax.grid(True, alpha=0.15)
    ax.set_facecolor("white")

    # ─── 4. P&L Distribution ───
    ax = axes[1, 0]
    pnl_data = df_trades["pnl_pct"]
    colors_hist = [C_SUCCESS if v > 0 else C_FAILURE for v in pnl_data]
    ax.hist(pnl_data, bins=30, color=C_NEUTRAL, edgecolor="white", alpha=0.8)
    ax.axvline(x=0, color=C_FAILURE, linewidth=2, linestyle="--", alpha=0.7)
    ax.set_title(f"P&L Distribution (Mean: {pnl_data.mean():.1f}%, Median: {pnl_data.median():.1f}%)",
                 fontsize=13, fontweight="bold")
    ax.set_xlabel("P&L %")
    ax.set_ylabel("Frequency")
    ax.grid(True, alpha=0.15)
    ax.set_facecolor("white")

    # ─── 5. Win Rate by R:R Bucket ───
    ax = axes[1, 1]
    if "rr_ratio" in df_trades.columns:
        df_plot = df_trades.copy()
        df_plot["rr_bucket"] = pd.cut(df_plot["rr_ratio"], 
                                        bins=[0, 1.0, 1.5, 2.0, 3.0, 5.0, 100],
                                        labels=["<1.0", "1.0-1.5", "1.5-2.0", "2.0-3.0", "3.0-5.0", ">5.0"])
        rr_winrate = df_plot.groupby("rr_bucket", observed=True)["success"].mean() * 100
        rr_counts = df_plot.groupby("rr_bucket", observed=True).size()
        colors_rr = ["#e74c3c" if wr < 40 else "#f39c12" if wr < 50 else "#27ae60" for wr in rr_winrate]
        bars = ax.bar(range(len(rr_winrate)), rr_winrate.values, color=colors_rr, edgecolor="black", linewidth=1.2)
        for i, (bar, val, cnt) in enumerate(zip(bars, rr_winrate.values, rr_counts.values)):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1,
                    f"{val:.1f}%\n(n={cnt})", ha="center", fontsize=9, fontweight="bold")
        ax.set_xticks(range(len(rr_winrate)))
        ax.set_xticklabels(rr_winrate.index)
        ax.set_title("Win Rate by R:R Ratio", fontsize=13, fontweight="bold")
        ax.set_ylabel("Win Rate %")
        ax.axhline(y=50, color=C_SUCCESS, linewidth=1.5, linestyle="--", alpha=0.5)
        ax.grid(True, alpha=0.15)
        ax.set_facecolor("white")

    # ─── 6. Success/Failure by Pattern Type ───
    ax = axes[1, 2]
    pt_success = df_trades.groupby("pattern_type")["success"].agg(["count", "sum"])
    pt_success["win_rate"] = pt_success["sum"] / pt_success["count"] * 100
    x = np.arange(len(pt_success.index))
    width = 0.35
    bars_s = ax.bar(x - width/2, pt_success["sum"], width, label="Success", color=C_SUCCESS, edgecolor="black")
    bars_f = ax.bar(x + width/2, pt_success["count"] - pt_success["sum"], width, label="Failure", color=C_FAILURE, edgecolor="black")
    for i, idx in enumerate(pt_success.index):
        wr = pt_success.loc[idx, "win_rate"]
        ax.text(i, pt_success.loc[idx, "count"] + max(pt_success["count"])*0.02,
                f"{wr:.1f}%", ha="center", fontsize=11, fontweight="bold", color=C_NEUTRAL)
    ax.set_xticks(x)
    ax.set_xticklabels(pt_success.index)
    ax.set_title("Success vs Failure by Pattern Type", fontsize=13, fontweight="bold")
    ax.set_ylabel("Count")
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.15)
    ax.set_facecolor("white")

    plt.tight_layout(pad=2.5)
    path = output_dir / "1_overall_analysis.png"
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [✓] Overall analysis saved: {path.name}")

    # ─── Success/Failure by Stock ───
    stock_stats = df_trades.groupby("symbol").agg(
        total_trades=("success", "count"),
        wins=("success", "sum"),
    ).reset_index()
    stock_stats["win_rate"] = stock_stats["wins"] / stock_stats["total_trades"] * 100
    stock_stats = stock_stats.sort_values("total_trades", ascending=False)

    fig, ax = plt.subplots(figsize=(max(14, len(stock_stats) * 0.3), 8))
    fig.patch.set_facecolor(C_BG)

    top_n = min(40, len(stock_stats))
    plot_data = stock_stats.head(top_n)

    x = np.arange(len(plot_data))
    width = 0.35
    bars1 = ax.bar(x - width/2, plot_data["wins"], width, label="Success", color=C_SUCCESS, edgecolor="black", linewidth=0.8)
    bars2 = ax.bar(x + width/2, plot_data["total_trades"] - plot_data["wins"], width, label="Failure", color=C_FAILURE, edgecolor="black", linewidth=0.8)

    for i, row in plot_data.iterrows():
        idx = list(plot_data.index).index(i)
        ax.text(idx, row["total_trades"] + 0.3, f"{row['win_rate']:.0f}%", 
                ha="center", fontsize=7, fontweight="bold", rotation=45)

    ax.set_xticks(x)
    ax.set_xticklabels(plot_data["symbol"], rotation=60, ha="right", fontsize=8)
    ax.set_title(f"Success vs Failure by Stock (Top {top_n} by Trade Count)", fontsize=14, fontweight="bold")
    ax.set_ylabel("Number of Trades")
    ax.legend(fontsize=11)
    ax.grid(True, alpha=0.15, axis="y")
    ax.set_facecolor("white")

    plt.tight_layout()
    path = output_dir / "2_success_by_stock.png"
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [✓] Success by stock saved: {path.name}")

    # ─── Obey vs Not-Obey Classification ───
    # "Obey" = win_rate >= 50% with at least 2 trades
    obey_stocks = stock_stats[(stock_stats["win_rate"] >= 50) & (stock_stats["total_trades"] >= 2)]
    not_obey_stocks = stock_stats[(stock_stats["win_rate"] < 50) & (stock_stats["total_trades"] >= 2)]
    neutral_stocks = stock_stats[stock_stats["total_trades"] < 2]

    fig, axes = plt.subplots(1, 3, figsize=(18, 7))
    fig.patch.set_facecolor(C_BG)

    # Pie chart
    ax = axes[0]
    labels = [f"Obey Pattern\n{len(obey_stocks)} stocks", 
              f"Not Obey Pattern\n{len(not_obey_stocks)} stocks",
              f"Insufficient Data\n{len(neutral_stocks)} stocks"]
    sizes = [len(obey_stocks), len(not_obey_stocks), len(neutral_stocks)]
    colors_cls = [C_SUCCESS, C_FAILURE, "#95a5a6"]
    ax.pie(sizes, labels=labels, colors=colors_cls, autopct="%1.1f%%",
           startangle=90, textprops={"fontsize": 11, "fontweight": "bold"})
    ax.set_title("Obey vs Not-Obey Classification\n(>=2 trades, WR>=50% = Obey)", 
                 fontsize=13, fontweight="bold", pad=15)

    # Win rate distribution
    ax = axes[1]
    wr_data = stock_stats[stock_stats["total_trades"] >= 2]["win_rate"]
    ax.hist(wr_data, bins=15, color=C_NEUTRAL, edgecolor="white", alpha=0.8)
    ax.axvline(x=50, color=C_SUCCESS, linewidth=2, linestyle="--", label="50% Threshold (Obey)")
    ax.axvline(x=wr_data.mean(), color=C_FAILURE, linewidth=2, linestyle=":", 
               label=f"Mean: {wr_data.mean():.1f}%")
    ax.set_title(f"Win Rate Distribution Across Stocks\n(n={len(wr_data)} stocks with >=2 trades)",
                 fontsize=13, fontweight="bold")
    ax.set_xlabel("Win Rate %")
    ax.set_ylabel("# of Stocks")
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.15)
    ax.set_facecolor("white")

    # Top obeying stocks
    ax = axes[2]
    top_obey = obey_stocks.sort_values("win_rate", ascending=False).head(15)
    colors_top = [C_SUCCESS if wr >= 50 else C_FAILURE for wr in top_obey["win_rate"]]
    bars = ax.barh(range(len(top_obey)), top_obey["win_rate"], color=colors_top, edgecolor="black")
    ax.set_yticks(range(len(top_obey)))
    ax.set_yticklabels(top_obey["symbol"], fontsize=9)
    ax.set_xlabel("Win Rate %")
    ax.set_title(f"Top 15 Stocks That Obey the Pattern\n(WR >= 50%, min 2 trades)", fontsize=13, fontweight="bold")
    ax.axvline(x=50, color=C_FAILURE, linewidth=1.5, linestyle="--", alpha=0.6)
    for bar, wr, cnt in zip(bars, top_obey["win_rate"], top_obey["total_trades"]):
        ax.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height()/2,
                f"{wr:.0f}% (n={cnt})", va="center", fontsize=9, fontweight="bold")
    ax.grid(True, alpha=0.15, axis="x")
    ax.set_facecolor("white")
    ax.invert_yaxis()

    plt.tight_layout(pad=2)
    path = output_dir / "3_obey_vs_not_obey.png"
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [✓] Obey vs Not-Obey classification saved: {path.name}")

    # Save stock classification to CSV
    stock_stats["classification"] = stock_stats.apply(
        lambda r: "OBEYS" if r["win_rate"] >= 50 and r["total_trades"] >= 2
                  else "DOES_NOT_OBEY" if r["total_trades"] >= 2
                  else "INSUFFICIENT_DATA",
        axis=1
    )
    csv_path = output_dir / "stock_classification.csv"
    stock_stats.to_csv(csv_path, index=False)
    print(f"  [✓] Stock classification CSV saved: {csv_path.name}")

    # ─── Cumulative P&L Curve ───
    fig, ax = plt.subplots(figsize=(16, 7))
    fig.patch.set_facecolor(C_BG)

    df_trades_sorted = df_trades.sort_values("entry_date").reset_index(drop=True)
    df_trades_sorted["cum_pnl"] = df_trades_sorted["pnl_pct"].cumsum()

    colors_line = [C_SUCCESS if s else C_FAILURE for s in df_trades_sorted["success"]]
    ax.plot(df_trades_sorted.index, df_trades_sorted["cum_pnl"], color=C_NEUTRAL, linewidth=2, alpha=0.7)
    ax.fill_between(df_trades_sorted.index, 0, df_trades_sorted["cum_pnl"], 
                    where=df_trades_sorted["cum_pnl"] >= 0, color=C_SUCCESS, alpha=0.15)
    ax.fill_between(df_trades_sorted.index, 0, df_trades_sorted["cum_pnl"],
                    where=df_trades_sorted["cum_pnl"] < 0, color=C_FAILURE, alpha=0.15)

    # Mark individual trades
    scatter_colors = [C_SUCCESS if s else C_FAILURE for s in df_trades_sorted["success"]]
    ax.scatter(df_trades_sorted.index, df_trades_sorted["pnl_pct"], c=scatter_colors,
               s=30, alpha=0.6, edgecolors="black", linewidth=0.5, zorder=5)

    ax.axhline(y=0, color="black", linewidth=1, alpha=0.5)
    final_pnl = df_trades_sorted["cum_pnl"].iloc[-1]
    ax.set_title(f"Cumulative P&L Curve\nFinal: {final_pnl:.1f}% | "
                 f"Win Rate: {win_rate:.1f}% | Trades: {total}",
                 fontsize=14, fontweight="bold")
    ax.set_xlabel("Trade Sequence")
    ax.set_ylabel("Cumulative P&L %")
    ax.grid(True, alpha=0.15)
    ax.set_facecolor("white")

    success_patch = mpatches.Patch(color=C_SUCCESS, label="Successful Trade")
    failure_patch = mpatches.Patch(color=C_FAILURE, label="Failed Trade")
    ax.legend(handles=[success_patch, failure_patch], fontsize=10)

    plt.tight_layout()
    path = output_dir / "4_cumulative_pnl.png"
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [✓] Cumulative P&L curve saved: {path.name}")

    # ─── Heatmap: Win Rate by Volume Ratio and R:R ───
    fig, ax = plt.subplots(figsize=(10, 8))
    fig.patch.set_facecolor(C_BG)

    df_heat = df_trades.copy()
    df_heat["vol_bucket"] = pd.cut(df_heat["volume_ratio"], bins=5, 
                                     labels=["Very Low", "Low", "Medium", "High", "Very High"])
    df_heat["rr_bucket"] = pd.cut(df_heat["rr_ratio"], bins=4,
                                    labels=["Low RR", "Med RR", "High RR", "Very High RR"])

    heatmap_data = df_heat.pivot_table(index="vol_bucket", columns="rr_bucket", 
                                        values="success", aggfunc="mean") * 100
    heatmap_data = heatmap_data.fillna(0)

    im = ax.imshow(heatmap_data.values, cmap="RdYlGn", aspect="auto", vmin=0, vmax=100)
    ax.set_xticks(range(len(heatmap_data.columns)))
    ax.set_xticklabels(heatmap_data.columns, fontsize=10)
    ax.set_yticks(range(len(heatmap_data.index)))
    ax.set_yticklabels(heatmap_data.index, fontsize=10)

    for i in range(len(heatmap_data.index)):
        for j in range(len(heatmap_data.columns)):
            val = heatmap_data.values[i, j]
            ax.text(j, i, f"{val:.0f}%", ha="center", va="center", 
                    fontsize=12, fontweight="bold",
                    color="white" if val < 40 or val > 70 else "black")

    ax.set_title("Win Rate Heatmap: Volume Ratio vs R:R", fontsize=14, fontweight="bold")
    ax.set_xlabel("Risk/Reward Ratio")
    ax.set_ylabel("Volume Ratio (RS/LS)")
    plt.colorbar(im, ax=ax, shrink=0.8, label="Win Rate %")

    plt.tight_layout()
    path = output_dir / "5_heatmap_volume_rr.png"
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [✓] Heatmap saved: {path.name}")

    return stock_stats


# ─── Report Generation ───────────────────────────────────────────────────────

def print_report(all_trades: List[TradeResult], stock_stats: pd.DataFrame):
    """Print a comprehensive text report."""
    if not all_trades:
        print("\n  No trades found in this scan.\n")
        return
    df_trades = pd.DataFrame([t.__dict__ for t in all_trades])
    total = len(df_trades)
    successes = df_trades[df_trades["success"] == True]
    failures = df_trades[df_trades["success"] == False]
    win_rate = len(successes) / total * 100 if total > 0 else 0

    print("\n" + "█" * 70)
    print("   HEAD AND SHOULDERS — BACKTEST REPORT")
    print("   Complete Success/Failure Analysis")
    print("█" * 70)

    print(f"\n📊 EXECUTIVE SUMMARY")
    print(f"   Total Trades:          {total}")
    print(f"   Successful (Target Hit): {len(successes)} ({win_rate:.1f}%)")
    print(f"   Failed:                  {len(failures)} ({100-win_rate:.1f}%)")
    print(f"   Avg P&L per Trade:     {df_trades['pnl_pct'].mean():.2f}%")
    print(f"   Median P&L:            {df_trades['pnl_pct'].median():.2f}%")
    print(f"   Best Trade:            {df_trades['pnl_pct'].max():.2f}%")
    print(f"   Worst Trade:           {df_trades['pnl_pct'].min():.2f}%")

    print(f"\n📈 PATTERN TYPE BREAKDOWN")
    for ptype in df_trades["pattern_type"].unique():
        subset = df_trades[df_trades["pattern_type"] == ptype]
        wr = subset["success"].mean() * 100
        print(f"   {ptype:15s}: {len(subset):4d} trades, WR: {wr:5.1f}%")

    print(f"\n🏆 STOCKS THAT OBEY THE PATTERN (WR >= 50%, >=2 trades)")
    obey = stock_stats[(stock_stats["win_rate"] >= 50) & (stock_stats["total_trades"] >= 2)]
    for _, row in obey.sort_values("win_rate", ascending=False).head(20).iterrows():
        print(f"   {row['symbol']:25s} WR: {row['win_rate']:5.1f}%  ({int(row['wins'])}/{int(row['total_trades'])})")

    print(f"\n❌ STOCKS THAT DO NOT OBEY THE PATTERN (WR < 50%, >=2 trades)")
    not_obey = stock_stats[(stock_stats["win_rate"] < 50) & (stock_stats["total_trades"] >= 2)]
    for _, row in not_obey.sort_values("win_rate", ascending=True).head(20).iterrows():
        print(f"   {row['symbol']:25s} WR: {row['win_rate']:5.1f}%  ({int(row['wins'])}/{int(row['total_trades'])})")

    print(f"\n💡 OBEY vs NOT-OBEY SUMMARY")
    print(f"   Stocks that OBEY:        {len(obey)} ({len(obey)/max(len(stock_stats),1)*100:.1f}%)")
    print(f"   Stocks that NOT OBEY:   {len(not_obey)} ({len(not_obey)/max(len(stock_stats),1)*100:.1f}%)")
    neutral = stock_stats[stock_stats["total_trades"] < 2]
    print(f"   Insufficient Data:      {len(neutral)}")

    print(f"\n📁 All graphs saved to: {OUTPUT_DIR.resolve()}")
    print(f"{'='*70}\n")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="H&S Pattern Complete Backtest with Success/Failure Analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--scan", type=str, nargs="?", const="50", default=None,
                        help="Scan NSE stocks (default: 50, use 'all' for all)")
    parser.add_argument("--symbol", type=str, help="Scan a single symbol")
    parser.add_argument("--months", type=int, default=24, help="Months of data (default: 24)")
    parser.add_argument("--workers", type=int, default=6, help="Parallel workers (default: 6)")
    parser.add_argument("--fresh", action="store_true", help="Clear cache and re-download")
    parser.add_argument("--graph-only", action="store_true", 
                        help="Only re-generate graphs from cached results")

    args = parser.parse_args()

    if args.fresh:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
            print("[INFO] Cache cleared")
        CACHE_DIR.mkdir(exist_ok=True)

    all_trades: List[TradeResult] = []
    cache_file = OUTPUT_DIR / "all_trades_cache.json"

    if args.graph_only:
        # Load from cache
        if cache_file.exists():
            with open(cache_file) as f:
                data = json.load(f)
            all_trades = [TradeResult(**t) for t in data]
            print(f"[INFO] Loaded {len(all_trades)} trades from cache")
        else:
            print("[ERROR] No cached trades found. Run a scan first.")
            sys.exit(1)
    else:
        # Build symbol list
        symbols = []
        us_tickers_only = False

        if args.symbol:
            symbols = [args.symbol]
        elif args.scan:
            nse_syms = fetch_nse_symbols()
            nse_syms_yf = [yf_sym(s) for s in nse_syms]
            symbols = nse_syms_yf + US_TICKERS
            if args.scan.lower() != "all":
                max_n = int(args.scan)
                symbols = symbols[:max_n]
            print(f"[INFO] Symbol list: {len(symbols)} total ({len(nse_syms_yf)} NSE + {len(US_TICKERS)} US)")
        else:
            # Default: scan top 100
            symbols = [yf_sym(s) for s in fetch_nse_symbols()[:70]] + US_TICKERS
            print(f"[INFO] Default scan: {len(symbols)} symbols")

        t0 = time.time()
        done = 0
        total_syms = len(symbols)

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            fut_map = {ex.submit(scan_symbol, sym, fresh=args.fresh): sym for sym in symbols}
            for fut in as_completed(fut_map):
                done += 1
                try:
                    trades = fut.result()
                    if trades:
                        all_trades.extend(trades)
                except:
                    pass
                if done % 25 == 0 or done == total_syms:
                    print(f"[INFO] Progress: {done}/{total_syms}  |  Trades found: {len(all_trades)}", file=sys.stderr)

        elapsed = time.time() - t0
        print(f"\n[INFO] Scan complete: {done} symbols in {elapsed:.1f}s, {len(all_trades)} trades")

        # Cache results
        with open(cache_file, "w") as f:
            json.dump([t.__dict__ for t in all_trades], f, indent=2, default=str)
        print(f"[INFO] Trades cached: {cache_file}")

    # Generate graphs
    stock_stats = generate_graphs(all_trades, OUTPUT_DIR)
    print_report(all_trades, stock_stats)


if __name__ == "__main__":
    main()
