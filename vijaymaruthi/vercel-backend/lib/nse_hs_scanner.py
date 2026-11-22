#!/usr/bin/env python3
"""
NSE Head & Shoulders Pattern Scanner — v2 (Strict)

Validates:
  1. Prior uptrend before left shoulder (30-day slope > 0)
  2. Minimum 10 bars between LS→Head and Head→RS
  3. Head ≥ 2% above both shoulders
  4. Shoulders within 15% of each other
  5. Neckline break ≥ 1% below neckline
  6. Sustained break: price below break-neckline and below head
  7. Volume: both LS and Head volume exceed RS volume
  8. Time symmetry: RS-dur / LS-dur ∈ [0.25, 4.0]

Usage:
    python nse_hs_scanner.py --list
    python nse_hs_scanner.py --symbol TCS.NS
    python nse_hs_scanner.py --scan 100
    python nse_hs_scanner.py --scan all
    python nse_hs_scanner.py --scan all --fresh
"""

import argparse
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import matplotlib
matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
import yfinance as yf
from scipy.ndimage import gaussian_filter1d
from scipy.signal import argrelextrema

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# ─── Constants ────────────────────────────────────────────────────────────────
OUTPUT_DIR = Path("hs_charts")

def _reset_output_dir():
    if OUTPUT_DIR.exists():
        import shutil
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(exist_ok=True)

CACHE_DIR = Path(".hs_cache")
CACHE_DIR.mkdir(exist_ok=True)

NSE_EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

# Colours
C_PRICE     = "#1a1a2e"
C_VOL       = "#c0c0c0"
C_NECK      = "#e94560"
C_LS        = "#0f3460"
C_HEAD      = "#e94560"
C_RS        = "#0f3460"
C_TR        = "#16213e"
C_BREAK     = "#e94560"
C_UPTREND   = "#2d6a4f"
C_TARGET    = "#2d6a4f"


# ─── Data Structures ──────────────────────────────────────────────────────────

@dataclass
class HSPattern:
    symbol: str
    start_idx: int
    ls_idx: int
    trough1_idx: int
    head_idx: int
    trough2_idx: int
    rs_idx: int
    break_idx: int
    neckline_slope: float
    neckline_intercept: float
    confidence: float
    volume_declining: bool
    target_price: float
    current_price: float
    break_price: float
    ls_price: float
    head_price: float
    rs_price: float
    t1_price: float
    t2_price: float
    uptrend_start_idx: int


# ─── NSE Symbols ──────────────────────────────────────────────────────────────

def fetch_nse_symbols() -> list[str]:
    local_csv = CACHE_DIR / "nse_equity_list.csv"
    if local_csv.exists() and (datetime.now() - datetime.fromtimestamp(local_csv.stat().st_mtime)).days < 1:
        df = pd.read_csv(local_csv)
        symbols = df["SYMBOL"].dropna().str.strip().tolist()
        print(f"[INFO] Loaded {len(symbols)} NSE symbols from cache", file=sys.stderr)
        return symbols
    print(f"[INFO] Fetching NSE equity list...", file=sys.stderr)
    try:
        resp = requests.get(NSE_EQUITY_LIST_URL, timeout=30)
        if resp.status_code == 200:
            with open(local_csv, "wb") as f:
                f.write(resp.content)
            df = pd.read_csv(local_csv)
            symbols = df["SYMBOL"].dropna().str.strip().tolist()
            print(f"[INFO] Fetched {len(symbols)} NSE symbols", file=sys.stderr)
            return symbols
        print(f"[WARN] HTTP {resp.status_code}, using fallback", file=sys.stderr)
        return _fallback_symbols()
    except Exception as e:
        print(f"[WARN] {e}, using fallback", file=sys.stderr)
        return _fallback_symbols()


def _fallback_symbols() -> list[str]:
    return [
        "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR",
        "ITC","SBIN","BHARTIARTL","KOTAKBANK","BAJFINANCE","LT",
        "AXISBANK","WIPRO","MARUTI","HCLTECH","TITAN","ULTRACEMCO",
        "SUNPHARMA","ADANIPORTS","M&M","NTPC","POWERGRID","NESTLEIND",
        "ASIANPAINT","ONGC","JSWSTEEL","TATASTEEL","COALINDIA","ADANIENT",
    ]


def yf_sym(sym: str) -> str:
    sym = sym.strip().upper()
    return sym if sym.endswith(".NS") else sym + ".NS"


# ─── Data ─────────────────────────────────────────────────────────────────────

def load_data(symbol: str, months: int = 12, fresh: bool = False) -> Optional[pd.DataFrame]:
    ticker = yf_sym(symbol)
    cache_file = CACHE_DIR / f"{ticker.replace('.', '_')}.pkl"

    if not fresh and cache_file.exists():
        df = pd.read_pickle(cache_file)
        age = (datetime.now() - datetime.fromtimestamp(cache_file.stat().st_mtime)).days
        if age < 1 and len(df) >= months * 20:
            return df

    end = datetime.now()
    start = end - timedelta(days=months * 35)
    try:
        data = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
    except Exception:
        return None

    if data is None or data.empty:
        return None

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0].lower() for col in data.columns]
    else:
        data.columns = [c.lower() for c in data.columns]

    data.to_pickle(cache_file)
    return data


# ─── Peak / Trough ────────────────────────────────────────────────────────────

def find_extrema(close: np.ndarray, order: int = 7):
    """Return (peak_indices, trough_indices) using scipy argrelextrema."""
    peaks = argrelextrema(close, np.greater, order=order)[0]
    troughs = argrelextrema(close, np.less, order=order)[0]
    return peaks, troughs


# ─── Detection ────────────────────────────────────────────────────────────────

def _uptrend_slope(close, start, end) -> float:
    """Return slope of linear fit over [start, end]. Negative = downtrend."""
    if end - start < 10:
        return 0.0
    x = np.arange(end - start + 1)
    y = close[start:end + 1]
    slope, _ = np.polyfit(x, y, 1)
    return slope


def detect_hs(df: pd.DataFrame, order: int = 5, months: int = 12) -> Optional[HSPattern]:
    """
    Head & Shoulders (top) detection.

    Validation gates:
      1. Prior uptrend before LS (30-day slope > 0)
      2. LS / Head / RS spaced ≥ 10 days apart
      3. Head ≥ 2% above each shoulder
      4. Shoulder heights within 15% of each other
      5. Neckline break ≥ 1% below neckline
      6. Sustained break: price below break-neckline AND below head
      7. Volume: mean(LS) > mean(RS) and mean(Head) > mean(RS)
      8. Time ratio RS-dur / LS-dur ∈ [0.25, 4.0]
    """
    close = df["close"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    n = len(close)

    if n < 80:
        return None

    smoothed = gaussian_filter1d(close, sigma=1.8)
    peaks, _ = find_extrema(smoothed, order=order)

    if len(peaks) < 3:
        return None

    best = None
    best_conf = 0.0

    for i in range(len(peaks) - 3, -1, -1):
        ls_idx  = int(peaks[i])
        head_idx = int(peaks[i + 1])
        rs_idx   = int(peaks[i + 2])

        # ── 1. Minimum spacing ──
        if (head_idx - ls_idx) < 10 or (rs_idx - head_idx) < 10:
            continue
        if (rs_idx - ls_idx) > n * 0.8:
            continue

        ls_p  = close[ls_idx]
        h_p   = close[head_idx]
        rs_p  = close[rs_idx]

        # ── 2. Head must be highest ──
        if not (h_p > ls_p and h_p > rs_p):
            continue

        # ── 3. Head ≥ 2% above shoulders ──
        if (h_p - ls_p) / ls_p < 0.02 or (h_p - rs_p) / rs_p < 0.02:
            continue

        # ── 4. Shoulder height within 15% ──
        shoulder_diff = abs(ls_p - rs_p) / max(ls_p, rs_p)
        if shoulder_diff > 0.15:
            continue

        # ── 5. Prior uptrend (30 days before LS) ──
        lookback = min(30, ls_idx - 5)
        trend_start = ls_idx - lookback
        if _uptrend_slope(close, trend_start, ls_idx) <= 0:
            continue

        # ── 6. Troughs (using low prices for accurate neckline) ──
        low_prices = df["low"].values.astype(np.float64)
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

        # ── 7. Neckline ──
        if (t2_idx - t1_idx) == 0:
            continue
        m = (t2_p - t1_p) / (t2_idx - t1_idx)
        c = t1_p - m * t1_idx

        def neck_val(idx): return m * idx + c

        # ── 8. Neckline break ──
        break_idx = None
        for j in range(rs_idx + 1, n):
            nv = neck_val(j)
            if close[j] < nv and (nv - close[j]) / nv >= 0.01:
                break_idx = j
                break

        if break_idx is None:
            continue

        # ── 9. SUSTAINED BREAK: must be below neckline AND below head ──
        # For upward-sloping necklines, cap reference at break neckline level.
        break_neck = neck_val(break_idx)
        if close[-1] >= break_neck or close[-1] >= h_p:
            continue
        recent_avg = np.mean(close[max(0, n-5):n])
        recent_neck_avg = np.mean([min(neck_val(i), break_neck) for i in range(max(0, n-5), n)])
        if recent_avg >= recent_neck_avg:
            continue

        # ── 10. Volume: LS and Head should both exceed RS ──
        vol_ls   = float(np.mean(volume[max(0, ls_idx-3):ls_idx+1]))
        vol_head = float(np.mean(volume[max(0, head_idx-3):head_idx+1]))
        vol_rs   = float(np.mean(volume[max(0, rs_idx-3):rs_idx+1]))
        if not (vol_ls > vol_rs and vol_head > vol_rs):
            continue

        # ── 11. Time symmetry ──
        ls_dur = head_idx - ls_idx
        rs_dur = rs_idx - head_idx
        ratio = rs_dur / ls_dur if ls_dur > 0 else 99
        if ratio < 0.25 or ratio > 4.0:
            continue

        # ───→ Pattern passes all gates ←───
        conf = 0.50

        if shoulder_diff < 0.05:
            conf += 0.10
        elif shoulder_diff < 0.10:
            conf += 0.05

        head_prom = min((h_p - ls_p) / ls_p, (h_p - rs_p) / rs_p)
        if head_prom >= 0.08:
            conf += 0.10
        elif head_prom >= 0.05:
            conf += 0.05

        break_depth = (neck_val(break_idx) - close[break_idx]) / neck_val(break_idx)
        if break_depth >= 0.03:
            conf += 0.10
        elif break_depth >= 0.02:
            conf += 0.05

        if 0.5 <= ratio <= 2.0:
            conf += 0.05
        if vol_ls > vol_head:
            conf += 0.05

        vol_declining = vol_ls > vol_head > vol_rs

        conf = min(conf, 1.0)

        # ── Target (project head-to-neckline distance from break) ──
        head_neck = neck_val(head_idx)
        projection = h_p - head_neck
        target = neck_val(break_idx) - projection

        if conf > best_conf:
            best_conf = conf
            best = HSPattern(
                symbol="",
                start_idx=max(0, ls_idx - 35),
                ls_idx=ls_idx,
                trough1_idx=t1_idx,
                head_idx=head_idx,
                trough2_idx=t2_idx,
                rs_idx=rs_idx,
                break_idx=break_idx,
                neckline_slope=m,
                neckline_intercept=c,
                confidence=round(conf, 2),
                volume_declining=vol_declining,
                target_price=round(target, 2),
                current_price=round(close[-1], 2),
                break_price=round(close[break_idx], 2),
                ls_price=round(ls_p, 2),
                head_price=round(h_p, 2),
                rs_price=round(rs_p, 2),
                t1_price=round(t1_p, 2),
                t2_price=round(t2_p, 2),
                uptrend_start_idx=trend_start,
            )

    return best


# ─── Charting ─────────────────────────────────────────────────────────────────

def plot_pattern(df: pd.DataFrame, p: HSPattern, save_path: Path):
    """Draw an annotated chart with the H&S pattern marked."""
    sub = df.iloc[p.start_idx:].copy()
    close = sub["close"].values
    dates = sub.index
    volume = sub["volume"].values

    off = p.start_idx
    def a(i): return i - off

    ls  = a(p.ls_idx)
    t1  = a(p.trough1_idx)
    hd  = a(p.head_idx)
    t2  = a(p.trough2_idx)
    rs  = a(p.rs_idx)
    brk = a(p.break_idx)
    utr = a(p.uptrend_start_idx)

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(16, 9), gridspec_kw={"height_ratios": [3, 1]},
        sharex=True,
    )
    fig.patch.set_facecolor("#f8f9fa")

    # ── Price line ──
    ax1.plot(dates, close, color=C_PRICE, linewidth=1.5, zorder=2)
    ax1.fill_between(dates, close, alpha=0.04, color=C_PRICE)

    y_range = max(close) - min(close)

    # ── Prior uptrend ──
    if utr < ls:
        x_u = np.arange(utr, ls + 1)
        y_u = close[x_u]
        ax1.plot(dates[x_u], y_u, color=C_UPTREND, linewidth=2.5, linestyle="-",
                 alpha=0.7, label="Prior uptrend")

    # ── Neckline ──
    def neck_v(i): return p.neckline_slope * (i + off) + p.neckline_intercept
    xn = np.arange(t1, min(len(close), max(len(close), t2 + 1)))
    yn = [neck_v(int(i)) for i in xn]
    ax1.plot(dates[xn], yn, color=C_NECK, linewidth=2.5, linestyle="--", label="Neckline", zorder=5)

    # Extend neckline to end of chart
    ext_end = len(close)
    ext_x = np.arange(min(brk, len(close) - 1), ext_end)
    ext_y = [neck_v(int(i)) for i in ext_x]
    if len(ext_x) > 0:
        ax1.plot(dates[ext_x], ext_y, color=C_NECK, linewidth=2, linestyle=":", alpha=0.5, zorder=5)

    # ── Pattern labels on chart ──
    label_y = close[-1] + y_range * 0.03  # near top right for stats

    stats_lines = [
        f"LS ₹{p.ls_price}  RS ₹{p.rs_price}",
        f"Head ₹{p.head_price}  (+{((p.head_price-p.ls_price)/p.ls_price*100):.1f}% / +{((p.head_price-p.rs_price)/p.rs_price*100):.1f}%)",
        f"T1 ₹{p.t1_price}  T2 ₹{p.t2_price}  (neck slope: {p.neckline_slope:.2f}/day)",
        f"Break ₹{close[brk]:.1f}  ▼  at neck ₹{neck_v(p.break_idx):.1f}",
        f"Current ₹{p.current_price}  ▼  neck ₹{neck_v(len(close)-1):.1f}",
    ]
    for line_idx, txt in enumerate(stats_lines):
        ax1.text(dates[-1], label_y - line_idx * y_range * 0.045, txt,
                 fontsize=8.5, color="#333", ha="right", va="top",
                 bbox=dict(boxstyle="round,pad=0.3", facecolor="white", edgecolor="#ccc", alpha=0.85))

    # ── Price labels on peaks/troughs ──
    for idx, clr, lbl in [
        (ls, C_LS, "LS ₹" + str(p.ls_price)),
        (hd, C_HEAD, "H ₹" + str(p.head_price)),
        (rs, C_RS, "RS ₹" + str(p.rs_price)),
    ]:
        ax1.scatter(dates[idx], close[idx], color=clr, marker="o", s=160,
                    edgecolors="black", linewidth=2, zorder=8)
        ax1.annotate(lbl, xy=(dates[idx], close[idx]),
                     xytext=(0, -20), textcoords="offset points",
                     fontsize=8, fontweight="bold", color=clr, ha="center",
                     bbox=dict(boxstyle="round,pad=0.2", facecolor="white", edgecolor=clr, alpha=0.8))

    for idx, clr, lbl in [
        (t1, C_TR, "T1"),
        (t2, C_TR, "T2"),
    ]:
        ax1.scatter(dates[idx], close[idx], color=clr, marker="^", s=130,
                    edgecolors="black", linewidth=2, zorder=8)
        ax1.annotate(lbl, xy=(dates[idx], close[idx]),
                     xytext=(0, 18), textcoords="offset points",
                     fontsize=8, fontweight="bold", color=clr, ha="center")

    # ── Break marker ──
    ax1.scatter(dates[brk], close[brk], color=C_BREAK, marker="v", s=250,
                edgecolors="black", linewidth=2.5, zorder=12)
    ax1.annotate(f"BREAK\n₹{close[brk]:.1f}", xy=(dates[brk], close[brk]),
                 xytext=(0, -42), textcoords="offset points", fontsize=9,
                 fontweight="bold", color=C_BREAK, ha="center",
                 bbox=dict(boxstyle="round,pad=0.25", facecolor="#ffe0e0", edgecolor=C_BREAK, alpha=0.9))

    # ── Target annotation (bottom right) ──
    tgt = p.target_price
    tgt_color = "#d32f2f" if tgt < close[-1] else "#2e7d32"
    ax1.axhline(y=tgt, color=tgt_color, linewidth=1.5, linestyle=":", alpha=0.6)
    # Target label at bottom-right of chart
    ax1.annotate(
        f"Target\n₹{tgt:.1f}\n({((tgt - close[-1]) / close[-1] * 100):.1f}%)",
        xy=(dates[-1], tgt),
        xytext=(-10, 0), textcoords="offset points",
        fontsize=11, fontweight="bold", color=tgt_color, ha="right", va="bottom",
        bbox=dict(boxstyle="round,pad=0.4", facecolor="white", edgecolor=tgt_color, alpha=0.9)
    )

    # ── Title ──
    title = (
        f"{p.symbol}  |  H&S (Top)  conf={p.confidence:.0%}  "
        f"break ₹{close[brk]:.1f}  target ₹{tgt:.1f}  current ₹{p.current_price}"
    )
    ax1.set_title(title, fontsize=13, fontweight="bold", pad=10, color="#1a1a2e")
    ax1.set_ylabel("Price (₹)", fontsize=11)
    ax1.legend(loc="upper left", fontsize=8, framealpha=0.9, ncol=3)
    ax1.grid(True, alpha=0.12)
    ax1.set_facecolor("#ffffff")

    # ── Volume ──
    ax2.bar(dates, volume, color=C_VOL, alpha=0.5, width=0.8)
    for vi, clr in [(ls, C_LS), (hd, C_HEAD), (rs, C_RS)]:
        if vi < len(dates):
            ax2.bar(dates[vi], volume[vi], color=clr, alpha=0.8, width=0.8)
    ax2.set_ylabel("Volume", fontsize=11)
    ax2.set_xlabel("Date", fontsize=11)
    ax2.grid(True, alpha=0.12)
    ax2.set_facecolor("#ffffff")

    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax1.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    plt.xticks(rotation=45, ha="right")

    plt.tight_layout()
    fig.savefig(save_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


# ─── Scanner ──────────────────────────────────────────────────────────────────

def scan_one(symbol: str, months: int = 12, order: int = 5,
             generate_image: bool = True, fresh: bool = False) -> Optional[HSPattern]:
    df = load_data(symbol, months=months, fresh=fresh)
    if df is None or len(df) < 100:
        return None

    pat = detect_hs(df, order=order, months=months)
    if pat and generate_image:
        pat.symbol = yf_sym(symbol)
        safe = yf_sym(symbol).replace(".", "_")
        img_path = OUTPUT_DIR / f"{safe}_HS.png"
        try:
            plot_pattern(df, pat, img_path)
            print(f"  [✓] {pat.symbol:22s} conf={pat.confidence:.0%}  "
                  f"break=₹{pat.break_price:<8.1f}  curr=₹{pat.current_price:<8.1f}  "
                  f"target=₹{pat.target_price:<8.1f}  → {img_path.name}")
        except Exception as e:
            print(f"  [✓] {pat.symbol:22s} conf={pat.confidence:.0%}  "
                  f"target=₹{pat.target_price:<8.1f}  [image: {e}]")
    elif pat:
        print(f"  [✓] {yf_sym(symbol):22s} conf={pat.confidence:.0%}  "
              f"target=₹{pat.target_price:<8.1f}")

    return pat


def scan_all(symbols: list[str], max_stocks: int = 0, months: int = 12,
             order: int = 5, workers: int = 6, fresh: bool = False) -> list[HSPattern]:
    if max_stocks > 0:
        symbols = symbols[:max_stocks]

    print(f"[INFO] Scanning {len(symbols)} NSE stocks ({workers} workers, "
          f"{months} months, fresh={fresh})...", file=sys.stderr)

    found: list[HSPattern] = []
    done = 0

    with ThreadPoolExecutor(max_workers=workers) as ex:
        fut_map = {
            ex.submit(scan_one, sym, months=months, order=order,
                      generate_image=True, fresh=fresh): sym
            for sym in symbols
        }
        for fut in as_completed(fut_map):
            done += 1
            try:
                pat = fut.result()
                if pat:
                    found.append(pat)
            except Exception as e:
                pass
            if done % 25 == 0 or done == len(symbols):
                print(f"[INFO] Progress: {done}/{len(symbols)}  |  "
                      f"Found: {len(found)}", file=sys.stderr)

    return found


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="NSE Head & Shoulders Scanner (Strict v2)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--scan", type=str, nargs="?", const="50", default=None,
                   help="Scan NSE stocks (default: 50, use 'all' for all)")
    g.add_argument("--symbol", type=str, nargs="?", const="TCS.NS",
                   help="Scan a single symbol")
    g.add_argument("--list", action="store_true", help="List NSE symbols")

    parser.add_argument("--months", type=int, default=12)
    parser.add_argument("--order", type=int, default=5,
                        help="Peak sensitivity: higher = fewer peaks (default 5)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--no-images", action="store_true")
    parser.add_argument("--fresh", action="store_true",
                        help="Clear cache and re-download data")

    args = parser.parse_args()

    # Reset output directory and optionally clear cache
    _reset_output_dir()
    if args.fresh:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
            print("[INFO] Cache cleared", file=sys.stderr)
        CACHE_DIR.mkdir(exist_ok=True)

    # ── List ──
    if args.list:
        symbols = fetch_nse_symbols()
        print(f"\n{'Symbol':<20s}Yahoo Ticker\n" + "-" * 40)
        for s in symbols[:100]:
            print(f"{s:<20s}{yf_sym(s)}")
        print(f"\n... {len(symbols) - 100} more" if len(symbols) > 100 else "")
        print(f"Total: {len(symbols)}")
        return

    # ── Single ──
    if args.symbol:
        sym = yf_sym(args.symbol)
        print(f"\n[INFO] Scanning {sym}...")
        pat = scan_one(sym, months=args.months, order=args.order,
                       generate_image=not args.no_images, fresh=args.fresh)
        if pat:
            vol_label = "Declining" if pat.volume_declining else "LS,Head > RS"
            print(f"\n  ✓ HEAD & SHOULDERS FOUND")
            print(f"     Symbol:       {pat.symbol}")
            print(f"     Confidence:   {pat.confidence:.0%}")
            print(f"     Left Shoulder:  ₹{pat.ls_price}")
            print(f"     Head:           ₹{pat.head_price}")
            print(f"     Right Shoulder: ₹{pat.rs_price}")
            print(f"     Break Price:    ₹{pat.break_price}")
            print(f"     Target Price:   ₹{pat.target_price}")
            print(f"     Volume:        {vol_label}")
        else:
            print(f"\n  ✗ No H&S pattern detected (strict criteria)")
        return

    # ── Scan ──
    symbols_raw = fetch_nse_symbols()
    symbols_yf  = [yf_sym(s) for s in symbols_raw]

    max_n = 0
    if args.scan and args.scan.lower() != "all":
        max_n = int(args.scan)

    t0 = time.time()
    found = scan_all(symbols_yf, max_stocks=max_n, months=args.months,
                     order=args.order, workers=args.workers, fresh=args.fresh)
    elapsed = time.time() - t0

    scanned = min(max_n, len(symbols_yf)) if max_n else len(symbols_yf)

    print("\n" + "=" * 75)
    print("SCAN SUMMARY (Strict v2)")
    print("=" * 75)
    print(f"  Stocks scanned:  {scanned}")
    print(f"  H&S found:       {len(found)}  ({len(found)/scanned*100:.1f}% hit rate)")
    print(f"  Time:            {elapsed:.1f}s")
    print(f"  Charts:          {OUTPUT_DIR.resolve()}")

    if found:
        found.sort(key=lambda p: p.confidence, reverse=True)
        print(f"\n  {'Ticker':<22s} {'Conf':>5s} {'LS':>8s} {'Head':>8s} {'RS':>8s} "
              f"{'Break':>8s} {'Curr':>8s} {'Target':>8s}")
        print(f"  {'-'*22} {'-'*5} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8}")
        for p in found[:30]:
            print(f"  {p.symbol:<22s} {p.confidence*100:>3.0f}%  "
                  f"₹{p.ls_price:>7.1f} ₹{p.head_price:>7.1f} ₹{p.rs_price:>7.1f} "
                  f"₹{p.break_price:>7.1f} ₹{p.current_price:>7.1f} ₹{p.target_price:>7.1f}")
    else:
        print("\n  No patterns found meeting strict criteria.")


if __name__ == "__main__":
    main()
