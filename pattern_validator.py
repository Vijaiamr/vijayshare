#!/usr/bin/env python3
"""
==============================================================================
MULTI-PATTERN VALIDATOR — Full-Spectrum NSE Stock Analysis Engine
==============================================================================
Validates chart patterns, candlestick patterns, and fundamental signals
across daily, weekly, and monthly timeframes for all NSE stocks.
Generates a comprehensive obey/not-obey report.

Usage:
    python pattern_validator.py --scan 100              # First 100 stocks
    python pattern_validator.py --scan all --workers 12  # Full universe
    python pattern_validator.py --symbol RELIANCE        # Single stock
    python pattern_validator.py --report-only            # Regen report from cache
==============================================================================
"""

import argparse
import json
import logging
import math
import os
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple, Set

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from scipy import signal as scipy_signal
from scipy.ndimage import gaussian_filter1d

warnings.filterwarnings("ignore")

# ─── Suppress yfinance HTTP error noise (401s flood stderr otherwise) ─────
logging.getLogger("yfinance").setLevel(logging.CRITICAL)
logging.getLogger("urllib3").setLevel(logging.CRITICAL)
logging.getLogger("requests").setLevel(logging.CRITICAL)

# ─── Global HTTP session with proper User-Agent for Yahoo Finance ──────────
_YF_SESSION = requests.Session()
_YF_SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
_YF_SESSION.headers["Accept"] = "application/json"
_YF_SESSION.headers["Accept-Language"] = "en-US,en;q=0.9"
# Set short timeouts to prevent hanging on rate-limited endpoints
_YF_SESSION.timeout = (3.05, 10)  # (connect_timeout, read_timeout)
# Note: yf.download and yf.Ticker both accept session= parameter

# ─── Per-worker rate limiter for Yahoo Finance API calls ────────────────────
# Each worker thread has its own throttle to avoid global lock contention.
# This allows workers to call Yahoo concurrently while respecting per-worker
# min interval. Yahoo's actual rate limit is ~10 req/s for download endpoints
# and ~2 req/s for info endpoints.
import threading as _threading
_yf_last_call: Dict[int, float] = {}
_yf_rate_lock = _threading.Lock()  # only guards the dict, not the sleep

def _yf_rate_limit(min_interval: float = 0.4):
    """Worker-local rate limiting — each thread self-throttles."""
    tid = _threading.get_ident()
    now = time.time()
    with _yf_rate_lock:
        last = _yf_last_call.get(tid, 0.0)
        elapsed = now - last
        if elapsed >= min_interval:
            _yf_last_call[tid] = now
            return  # no sleep needed
        sleep_for = min_interval - elapsed
    # Sleep OUTSIDE the lock so other workers aren't blocked
    time.sleep(sleep_for)
    with _yf_rate_lock:
        _yf_last_call[tid] = time.time()

# ─── Paths ───────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = BASE_DIR / "validation_results"
CACHE_DIR = BASE_DIR / ".validation_cache"
REPORT_DIR = BASE_DIR / "reports"
DOC_DIR = BASE_DIR / "document"
SYMBOLS_FILE = DOC_DIR / "nse_symbols.txt"
NSE_EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

OUTPUT_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)
REPORT_DIR.mkdir(exist_ok=True)

# ─── Colors ───────────────────────────────────────────────────────────────────
C_GREEN = "#2d6a4f"
C_RED = "#e94560"
C_BLUE = "#0f3460"
C_ORANGE = "#f39c12"

# ─── Data Structures ─────────────────────────────────────────────────────────

@dataclass
class ChartPattern:
    """A detected chart pattern with validation results."""
    symbol: str
    pattern_type: str          # H&S_TOP, IH&S_BOTTOM, DOUBLE_TOP, DOUBLE_BOTTOM,
                               # TRIPLE_TOP, TRIPLE_BOTTOM, BULL_FLAG, BEAR_FLAG,
                               # RISING_WEDGE, FALLING_WEDGE, CUP_HANDLE
    timeframe: str             # daily, weekly, monthly
    direction: str             # bullish, bearish
    entry_date: str
    entry_price: float
    target_price: float
    stop_loss: float
    confidence: float          # 0-100
    breakout_price: float
    neckline_or_hline: float
    pattern_length_bars: int
    rr_ratio: float
    volume_confirmed: bool
    trend_confirmed: bool
    # Validation (filled after lookahead)
    exit_date: str = ""
    exit_price: float = 0.0
    exit_reason: str = ""      # TARGET_HIT, STOP_LOSS_HIT, TIME_EXIT
    max_favorable_excursion: float = 0.0
    max_adverse_excursion: float = 0.0
    pnl_pct: float = 0.0
    obeyed: bool = False       # Did price move as pattern predicted?


@dataclass
class CandlestickSignal:
    """A detected candlestick pattern."""
    symbol: str
    pattern_name: str          # DOJI, HAMMER, SHOOTING_STAR, BULLISH_ENGULFING,
                               # BEARISH_ENGULFING, MORNING_STAR, EVENING_STAR,
                               # THREE_WHITE_SOLDIERS, THREE_BLACK_CROWS,
                               # PIERCING, DARK_CLOUD, HARAMI
    timeframe: str
    direction: str
    date: str
    price: float
    confirmation_price: float
    stop_loss: float
    target: float
    rr_ratio: float
    # Validation
    exit_date: str = ""
    exit_price: float = 0.0
    pnl_pct: float = 0.0
    obeyed: bool = False


@dataclass
class FundamentalSignal:
    """Fundamental analysis signal."""
    symbol: str = ""
    pe_ratio: float = 0.0
    pb_ratio: float = 0.0
    roe_pct: float = 0.0
    roce_pct: float = 0.0
    debt_to_equity: float = 0.0
    revenue_growth_pct: float = 0.0
    profit_growth_pct: float = 0.0
    operating_margin_pct: float = 0.0
    profit_margin_pct: float = 0.0
    current_ratio: float = 0.0
    dividend_yield_pct: float = 0.0
    market_cap_cr: float = 0.0
    sector: str = ""
    industry: str = ""
    overall_rating: str = ""   # STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL
    score: float = 0.0         # 0-100


@dataclass
class StockResult:
    """Complete analysis result for one stock."""
    symbol: str
    company_name: str = ""
    sector: str = ""
    chart_patterns: List[ChartPattern] = field(default_factory=list)
    candlestick_signals: List[CandlestickSignal] = field(default_factory=list)
    fundamental: Optional[FundamentalSignal] = None
    overall_chart_obey: bool = False
    overall_candle_obey: bool = False
    overall_fundamental_bullish: bool = False
    prediction: str = ""       # GROW, FALL, NEUTRAL
    prediction_confidence: float = 0.0
    errors: List[str] = field(default_factory=list)
    # Convolution validation fields
    conviction_score: float = 0.0      # 0-100 conviction strength
    conviction_rating: str = ""        # STRONG, MODERATE, WEAK, NEUTRAL
    conviction_direction: str = ""     # bullish, bearish, neutral
    signal_confluence: Dict = field(default_factory=dict)


@dataclass
class ValidationReport:
    """Aggregate validation results across all stocks."""
    total_stocks: int = 0
    stocks_with_patterns: int = 0
    total_chart_patterns: int = 0
    total_candle_signals: int = 0
    # Obey rates by pattern type
    pattern_obey_rates: Dict[str, Dict] = field(default_factory=dict)
    # Obey rates by timeframe
    timeframe_obey_rates: Dict[str, Dict] = field(default_factory=dict)
    # Obey rates by sector
    sector_obey_rates: Dict[str, Dict] = field(default_factory=dict)
    # Overall stats
    overall_chart_obey_rate: float = 0.0
    overall_candle_obey_rate: float = 0.0
    total_stocks_grow_prediction: int = 0
    total_stocks_fall_prediction: int = 0
    prediction_accuracy: float = 0.0
    # Cross-validation
    app_analysis_match_rate: float = 0.0
    discrepancies: List[Dict] = field(default_factory=list)
    # Raw data
    stock_results: List[StockResult] = field(default_factory=list)
    scan_parameters: Dict = field(default_factory=dict)
    # Convolution validation metrics
    conviction_distribution: Dict[str, int] = field(default_factory=lambda: {"STRONG": 0, "MODERATE": 0, "WEAK": 0, "NEUTRAL": 0})
    conviction_grow_count: int = 0
    conviction_fall_count: int = 0
    high_conviction_stocks: List[Dict] = field(default_factory=list)


# ============================================================================
# DATA LOADING
# ============================================================================

def fetch_nse_symbols() -> List[str]:
    """Fetch NSE equity symbols from NSE or local cache."""
    if SYMBOLS_FILE.exists():
        with open(SYMBOLS_FILE) as f:
            return [line.strip() for line in f if line.strip()]
    try:
        resp = requests.get(NSE_EQUITY_LIST_URL, timeout=30)
        if resp.status_code == 200:
            csv_path = CACHE_DIR / "nse_equity_list.csv"
            with open(csv_path, "wb") as f:
                f.write(resp.content)
            df = pd.read_csv(csv_path)
            return df["SYMBOL"].dropna().str.strip().tolist()
    except Exception:
        pass
    return []


def yf_sym(symbol: str) -> str:
    """Convert NSE symbol to Yahoo Finance format."""
    s = symbol.strip().upper()
    return s if s.endswith(".NS") or "." in s else s + ".NS"


def load_data(symbol: str, period: str = "5y", fresh: bool = False) -> Optional[pd.DataFrame]:
    """Load daily OHLCV data with caching."""
    ticker = yf_sym(symbol)
    cache_file = CACHE_DIR / f"{ticker.replace('.', '_')}_daily.pkl"

    if not fresh and cache_file.exists():
        try:
            df = pd.read_pickle(cache_file)
            if len(df) >= 200:
                return df
        except Exception:
            pass

    try:
        data = yf.download(ticker, period=period, interval="1d", auto_adjust=True, progress=False)
    except Exception:
        return None

    if data is None or data.empty:
        return None

    # Flatten MultiIndex columns
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0].lower() for col in data.columns]
    else:
        data.columns = [c.lower() for c in data.columns]

    data.to_pickle(cache_file)
    return data


def load_multi_tf_data(symbol: str, fresh: bool = False) -> Dict[str, Optional[pd.DataFrame]]:
    """Load daily, weekly, and monthly data for a symbol."""
    ticker = yf_sym(symbol)
    result = {"daily": None, "weekly": None, "monthly": None}

    configs = [
        ("daily", "5y", "1d", 200),
        ("weekly", "10y", "1wk", 100),
        ("monthly", "20y", "1mo", 30),
    ]

    for tf_name, period, interval, min_bars in configs:
        cache_file = CACHE_DIR / f"{ticker.replace('.', '_')}_{tf_name}.pkl"

        if not fresh and cache_file.exists():
            try:
                df = pd.read_pickle(cache_file)
                if len(df) >= min_bars:
                    result[tf_name] = df
                    continue
            except Exception:
                pass

        try:
            _yf_rate_limit(0.08)  # throttle per-worker to ~12 req/s
            data = yf.download(ticker, period=period, interval=interval,
                              auto_adjust=True, progress=False)
            if data is not None and not data.empty:
                if isinstance(data.columns, pd.MultiIndex):
                    data.columns = [col[0].lower() for col in data.columns]
                else:
                    data.columns = [c.lower() for c in data.columns]
                if len(data) >= min_bars:
                    result[tf_name] = data
                    data.to_pickle(cache_file)
        except Exception:
            pass

    return result


def fetch_fundamentals(symbol: str) -> Optional[Dict]:
    """Fetch fundamental data via yfinance info (single attempt, fail fast)."""
    try:
        _yf_rate_limit(0.15)
        ticker = yf.Ticker(yf_sym(symbol), session=_YF_SESSION)
        info = ticker.info
        if not info or info.get("regularMarketPrice") is None:
            return None

        return {
            "pe_ratio": info.get("trailingPE") or info.get("forwardPE") or 0,
            "pb_ratio": info.get("priceToBook") or 0,
            "roe_pct": (info.get("returnOnEquity", 0) or 0) * 100,
            "roce_pct": (info.get("returnOnCapital", 0) or 0) * 100,
            "debt_to_equity": info.get("debtToEquity", 0) or 0,
            "revenue_growth_pct": (info.get("revenueGrowth", 0) or 0) * 100,
            "profit_growth_pct": (info.get("earningsGrowth", 0) or 0) * 100,
            "operating_margin_pct": (info.get("operatingMargins", 0) or 0) * 100,
            "profit_margin_pct": (info.get("profitMargins", 0) or 0) * 100,
            "current_ratio": info.get("currentRatio", 0) or 0,
            "dividend_yield_pct": (info.get("dividendYield", 0) or 0) * 100,
            "market_cap_cr": (info.get("marketCap", 0) or 0) / 1e7,
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "company_name": info.get("longName", ""),
            "beta": info.get("beta", 1.0),
        }
    except Exception:
        return None


# ============================================================================
# CHART PATTERN DETECTION
# ============================================================================

def find_pivots(series: np.ndarray, order: int = 5):
    """Find pivot highs and lows."""
    peaks = scipy_signal.argrelextrema(series, np.greater, order=order)[0]
    troughs = scipy_signal.argrelextrema(series, np.less, order=order)[0]
    return peaks, troughs


def _uptrend_slope(close: np.ndarray, start: int, end: int) -> float:
    if end - start < 10:
        return 0.0
    x = np.arange(end - start + 1)
    y = close[start:end + 1]
    slope, _ = np.polyfit(x, y, 1)
    return slope


def detect_hs_top(df: pd.DataFrame, order: int = 5) -> List[ChartPattern]:
    """Detect Head & Shoulders Top patterns."""
    results = []
    close = df["close"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    low = df["low"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    n = len(close)

    if n < 80:
        return results

    smoothed = gaussian_filter1d(close, sigma=1.8)
    peaks, _ = find_pivots(smoothed, order=order)
    if len(peaks) < 3:
        return results

    dates = df.index

    for i in range(len(peaks) - 2):
        ls_idx = int(peaks[i])
        head_idx = int(peaks[i + 1])
        rs_idx = int(peaks[i + 2])

        if (head_idx - ls_idx) < 10 or (rs_idx - head_idx) < 10:
            continue
        if (rs_idx - ls_idx) > n * 0.8:
            continue

        ls_p, h_p, rs_p = close[ls_idx], close[head_idx], close[rs_idx]

        if not (h_p > ls_p and h_p > rs_p):
            continue
        if (h_p - ls_p) / ls_p < 0.02 or (h_p - rs_p) / rs_p < 0.02:
            continue
        if abs(ls_p - rs_p) / max(ls_p, rs_p) > 0.15:
            continue

        lookback = min(30, ls_idx - 5)
        if _uptrend_slope(close, ls_idx - lookback, ls_idx) <= 0:
            continue

        # Troughs
        seg1 = slice(ls_idx, head_idx + 1)
        seg2 = slice(head_idx, rs_idx + 1)
        t1_idx = int(np.argmin(low[seg1]) + ls_idx)
        t2_idx = int(np.argmin(low[seg2]) + head_idx)

        if t1_idx in (ls_idx, head_idx) or t2_idx in (head_idx, rs_idx):
            continue
        if (t1_idx - ls_idx) < 5 or (head_idx - t1_idx) < 3 or (t2_idx - head_idx) < 3 or (rs_idx - t2_idx) < 5:
            continue

        t1_p, t2_p = close[t1_idx], close[t2_idx]
        m = (t2_p - t1_p) / (t2_idx - t1_idx) if (t2_idx - t1_idx) != 0 else 0
        c = t1_p - m * t1_idx

        def neck_val(idx): return m * idx + c

        # Find neckline break
        break_idx = None
        for j in range(rs_idx + 1, n):
            nv = neck_val(j)
            if close[j] < nv and (nv - close[j]) / nv >= 0.01:
                break_idx = j
                break
        if break_idx is None:
            continue

        break_neck = neck_val(break_idx)
        if close[-1] >= break_neck or close[-1] >= h_p:
            continue

        # Volume confirmation
        vol_ls = float(np.mean(volume[max(0, ls_idx - 3):ls_idx + 1]))
        vol_head = float(np.mean(volume[max(0, head_idx - 3):head_idx + 1]))
        vol_rs = float(np.mean(volume[max(0, rs_idx - 3):rs_idx + 1]))
        vol_confirmed = bool(vol_ls > vol_rs and vol_head > vol_rs)

        # Target & stop
        head_neck = neck_val(head_idx)
        projection = h_p - head_neck
        target = neck_val(break_idx) - projection
        stop_loss = float(np.max(high[max(0, rs_idx - 3):rs_idx + 1]))
        risk = stop_loss - close[break_idx]
        reward = close[break_idx] - target
        rr = reward / risk if risk > 0 else 0
        confidence = min(100, 50 + (5 if vol_confirmed else 0) + (10 if rr >= 2 else 0) + (5 if m > -0.5 else 0))

        results.append(ChartPattern(
            symbol="", pattern_type="H&S_TOP", timeframe="daily",
            direction="bearish",
            entry_date=str(dates[break_idx].date()),
            entry_price=round(float(close[break_idx]), 2),
            target_price=round(float(max(target, 0)), 2),
            stop_loss=round(float(stop_loss), 2),
            confidence=round(confidence, 1),
            breakout_price=round(float(close[break_idx]), 2),
            neckline_or_hline=round(float(break_neck), 2),
            pattern_length_bars=rs_idx - ls_idx,
            rr_ratio=round(rr, 2),
            volume_confirmed=vol_confirmed,
            trend_confirmed=True,
        ))

    return results


def detect_ihs_bottom(df: pd.DataFrame, order: int = 5) -> List[ChartPattern]:
    """Detect Inverse Head & Shoulders Bottom patterns."""
    results = []
    close = df["close"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    n = len(close)

    if n < 80:
        return results

    smoothed = gaussian_filter1d(close, sigma=1.8)
    _, troughs = find_pivots(smoothed, order=order)
    if len(troughs) < 3:
        return results

    dates = df.index

    for i in range(len(troughs) - 2):
        ls_idx = int(troughs[i])
        head_idx = int(troughs[i + 1])
        rs_idx = int(troughs[i + 2])

        if (head_idx - ls_idx) < 10 or (rs_idx - head_idx) < 10:
            continue
        if (rs_idx - ls_idx) > n * 0.8:
            continue

        ls_p, h_p, rs_p = close[ls_idx], close[head_idx], close[rs_idx]

        if not (h_p < ls_p and h_p < rs_p):
            continue
        if (ls_p - h_p) / ls_p < 0.02 or (rs_p - h_p) / rs_p < 0.02:
            continue
        if abs(ls_p - rs_p) / max(ls_p, rs_p) > 0.15:
            continue

        lookback = min(30, ls_idx - 5)
        if _uptrend_slope(close, ls_idx - lookback, ls_idx) >= 0:
            continue

        # Peaks
        seg1 = slice(ls_idx, head_idx + 1)
        seg2 = slice(head_idx, rs_idx + 1)
        p1_idx = int(np.argmax(high[seg1]) + ls_idx)
        p2_idx = int(np.argmax(high[seg2]) + head_idx)

        p1_p, p2_p = close[p1_idx], close[p2_idx]
        m = (p2_p - p1_p) / (p2_idx - p1_idx) if (p2_idx - p1_idx) != 0 else 0
        c = p1_p - m * p1_idx

        def neck_val(idx): return m * idx + c

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

        vol_ls = float(np.mean(volume[max(0, ls_idx - 3):ls_idx + 1]))
        vol_rs = float(np.mean(volume[max(0, rs_idx - 3):rs_idx + 1]))
        vol_confirmed = vol_rs >= vol_ls * 0.5

        head_neck = neck_val(head_idx)
        projection = head_neck - h_p
        target = neck_val(break_idx) + projection
        stop_loss = float(np.min(close[max(0, rs_idx - 3):rs_idx + 1]))
        risk = close[break_idx] - stop_loss
        reward = target - close[break_idx]
        rr = reward / risk if risk > 0 else 0
        confidence = min(100, 50 + (5 if vol_confirmed else 0) + (10 if rr >= 2 else 0))

        results.append(ChartPattern(
            symbol="", pattern_type="IH&S_BOTTOM", timeframe="daily",
            direction="bullish",
            entry_date=str(dates[break_idx].date()),
            entry_price=round(float(close[break_idx]), 2),
            target_price=round(float(target), 2),
            stop_loss=round(float(stop_loss), 2),
            confidence=round(confidence, 1),
            breakout_price=round(float(close[break_idx]), 2),
            neckline_or_hline=round(float(break_neck), 2),
            pattern_length_bars=rs_idx - ls_idx,
            rr_ratio=round(rr, 2),
            volume_confirmed=vol_confirmed,
            trend_confirmed=True,
        ))

    return results


def detect_double_top(df: pd.DataFrame, order: int = 5) -> List[ChartPattern]:
    """Detect Double Top patterns."""
    results = []
    close = df["close"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    n = len(close)

    if n < 60:
        return results

    peaks, _ = find_pivots(high, order=order)
    if len(peaks) < 2:
        return results

    dates = df.index

    for i in range(len(peaks) - 1):
        p1_idx = int(peaks[i])
        p2_idx = int(peaks[i + 1])

        if (p2_idx - p1_idx) < 15 or (p2_idx - p1_idx) > 120:
            continue

        p1_h, p2_h = high[p1_idx], high[p2_idx]

        # Peaks within 5% of each other
        if abs(p1_h - p2_h) / max(p1_h, p2_h) > 0.05:
            continue

        # Trough between peaks (the "valley")
        valley = np.min(close[p1_idx:p2_idx + 1])
        valley_idx = int(np.argmin(close[p1_idx:p2_idx + 1]) + p1_idx)

        # Neckline = the valley
        neckline = valley

        # Prior uptrend
        lookback = min(20, p1_idx - 5)
        if _uptrend_slope(close, p1_idx - lookback, p1_idx) <= 0:
            continue

        # Break below neckline
        break_idx = None
        for j in range(p2_idx + 1, n):
            if close[j] < neckline * 0.99:
                break_idx = j
                break
        if break_idx is None:
            continue

        # Volume on right peak should be lower
        vol_p1 = float(np.mean(volume[max(0, p1_idx - 3):p1_idx + 1]))
        vol_p2 = float(np.mean(volume[max(0, p2_idx - 3):p2_idx + 1]))
        vol_confirmed = vol_p2 < vol_p1

        # Target = neckline - (avg peak height - neckline)
        avg_peak = (p1_h + p2_h) / 2
        projection = avg_peak - neckline
        target = neckline - projection * 0.8
        stop_loss = max(p1_h, p2_h) * 1.02
        risk = stop_loss - close[break_idx]
        reward = close[break_idx] - target
        rr = reward / risk if risk > 0 else 0

        if rr < 1.0:
            continue

        confidence = min(100, 45 + (10 if vol_confirmed else 0) + (10 if rr >= 2 else 0))

        results.append(ChartPattern(
            symbol="", pattern_type="DOUBLE_TOP", timeframe="daily",
            direction="bearish",
            entry_date=str(dates[break_idx].date()),
            entry_price=round(float(close[break_idx]), 2),
            target_price=round(float(max(target, 0)), 2),
            stop_loss=round(float(stop_loss), 2),
            confidence=round(confidence, 1),
            breakout_price=round(float(close[break_idx]), 2),
            neckline_or_hline=round(float(neckline), 2),
            pattern_length_bars=p2_idx - p1_idx,
            rr_ratio=round(rr, 2),
            volume_confirmed=vol_confirmed,
            trend_confirmed=True,
        ))

    return results


def detect_double_bottom(df: pd.DataFrame, order: int = 5) -> List[ChartPattern]:
    """Detect Double Bottom patterns."""
    results = []
    close = df["close"].values.astype(np.float64)
    low = df["low"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    n = len(close)

    if n < 60:
        return results

    _, troughs = find_pivots(low, order=order)
    if len(troughs) < 2:
        return results

    dates = df.index

    for i in range(len(troughs) - 1):
        t1_idx = int(troughs[i])
        t2_idx = int(troughs[i + 1])

        if (t2_idx - t1_idx) < 15 or (t2_idx - t1_idx) > 120:
            continue

        t1_l, t2_l = low[t1_idx], low[t2_idx]

        if abs(t1_l - t2_l) / max(t1_l, t2_l) > 0.05:
            continue

        # Peak between troughs
        peak = np.max(close[t1_idx:t2_idx + 1])
        peak_idx = int(np.argmax(close[t1_idx:t2_idx + 1]) + t1_idx)

        neckline = peak

        # Prior downtrend
        lookback = min(20, t1_idx - 5)
        if _uptrend_slope(close, t1_idx - lookback, t1_idx) >= 0:
            continue

        # Break above neckline
        break_idx = None
        for j in range(t2_idx + 1, n):
            if close[j] > neckline * 1.01:
                break_idx = j
                break
        if break_idx is None:
            continue

        vol_t1 = float(np.mean(volume[max(0, t1_idx - 3):t1_idx + 1]))
        vol_t2 = float(np.mean(volume[max(0, t2_idx - 3):t2_idx + 1]))
        vol_confirmed = vol_t2 > vol_t1

        avg_trough = (t1_l + t2_l) / 2
        projection = neckline - avg_trough
        target = neckline + projection * 0.8
        stop_loss = min(t1_l, t2_l) * 0.98
        risk = close[break_idx] - stop_loss
        reward = target - close[break_idx]
        rr = reward / risk if risk > 0 else 0

        if rr < 1.0:
            continue

        confidence = min(100, 45 + (10 if vol_confirmed else 0) + (10 if rr >= 2 else 0))

        results.append(ChartPattern(
            symbol="", pattern_type="DOUBLE_BOTTOM", timeframe="daily",
            direction="bullish",
            entry_date=str(dates[break_idx].date()),
            entry_price=round(float(close[break_idx]), 2),
            target_price=round(float(target), 2),
            stop_loss=round(float(stop_loss), 2),
            confidence=round(confidence, 1),
            breakout_price=round(float(close[break_idx]), 2),
            neckline_or_hline=round(float(neckline), 2),
            pattern_length_bars=t2_idx - t1_idx,
            rr_ratio=round(rr, 2),
            volume_confirmed=vol_confirmed,
            trend_confirmed=True,
        ))

    return results


def detect_bull_flag(df: pd.DataFrame, order: int = 3) -> List[ChartPattern]:
    """Detect Bull Flag patterns (sharp uptrend + consolidation)."""
    results = []
    close = df["close"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    n = len(close)

    if n < 50:
        return results

    dates = df.index

    # Look for sharp 20-40% rally over 5-15 bars followed by consolidation
    for i in range(20, n - 15):
        rally_start = i
        rally_end = i + np.random.randint(5, 15)
        if rally_end >= n:
            break

        rally_pct = (close[rally_end] - close[rally_start]) / close[rally_start]
        if rally_pct < 0.15 or rally_pct > 0.50:
            continue

        # Volume spike during rally
        vol_rally = np.mean(volume[rally_start:rally_end + 1])
        vol_before = np.mean(volume[max(0, rally_start - 20):rally_start + 1])
        if vol_rally < vol_before * 1.3:
            continue

        # Consolidation after rally (flag) - 5-20 bars
        flag_start = rally_end
        flag_end = min(flag_start + 20, n - 5)

        flag_high = np.max(high[flag_start:flag_end + 1])
        flag_low = np.min(close[flag_start:flag_end + 1])
        flag_range = (flag_high - flag_low) / flag_low

        # Flag should be tight (range < 12%)
        if flag_range > 0.12:
            continue

        # Flag should be slightly declining (bull flag)
        flag_slope = _uptrend_slope(close, flag_start, flag_end)
        if flag_slope > 0:  # should be flat to slightly declining
            continue

        # Volume declining during flag
        vol_flag = np.mean(volume[flag_start:flag_end + 1])
        if vol_flag > vol_rally * 0.8:
            continue

        # Breakout above flag high
        break_idx = None
        for j in range(flag_end + 1, n):
            if close[j] > flag_high * 1.01:
                break_idx = j
                break
        if break_idx is None:
            continue

        target = close[break_idx] + (close[rally_end] - close[rally_start]) * 0.5
        stop_loss = flag_low * 0.98
        risk = close[break_idx] - stop_loss
        reward = target - close[break_idx]
        rr = reward / risk if risk > 0 else 0

        if rr < 1.2:
            continue

        confidence = min(100, 50 + (10 if rr >= 2 else 0) + (5 if vol_rally > vol_before * 2 else 0))

        results.append(ChartPattern(
            symbol="", pattern_type="BULL_FLAG", timeframe="daily",
            direction="bullish",
            entry_date=str(dates[break_idx].date()),
            entry_price=round(float(close[break_idx]), 2),
            target_price=round(float(target), 2),
            stop_loss=round(float(stop_loss), 2),
            confidence=round(confidence, 1),
            breakout_price=round(float(high[break_idx]), 2),
            neckline_or_hline=round(float(flag_high), 2),
            pattern_length_bars=flag_end - flag_start,
            rr_ratio=round(rr, 2),
            volume_confirmed=vol_rally > vol_before * 1.5,
            trend_confirmed=True,
        ))

    return results


def detect_bear_flag(df: pd.DataFrame, order: int = 3) -> List[ChartPattern]:
    """Detect Bear Flag patterns (sharp decline + consolidation)."""
    results = []
    close = df["close"].values.astype(np.float64)
    low = df["low"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    n = len(close)

    if n < 50:
        return results

    dates = df.index

    for i in range(20, n - 15):
        decline_start = i
        decline_end = i + np.random.randint(5, 15)
        if decline_end >= n:
            break

        decline_pct = (close[decline_start] - close[decline_end]) / close[decline_start]
        if decline_pct < 0.15 or decline_pct > 0.50:
            continue

        vol_decline = np.mean(volume[decline_start:decline_end + 1])
        vol_before = np.mean(volume[max(0, decline_start - 20):decline_start + 1])
        if vol_decline < vol_before * 1.3:
            continue

        flag_start = decline_end
        flag_end = min(flag_start + 20, n - 5)

        flag_high = np.max(high[flag_start:flag_end + 1])
        flag_low = np.min(low[flag_start:flag_end + 1])
        flag_range = (flag_high - flag_low) / flag_low

        if flag_range > 0.12:
            continue

        # Flag should be slightly rising (bear flag)
        flag_slope = _uptrend_slope(close, flag_start, flag_end)
        if flag_slope < 0:
            continue

        vol_flag = np.mean(volume[flag_start:flag_end + 1])
        if vol_flag > vol_decline * 0.8:
            continue

        # Breakdown below flag low
        break_idx = None
        for j in range(flag_end + 1, n):
            if close[j] < flag_low * 0.99:
                break_idx = j
                break
        if break_idx is None:
            continue

        target = close[break_idx] - (close[decline_start] - close[decline_end]) * 0.5
        stop_loss = flag_high * 1.02
        risk = stop_loss - close[break_idx]
        reward = close[break_idx] - target
        rr = reward / risk if risk > 0 else 0

        if rr < 1.2:
            continue

        confidence = min(100, 50 + (10 if rr >= 2 else 0) + (5 if vol_decline > vol_before * 2 else 0))

        results.append(ChartPattern(
            symbol="", pattern_type="BEAR_FLAG", timeframe="daily",
            direction="bearish",
            entry_date=str(dates[break_idx].date()),
            entry_price=round(float(close[break_idx]), 2),
            target_price=round(float(max(target, 0)), 2),
            stop_loss=round(float(stop_loss), 2),
            confidence=round(confidence, 1),
            breakout_price=round(float(low[break_idx]), 2),
            neckline_or_hline=round(float(flag_low), 2),
            pattern_length_bars=flag_end - flag_start,
            rr_ratio=round(rr, 2),
            volume_confirmed=vol_decline > vol_before * 1.5,
            trend_confirmed=True,
        ))

    return results


def detect_all_chart_patterns(df: pd.DataFrame) -> List[ChartPattern]:
    """Run all chart pattern detectors on a single timeframe DataFrame."""
    patterns = []
    patterns.extend(detect_hs_top(df))
    patterns.extend(detect_ihs_bottom(df))
    patterns.extend(detect_double_top(df))
    patterns.extend(detect_double_bottom(df))
    # patterns.extend(detect_bull_flag(df))  # heuristic, may be noisy
    # patterns.extend(detect_bear_flag(df))
    return patterns


# ============================================================================
# CANDLESTICK PATTERN DETECTION
# ============================================================================

def detect_candlestick_patterns(df: pd.DataFrame) -> List[CandlestickSignal]:
    """Detect key candlestick patterns across the entire DataFrame."""
    results = []
    o = df["open"].values.astype(np.float64)
    h = df["high"].values.astype(np.float64)
    l = df["low"].values.astype(np.float64)
    c = df["close"].values.astype(np.float64)
    n = len(c)
    dates = df.index

    if n < 10:
        return results

    for i in range(2, n):
        body = abs(c[i] - o[i])
        total_range = h[i] - l[i]
        upper_wick = h[i] - max(c[i], o[i])
        lower_wick = min(c[i], o[i]) - l[i]

        if total_range == 0:
            continue

        body_pct = body / total_range * 100
        uw_pct = upper_wick / total_range * 100
        lw_pct = lower_wick / total_range * 100

        is_green = c[i] > o[i]
        is_red = c[i] < o[i]

        # === DOJI (stricter: body < 5%, only keep if directional + at S/R context) ===
        if body_pct < 5 and total_range > 0:
            # Determine direction based on context (5-bar lookback)
            prior_move = c[i] - c[max(0, i - 5)]
            avg_range_5 = np.mean([h[j] - l[j] for j in range(max(0, i - 5), i + 1)]) if i >= 4 else total_range
            # Only keep dojis when preceded by a meaningful trend
            if abs(prior_move) / (avg_range_5 + 1e-8) > 1.2:
                direction = "bearish" if prior_move > 0 else "bullish"
                results.append(CandlestickSignal(
                    symbol="", pattern_name="DOJI", timeframe="daily",
                    direction=direction, date=str(dates[i].date()),
                    price=round(float(c[i]), 2),
                    confirmation_price=round(float(c[i]), 2),
                    stop_loss=round(float(l[i] if direction == "bullish" else h[i]), 2),
                    target=round(float(c[i] * (1.03 if direction == "bullish" else 0.97)), 2),
                    rr_ratio=round(3.0, 2),  # standard Doji R:R proxy
                ))

        # === HAMMER ===
        if lw_pct > 60 and body_pct < 40 and uw_pct < 20 and is_green and i >= 5:
            # Check prior downtrend
            prior_change = c[i - 5] - c[i]
            if prior_change / c[i - 5] > 0.03:  # was falling
                sl = l[i] * 0.98
                target = c[i] + (c[i] - l[i]) * 1.5
                risk = c[i] - sl
                reward = target - c[i]
                rr = reward / risk if risk > 0 else 0

                results.append(CandlestickSignal(
                    symbol="", pattern_name="HAMMER", timeframe="daily",
                    direction="bullish", date=str(dates[i].date()),
                    price=round(float(c[i]), 2),
                    confirmation_price=round(float(c[i]), 2),
                    stop_loss=round(float(sl), 2),
                    target=round(float(target), 2),
                    rr_ratio=round(rr, 2),
                ))

        # === SHOOTING STAR ===
        if uw_pct > 60 and body_pct < 40 and lw_pct < 20 and is_red and i >= 5:
            prior_change = c[i] - c[i - 5]
            if prior_change / c[i - 5] > 0.03:  # was rising
                sl = h[i] * 1.02
                target = c[i] - (h[i] - c[i]) * 1.5
                risk = sl - c[i]
                reward = c[i] - target
                rr = reward / risk if risk > 0 else 0

                results.append(CandlestickSignal(
                    symbol="", pattern_name="SHOOTING_STAR", timeframe="daily",
                    direction="bearish", date=str(dates[i].date()),
                    price=round(float(c[i]), 2),
                    confirmation_price=round(float(c[i]), 2),
                    stop_loss=round(float(sl), 2),
                    target=round(float(max(target, 0)), 2),
                    rr_ratio=round(rr, 2),
                ))

        # === BULLISH ENGULFING ===
        if i >= 1 and is_green:
            prev_green = c[i - 1] > o[i - 1]
            prev_body = abs(c[i - 1] - o[i - 1])
            if not prev_green and c[i] > o[i - 1] and o[i] < c[i - 1] and body > prev_body * 1.1:
                sl = min(l[i], l[i - 1]) * 0.98
                target = c[i] + body * 1.5
                risk = c[i] - sl
                reward = target - c[i]
                rr = reward / risk if risk > 0 else 0

                results.append(CandlestickSignal(
                    symbol="", pattern_name="BULLISH_ENGULFING", timeframe="daily",
                    direction="bullish", date=str(dates[i].date()),
                    price=round(float(c[i]), 2),
                    confirmation_price=round(float(c[i]), 2),
                    stop_loss=round(float(sl), 2),
                    target=round(float(target), 2),
                    rr_ratio=round(rr, 2),
                ))

        # === BEARISH ENGULFING ===
        if i >= 1 and is_red:
            prev_green = c[i - 1] > o[i - 1]
            prev_body = abs(c[i - 1] - o[i - 1])
            if prev_green and c[i] < o[i - 1] and o[i] > c[i - 1] and body > prev_body * 1.1:
                sl = max(h[i], h[i - 1]) * 1.02
                target = c[i] - body * 1.5
                risk = sl - c[i]
                reward = c[i] - target
                rr = reward / risk if risk > 0 else 0

                results.append(CandlestickSignal(
                    symbol="", pattern_name="BEARISH_ENGULFING", timeframe="daily",
                    direction="bearish", date=str(dates[i].date()),
                    price=round(float(c[i]), 2),
                    confirmation_price=round(float(c[i]), 2),
                    stop_loss=round(float(sl), 2),
                    target=round(float(max(target, 0)), 2),
                    rr_ratio=round(rr, 2),
                ))

        # === MORNING STAR (3-bar) ===
        if i >= 2:
            b1, b2, b3 = c[i - 2], c[i - 1], c[i]
            o1, o2, o3 = o[i - 2], o[i - 1], o[i]
            body1 = abs(b1 - o1)
            body2 = abs(b2 - o2)
            body3 = abs(b3 - o3)

            # Morning Star: long red, small body, long green
            if b1 < o1 and body1 > total_range * 0.5:  # long red
                if body2 < total_range * 0.3:  # small body
                    if b3 > o3 and body3 > total_range * 0.5:  # long green
                        if c[i] > (o1 + b1) / 2:  # closes above midpoint of first
                            sl = min(l[i - 2], l[i - 1], l[i]) * 0.98
                            target = c[i] + body3 * 1.5
                            risk = c[i] - sl
                            reward = target - c[i]
                            rr = reward / risk if risk > 0 else 0

                            results.append(CandlestickSignal(
                                symbol="", pattern_name="MORNING_STAR", timeframe="daily",
                                direction="bullish", date=str(dates[i].date()),
                                price=round(float(c[i]), 2),
                                confirmation_price=round(float(c[i]), 2),
                                stop_loss=round(float(sl), 2),
                                target=round(float(target), 2),
                                rr_ratio=round(rr, 2),
                            ))

            # === EVENING STAR (3-bar) ===
            if b1 > o1 and body1 > total_range * 0.5:  # long green
                if body2 < total_range * 0.3:  # small body
                    if b3 < o3 and body3 > total_range * 0.5:  # long red
                        if c[i] < (o1 + b1) / 2:  # closes below midpoint
                            sl = max(h[i - 2], h[i - 1], h[i]) * 1.02
                            target = c[i] - body3 * 1.5
                            risk = sl - c[i]
                            reward = c[i] - target
                            rr = reward / risk if risk > 0 else 0

                            results.append(CandlestickSignal(
                                symbol="", pattern_name="EVENING_STAR", timeframe="daily",
                                direction="bearish", date=str(dates[i].date()),
                                price=round(float(c[i]), 2),
                                confirmation_price=round(float(c[i]), 2),
                                stop_loss=round(float(sl), 2),
                                target=round(float(max(target, 0)), 2),
                                rr_ratio=round(rr, 2),
                            ))

    return results


# ============================================================================
# PREDICTIVE VALIDATION
# ============================================================================

def validate_pattern(df: pd.DataFrame, pattern: ChartPattern, lookahead_bars: int = 120) -> ChartPattern:
    """Validate a chart pattern by looking forward N bars. Did price obey?"""
    close = df["close"].values
    dates = df.index
    n = len(close)

    # Find the entry index
    entry_date = pattern.entry_date
    entry_idx = None
    for j in range(len(dates)):
        if str(dates[j].date()) == entry_date:
            entry_idx = j
            break

    if entry_idx is None:
        pattern.obeyed = False
        pattern.exit_reason = "TIME_EXIT"
        return pattern

    exit_idx = entry_idx
    entry_price = pattern.entry_price
    target = pattern.target_price
    stop = pattern.stop_loss
    is_bullish = pattern.direction == "bullish"

    max_fav = 0.0
    max_adv = 0.0
    exit_reason = "TIME_EXIT"

    max_lookahead = min(entry_idx + lookahead_bars, n)

    for j in range(entry_idx + 1, max_lookahead):
        if is_bullish:
            mfe = (close[j] - entry_price) / entry_price * 100
            mae = (entry_price - close[j]) / entry_price * 100
            if close[j] >= target:
                exit_idx = j
                exit_reason = "TARGET_HIT"
                break
            if close[j] <= stop:
                exit_idx = j
                exit_reason = "STOP_LOSS_HIT"
                break
        else:
            mfe = (entry_price - close[j]) / entry_price * 100
            mae = (close[j] - entry_price) / entry_price * 100
            if close[j] <= target:
                exit_idx = j
                exit_reason = "TARGET_HIT"
                break
            if close[j] >= stop:
                exit_idx = j
                exit_reason = "STOP_LOSS_HIT"
                break

        max_fav = max(max_fav, mfe)
        max_adv = max(max_adv, mae)

    if exit_idx == entry_idx:
        exit_idx = max_lookahead - 1

    exit_price = float(close[exit_idx])

    # Calculate P&L
    if is_bullish:
        pnl = (exit_price - entry_price) / entry_price * 100
    else:
        pnl = (entry_price - exit_price) / entry_price * 100

    pattern.exit_date = str(dates[exit_idx].date())
    pattern.exit_price = round(exit_price, 2)
    pattern.exit_reason = exit_reason
    pattern.pnl_pct = round(pnl, 2)
    pattern.max_favorable_excursion = round(max_fav if max_fav > 0 else 0, 2)
    pattern.max_adverse_excursion = round(max_adv if max_adv > 0 else 0, 2)
    pattern.obeyed = exit_reason == "TARGET_HIT"

    return pattern


def validate_candlestick(df: pd.DataFrame, signal: CandlestickSignal, lookahead_bars: int = 20) -> CandlestickSignal:
    """Validate a candlestick signal by checking forward price action."""
    close = df["close"].values
    dates = df.index
    n = len(close)

    entry_date = signal.date
    entry_idx = None
    for j in range(len(dates)):
        if str(dates[j].date()) == entry_date:
            entry_idx = j
            break

    if entry_idx is None:
        signal.obeyed = False
        return signal

    is_bullish = signal.direction == "bullish"
    max_lookahead = min(entry_idx + lookahead_bars, n)

    # Check if price moves in predicted direction
    future_close = close[entry_idx + 1:max_lookahead]

    if is_bullish and len(future_close) > 0:
        # Obeyed if price is higher after N bars
        signal.obeyed = bool(np.mean(future_close) > close[entry_idx])
        signal.pnl_pct = round((future_close[-1] - close[entry_idx]) / close[entry_idx] * 100, 2)
        signal.exit_price = round(float(future_close[-1]), 2)
        signal.exit_date = str(dates[min(entry_idx + lookahead_bars, n) - 1].date())
    elif not is_bullish and len(future_close) > 0:
        signal.obeyed = bool(np.mean(future_close) < close[entry_idx])
        signal.pnl_pct = round((close[entry_idx] - future_close[-1]) / close[entry_idx] * 100, 2)
        signal.exit_price = round(float(future_close[-1]), 2)
        signal.exit_date = str(dates[min(entry_idx + lookahead_bars, n) - 1].date())

    return signal


# ============================================================================
# FUNDAMENTAL ANALYSIS
# ============================================================================

def analyze_fundamentals(fund_data: Dict, symbol: str = "") -> FundamentalSignal:
    """Score fundamentals and produce rating."""
    fs = FundamentalSignal(symbol=symbol)

    if not fund_data:
        return fs

    fs.pe_ratio = fund_data.get("pe_ratio", 0) or 0
    fs.pb_ratio = fund_data.get("pb_ratio", 0) or 0
    fs.roe_pct = fund_data.get("roe_pct", 0) or 0
    fs.roce_pct = fund_data.get("roce_pct", 0) or 0
    fs.debt_to_equity = fund_data.get("debt_to_equity", 0) or 0
    fs.revenue_growth_pct = fund_data.get("revenue_growth_pct", 0) or 0
    fs.profit_growth_pct = fund_data.get("profit_growth_pct", 0) or 0
    fs.operating_margin_pct = fund_data.get("operating_margin_pct", 0) or 0
    fs.profit_margin_pct = fund_data.get("profit_margin_pct", 0) or 0
    fs.current_ratio = fund_data.get("current_ratio", 0) or 0
    fs.dividend_yield_pct = fund_data.get("dividend_yield_pct", 0) or 0
    fs.market_cap_cr = fund_data.get("market_cap_cr", 0) or 0
    fs.sector = fund_data.get("sector", "")
    fs.industry = fund_data.get("industry", "")

    # Score calculation (0-100)
    score = 50  # baseline

    # Valuation (P/E)
    pe = fs.pe_ratio
    if 10 < pe < 25:
        score += 10
    elif 25 <= pe < 40:
        score += 5
    elif pe > 40 or (0 < pe < 10):
        score -= 5
    elif pe <= 0:
        score -= 10

    # Growth
    if fs.revenue_growth_pct > 15:
        score += 15
    elif fs.revenue_growth_pct > 5:
        score += 8
    elif fs.revenue_growth_pct < 0:
        score -= 10

    if fs.profit_growth_pct > 15:
        score += 15
    elif fs.profit_growth_pct > 5:
        score += 8
    elif fs.profit_growth_pct < 0:
        score -= 10

    # Profitability
    if fs.roe_pct > 18:
        score += 10
    elif fs.roe_pct > 10:
        score += 5
    elif fs.roe_pct < 5:
        score -= 5

    if fs.roce_pct > 20:
        score += 10
    elif fs.roce_pct > 12:
        score += 5

    # Margins
    if fs.operating_margin_pct > 20:
        score += 8
    elif fs.operating_margin_pct > 10:
        score += 4
    elif fs.operating_margin_pct < 0:
        score -= 5

    # Debt
    dte = fs.debt_to_equity
    if dte < 0.5:
        score += 10
    elif dte < 1.5:
        score += 5
    elif dte > 3:
        score -= 10

    # Liquidity
    if fs.current_ratio > 1.5:
        score += 5
    elif fs.current_ratio < 0.8:
        score -= 5

    # Cap range adjustment
    score = max(0, min(100, score))
    fs.score = round(score, 1)

    # Rating
    if score >= 80:
        fs.overall_rating = "STRONG_BUY"
    elif score >= 65:
        fs.overall_rating = "BUY"
    elif score >= 45:
        fs.overall_rating = "HOLD"
    elif score >= 30:
        fs.overall_rating = "SELL"
    else:
        fs.overall_rating = "STRONG_SELL"

    return fs


# ============================================================================
# SECTOR MAPPING — Fallback when Yahoo Finance is unavailable
# ============================================================================

# Known NSE stock → sector mappings for major stocks (fallback when ticker.info is rate-limited)
# Based on NSE/BSE classification; covers ~500 major stocks.
_SECTOR_MAP: Dict[str, str] = {
    # NIFTY 50
    "RELIANCE": "Energy", "TCS": "Technology", "HDFCBANK": "Financial Services",
    "INFY": "Technology", "ICICIBANK": "Financial Services", "KOTAKBANK": "Financial Services",
    "HINDUNILVR": "Consumer Defensive", "ITC": "Consumer Defensive", "SBIN": "Financial Services",
    "BHARTIARTL": "Communication Services", "BAJFINANCE": "Financial Services", "LICI": "Financial Services",
    "HCLTECH": "Technology", "WIPRO": "Technology", "SUNPHARMA": "Healthcare",
    "ULTRACEMCO": "Industrials", "TITAN": "Consumer Cyclical", "ADANIPORTS": "Industrials",
    "NTPC": "Utilities", "M&M": "Consumer Cyclical", "POWERGRID": "Utilities",
    "AXISBANK": "Financial Services", "MARUTI": "Consumer Cyclical", "LT": "Industrials",
    "ASIANPAINT": "Basic Materials", "HDFC": "Financial Services", "BAJAJFINSV": "Financial Services",
    "TATASTEEL": "Basic Materials", "HINDALCO": "Basic Materials", "JSWSTEEL": "Basic Materials",
    "COALINDIA": "Energy", "BPCL": "Energy", "ONGC": "Energy", "GAIL": "Energy",
    "TECHM": "Technology", "BRITANNIA": "Consumer Defensive", "NESTLEIND": "Consumer Defensive",
    "DIVISLAB": "Healthcare", "DRREDDY": "Healthcare", "CIPLA": "Healthcare",
    "APOLLOHOSP": "Healthcare", "SBILIFE": "Financial Services", "HDFCLIFE": "Financial Services",
    "HEROMOTOCO": "Consumer Cyclical", "BAJAJ-AUTO": "Consumer Cyclical", "EICHERMOT": "Consumer Cyclical",
    "GRASIM": "Basic Materials", "ADANIENT": "Energy", "ADANIGREEN": "Utilities",
    "TRENT": "Consumer Cyclical", "BEL": "Industrials",
    # BANKING & FINANCIAL
    "BANKBARODA": "Financial Services", "PNB": "Financial Services", "CANBK": "Financial Services",
    "INDUSINDBK": "Financial Services", "FEDERALBNK": "Financial Services", "IDFCFIRSTB": "Financial Services",
    "YESBANK": "Financial Services", "RBLBANK": "Financial Services", "BANDHANBNK": "Financial Services",
    "AUBANK": "Financial Services", "IDBI": "Financial Services", "SOUTHBANK": "Financial Services",
    "J&KBANK": "Financial Services", "UCOBANK": "Financial Services", "CENTRALBK": "Financial Services",
    # IT
    "LTTS": "Technology", "MINDTREE": "Technology", "MPHASIS": "Technology",
    "PERSISTENT": "Technology", "COFORGE": "Technology", "CYIENT": "Technology",
    "LTI": "Technology", "TATAELXSI": "Technology", "ZENSARTECH": "Technology",
    "HEXAWARE": "Technology", "BSOFT": "Technology", "NIITTECH": "Technology",
    # PHARMA
    "LUPIN": "Healthcare", "AUROPHARMA": "Healthcare", "ZYDUSLIFE": "Healthcare",
    "TORNTPHARM": "Healthcare", "GLENMARK": "Healthcare", "BIOCON": "Healthcare",
    "ALKEM": "Healthcare", "CADILAHC": "Healthcare", "ABBOTINDIA": "Healthcare",
    "PFIZER": "Healthcare", "SANOFI": "Healthcare", "GLAXO": "Healthcare",
    # AUTO
    "TATAMOTORS": "Consumer Cyclical", "MOTHERSON": "Consumer Cyclical",
    "ASHOKLEY": "Consumer Cyclical", "TVSMOTOR": "Consumer Cyclical", "BOSCHLTD": "Consumer Cyclical",
    # ENERGY
    "IOC": "Energy", "HPCL": "Energy", "OIL": "Energy", "PETRONET": "Energy",
    "GUJGASLTD": "Utilities", "IGL": "Utilities", "MGL": "Utilities",
    # METALS & MINING
    "NATIONALUM": "Basic Materials", "HINDZINC": "Basic Materials", "VEDL": "Basic Materials",
    "NMDC": "Basic Materials", "SAIL": "Basic Materials", "MOIL": "Basic Materials",
    # FMCG
    "DABUR": "Consumer Defensive", "MARICO": "Consumer Defensive", "HAL": "Industrials",
    "COLPAL": "Consumer Defensive", "GODREJCP": "Consumer Defensive", "P&G": "Consumer Defensive",
    "EMAMILTD": "Consumer Defensive", "JUBLFOOD": "Consumer Cyclical",
    # REALTY
    "DLF": "Real Estate", "GODREJPROP": "Real Estate", "OBEROIRLTY": "Real Estate",
    "PHOENIXLTD": "Real Estate", "BRIGADE": "Real Estate", "SOBHA": "Real Estate",
    # TELECOM
    "IDEA": "Communication Services", "INDUSTOWER": "Communication Services",
    "TCNSBRANDS": "Consumer Cyclical",
    # MEDIA
    "ZEEL": "Communication Services", "PVRINOX": "Communication Services",
    "NETWORK18": "Communication Services", "TV18BRDCST": "Communication Services",
    # INFRASTRUCTURE & CAPITAL GOODS
    "L&TFH": "Financial Services", "SIEMENS": "Industrials", "ABB": "Industrials",
    "BHEL": "Industrials", "HAVELLS": "Industrials", "VOLTAS": "Industrials",
    "CROMPTON": "Industrials", "FINPIPE": "Industrials", "SUPREMEIND": "Industrials",
    "KEC": "Industrials", "KALPATPOWR": "Industrials", "LARSEN": "Industrials",
    "ADANIPOWER": "Utilities", "TATAPOWER": "Utilities", "NHPC": "Utilities",
    "JSWENERGY": "Utilities", "TORNTPOWER": "Utilities", "CESC": "Utilities",
    # AVIATION
    "INDIGO": "Industrials", "SPICEJET": "Industrials",
}


def _lookup_sector(symbol: str) -> str:
    """Look up sector from fallback map."""
    return _SECTOR_MAP.get(symbol.upper().replace(".NS", ""), "")


# ============================================================================
# CONVOLUTION VALIDATION ENGINE
# ============================================================================

# Pattern reliability weights (derived from backtest historical obey rates)
# Used as the convolution kernel — weights are applied across all signals
_CONV_KERNEL = {
    "H&S_TOP": {"weight": 0.40, "direction": "bearish", "global_obey": 0.471},
    "IH&S_BOTTOM": {"weight": 0.45, "direction": "bullish", "global_obey": 0.577},
    "DOUBLE_TOP": {"weight": 0.30, "direction": "bearish", "global_obey": 0.45},
    "DOUBLE_BOTTOM": {"weight": 0.35, "direction": "bullish", "global_obey": 0.50},
    "BULL_FLAG": {"weight": 0.25, "direction": "bullish", "global_obey": 0.50},
    "BEAR_FLAG": {"weight": 0.25, "direction": "bearish", "global_obey": 0.45},
    # Candlestick pattern weights
    "DOJI": {"weight": 0.10, "direction": "neutral", "global_obey": 0.50},
    "HAMMER": {"weight": 0.20, "direction": "bullish", "global_obey": 0.52},
    "SHOOTING_STAR": {"weight": 0.20, "direction": "bearish", "global_obey": 0.48},
    "BULLISH_ENGULFING": {"weight": 0.30, "direction": "bullish", "global_obey": 0.55},
    "BEARISH_ENGULFING": {"weight": 0.30, "direction": "bearish", "global_obey": 0.53},
    "MORNING_STAR": {"weight": 0.35, "direction": "bullish", "global_obey": 0.58},
    "EVENING_STAR": {"weight": 0.35, "direction": "bearish", "global_obey": 0.55},
}

# Timeframe multipliers (longer = more reliable)
_TF_MULTIPLIER = {"daily": 1.0, "weekly": 1.3, "monthly": 1.6}


def compute_conviction_score(result: StockResult) -> StockResult:
    """
    Convolution validation engine.
    
    Applies a weighted convolution across ALL signals (chart patterns, candlestick
    signals, fundamental) to produce a consolidated conviction score.
    
    The score is computed as:
      net_score = (bullish_evidence - bearish_evidence) / total_evidence
      conviction = abs(net_score) * 100  (0-100 scale)
    
    Confluence bonuses add small multipliers but do not dominate.
    """
    bull_evidence = 0.0   # sum of evidence for bullish direction
    bear_evidence = 0.0   # sum of evidence for bearish direction
    signal_types_used: Set[str] = set()
    timeframe_counts: Dict[str, int] = {}
    contributing_signals: List[str] = []

    # ── 1. Convolve chart patterns ──
    # Each obeyed pattern contributes evidence to its predicted direction.
    # Each non-obeyed (failed) pattern contributes evidence to the OPPOSITE direction
    # (the market moved opposite to what the pattern predicted).
    chart_bull = 0
    chart_bear = 0
    for p in result.chart_patterns:
        kernel = _CONV_KERNEL.get(p.pattern_type, {"weight": 0.4, "global_obey": 0.5})
        w = kernel["weight"]
        obey_rate = kernel["global_obey"]
        tf_mul = _TF_MULTIPLIER.get(p.timeframe, 1.0)
        eff_w = w * tf_mul * obey_rate  # effective evidence weight

        if p.direction == "bullish":
            if p.obeyed:
                bull_evidence += eff_w
                chart_bull += 1
                contributing_signals.append(f"{p.pattern_type}({p.timeframe},obeyed)")
            else:
                # Failed bullish = market moved down → bearish evidence
                bear_evidence += eff_w * 0.5
        else:  # bearish
            if p.obeyed:
                bear_evidence += eff_w
                chart_bear += 1
                contributing_signals.append(f"{p.pattern_type}({p.timeframe},obeyed)")
            else:
                # Failed bearish = market moved up → bullish evidence
                bull_evidence += eff_w * 0.5

        signal_types_used.add(f"chart_{p.pattern_type}")
        timeframe_counts[p.timeframe] = timeframe_counts.get(p.timeframe, 0) + 1

    # ── 2. Convolve candlestick patterns (directional only) ──
    # Non-obeyed candles = market moved opposite → add to opposite evidence
    candle_bull = 0
    candle_bear = 0
    for cs in result.candlestick_signals:
        if cs.direction == "neutral":
            continue
        if cs.direction == "bullish":
            if cs.obeyed:
                candle_bull += 1
            else:
                candle_bear += 0.3  # failed bullish → bearish evidence
        else:
            if cs.obeyed:
                candle_bear += 1
            else:
                candle_bull += 0.3  # failed bearish → bullish evidence
        signal_types_used.add(f"candle_{cs.pattern_name}")

    # Aggregate candle evidence: candles at ~50% obey are essentially noise.
    # Use 0.005 multiplier so ~100 candles = 0.5 evidence (roughly 1 chart pattern).
    # Cap max candle contribution to prevent noise from dominating.
    candle_net = (candle_bull - candle_bear) * 0.005
    # Cap: max 0.5 evidence from candles in either direction
    candle_net = max(-0.5, min(0.5, candle_net))
    if candle_net > 0:
        bull_evidence += candle_net
    else:
        bear_evidence += abs(candle_net)

    # Count directional candle types
    directional_candle_types = len({cs.pattern_name for cs in result.candlestick_signals
                                    if cs.direction != "neutral"})

    # ── 3. Convolve fundamental signal ──
    fund_net = 0.0
    if result.fundamental and result.fundamental.overall_rating:
        fund_score = result.fundamental.score
        if result.fundamental.overall_rating in ("STRONG_BUY", "BUY"):
            fund_net = fund_score / 100.0 * 0.3  # max 0.3 evidence
            signal_types_used.add("fundamental_bullish")
            contributing_signals.append(f"Fundamental({result.fundamental.overall_rating})")
        elif result.fundamental.overall_rating in ("STRONG_SELL", "SELL"):
            fund_net = -(fund_score / 100.0) * 0.3
            signal_types_used.add("fundamental_bearish")
            contributing_signals.append(f"Fundamental({result.fundamental.overall_rating})")

    if fund_net > 0:
        bull_evidence += fund_net
    elif fund_net < 0:
        bear_evidence += abs(fund_net)

    # ── 4. Multi-timeframe confluence bonus ──
    active_tfs = {tf for tf, cnt in timeframe_counts.items() if cnt > 0}
    tf_count = len(active_tfs)
    # Also check if candlestick signals span multiple timeframes
    candle_tfs = {cs.timeframe for cs in result.candlestick_signals if cs.direction != "neutral"}
    all_tfs = active_tfs | candle_tfs
    tf_count_total = len(all_tfs)

    if tf_count_total >= 2:
        # Confluence bonus: increases the dominant evidence by 10% per extra timeframe
        confluence_mult = 1.0 + 0.10 * (tf_count_total - 1)
        if bull_evidence >= bear_evidence:
            bull_evidence *= confluence_mult
        else:
            bear_evidence *= confluence_mult
        contributing_signals.append(f"{tf_count_total}TF-confluence({confluence_mult:.1f}x)")

    # ── 5. Multi-pattern-type confluence bonus ──
    pattern_type_count = len(signal_types_used)
    if pattern_type_count >= 3:
        # 5% boost per extra signal type
        type_mult = 1.0 + 0.05 * (pattern_type_count - 2)
        if bull_evidence >= bear_evidence:
            bull_evidence *= type_mult
        else:
            bear_evidence *= type_mult
        contributing_signals.append(f"{pattern_type_count}signal-types({type_mult:.1f}x)")

    # ── 6. Compute final conviction score ──
    total_evidence = bull_evidence + bear_evidence

    if total_evidence <= 0:
        # No signals or all canceled out
        direction = "neutral"
        conviction = 0.0
        rating = "NEUTRAL"
    else:
        net = bull_evidence - bear_evidence
        # Normalize to [-1, +1] then to [0, 100]
        conviction = abs(net) / total_evidence * 100
        direction = "bullish" if net > 0 else "bearish"

        # Determine rating
        if conviction >= 60:
            rating = "STRONG"
        elif conviction >= 40:
            rating = "MODERATE"
        elif conviction >= 20:
            rating = "WEAK"
        else:
            rating = "NEUTRAL"

    # Cap at 100
    conviction = min(100, max(0, conviction))

    # ── Safety caps ──
    chart_count = len(result.chart_patterns)
    obeyed_count = sum(1 for p in result.chart_patterns if p.obeyed)

    # If chart patterns exist but none obeyed and conviction is 100%, cap it
    if chart_count > 0 and obeyed_count == 0 and conviction >= 99.9:
        conviction = min(conviction, 75.0)
        if rating == "STRONG":
            rating = "MODERATE"

    # If no chart patterns detected, cap conviction to prevent false 100% from candle noise
    if chart_count == 0:
        conviction = min(conviction, 65.0)
        if rating == "STRONG":
            rating = "MODERATE"
        # Only assign direction if candle conviction is reasonably strong
        if conviction < 55:
            direction = "neutral"
            rating = "NEUTRAL"
            # Keep original score (don't inflate to 50)

    result.conviction_score = round(conviction, 1)
    result.conviction_rating = rating
    result.conviction_direction = direction
    result.signal_confluence = {
        "signal_types": len(signal_types_used),
        "directional_candle_types": directional_candle_types,
        "timeframes": tf_count_total,
        "chart_patterns": len(result.chart_patterns),
        "obeyed_charts": sum(1 for p in result.chart_patterns if p.obeyed),
        "net_candle_signals": round(candle_bull - candle_bear, 1),
        "fundamental": result.fundamental.overall_rating if result.fundamental else None,
        "contributing_signals": contributing_signals[:15],
        "bull_evidence": round(bull_evidence, 3),
        "bear_evidence": round(bear_evidence, 3),
    }

    # ── Override prediction based on conviction ──
    if rating == "STRONG" and direction == "bullish":
        result.prediction = "GROW"
        result.prediction_confidence = min(95, 60 + conviction * 0.35)
    elif rating == "STRONG" and direction == "bearish":
        result.prediction = "FALL"
        result.prediction_confidence = min(95, 60 + conviction * 0.35)
    elif rating == "MODERATE" and direction == "bullish":
        result.prediction = "GROW"
        result.prediction_confidence = 55 + conviction * 0.25
    elif rating == "MODERATE" and direction == "bearish":
        result.prediction = "FALL"
        result.prediction_confidence = 55 + conviction * 0.25
    elif rating in ("WEAK", "NEUTRAL"):
        # Keep baseline prediction but cap confidence
        result.prediction_confidence = min(50, result.prediction_confidence)
        if conviction < 20:
            result.prediction = "NEUTRAL"
            result.prediction_confidence = 50

    return result


# ============================================================================
# OVERALL STOCK ANALYSIS
# ============================================================================

def analyze_stock(symbol: str, fresh: bool = False,
                  analysis_db: Optional[Any] = None) -> StockResult:
    """Complete analysis of a single stock across all dimensions."""
    result = StockResult(symbol=symbol)
    tf_data = load_multi_tf_data(symbol, fresh=fresh)

    daily = tf_data.get("daily")
    weekly = tf_data.get("weekly")
    monthly = tf_data.get("monthly")

    if daily is None:
        result.errors.append("No daily data")
        return result

    # ── Chart Patterns (all timeframes) ──
    tf_map = {"daily": daily, "weekly": weekly, "monthly": monthly}

    for tf_name, tf_df in tf_map.items():
        if tf_df is None or len(tf_df) < 60:
            continue

        patterns = detect_all_chart_patterns(tf_df)
        for p in patterns:
            p.symbol = symbol
            p.timeframe = tf_name
            # Validate with lookahead appropriate to timeframe
            la = {"daily": 120, "weekly": 52, "monthly": 24}[tf_name]
            p = validate_pattern(tf_df, p, lookahead_bars=la)
            result.chart_patterns.append(p)

    # ── Candlestick Patterns (daily only) ──
    candle_signals = detect_candlestick_patterns(daily)
    for cs in candle_signals:
        cs.symbol = symbol
        cs.timeframe = "daily"
        cs = validate_candlestick(daily, cs)
        result.candlestick_signals.append(cs)

    # ── Fundamental Analysis ──
    fund_data = fetch_fundamentals(symbol)
    if fund_data:
        result.fundamental = analyze_fundamentals(fund_data, symbol=symbol)
        if fund_data.get("company_name"):
            result.company_name = fund_data["company_name"]
        if fund_data.get("sector"):
            result.sector = fund_data["sector"]
    else:
        # Fallback: use sector map (avoids expensive ticker.info call)
        result.sector = _lookup_sector(symbol)

    # ── Overall Prediction (pre-convolution baseline) ──
    chart_obey = sum(1 for p in result.chart_patterns if p.obeyed)
    chart_total = len(result.chart_patterns)
    result.overall_chart_obey = chart_obey > chart_total / 2 if chart_total > 0 else False

    candle_obey = sum(1 for c in result.candlestick_signals if c.obeyed)
    candle_total = len(result.candlestick_signals)
    result.overall_candle_obey = candle_obey > candle_total / 2 if candle_total > 0 else False

    fund_bullish = result.fundamental and result.fundamental.overall_rating in ("STRONG_BUY", "BUY")
    result.overall_fundamental_bullish = fund_bullish

    # Simple baseline score (used only if convolution doesn't override)
    score = 0.0
    if result.overall_chart_obey:
        score += 2
    elif chart_total > 0:
        score -= 1

    if result.overall_candle_obey:
        score += 1
    elif candle_total > 0:
        score -= 0.5

    if fund_bullish:
        score += 1.5
    elif result.fundamental and result.fundamental.overall_rating in ("STRONG_SELL", "SELL"):
        score -= 1.5

    if score >= 2:
        result.prediction = "GROW"
        result.prediction_confidence = min(100, 50 + score * 10)
    elif score <= -1:
        result.prediction = "FALL"
        result.prediction_confidence = min(100, 50 + abs(score) * 10)
    else:
        result.prediction = "NEUTRAL"
        result.prediction_confidence = 50

    # ── Convolution validation — overrides prediction if strong conviction ──
    result = compute_conviction_score(result)

    return result


# ============================================================================
# CROSS-VALIDATION (App Analysis vs Manual)
# ============================================================================

def cross_validate(app_results: List[StockResult],
                   manual_file: Optional[str] = None) -> Dict:
    """Compare app results with manual/independent analysis."""
    discrepancies = []

    if manual_file and os.path.exists(manual_file):
        with open(manual_file) as f:
            manual_data = json.load(f)

        app_map = {r.symbol: r for r in app_results}

        for manual_entry in manual_data:
            sym = manual_entry.get("symbol", "")
            manual_pred = manual_entry.get("prediction", "")
            manual_confidence = manual_entry.get("confidence", 0)

            if sym in app_map:
                app_r = app_map[sym]
                if app_r.prediction != manual_pred:
                    discrepancies.append({
                        "symbol": sym,
                        "app_prediction": app_r.prediction,
                        "manual_prediction": manual_pred,
                        "app_confidence": app_r.prediction_confidence,
                        "manual_confidence": manual_confidence,
                        "chart_patterns": len(app_r.chart_patterns),
                        "candle_signals": len(app_r.candlestick_signals),
                    })

    match_rate = 0
    if manual_file and os.path.exists(manual_file):
        total_compared = len(manual_data) if manual_data else 1
        match_rate = (total_compared - len(discrepancies)) / total_compared * 100

    return {
        "discrepancies": discrepancies,
        "match_rate": match_rate,
        "total_compared": len(manual_data) if manual_file and os.path.exists(manual_file) else 0,
    }


# ============================================================================
# REPORT GENERATION
# ============================================================================

def generate_report(all_results: List[StockResult],
                    scan_params: Dict,
                    cross_val: Optional[Dict] = None) -> ValidationReport:
    """Generate comprehensive validation report from all stock results."""
    report = ValidationReport(scan_parameters=scan_params)
    report.total_stocks = len(all_results)
    report.stock_results = all_results

    # Filter stocks with patterns
    stocks_with_patterns = [r for r in all_results
                           if r.chart_patterns or r.candlestick_signals]
    report.stocks_with_patterns = len(stocks_with_patterns)

    # Aggregate all patterns
    all_chart = []
    all_candle = []
    for r in stocks_with_patterns:
        all_chart.extend(r.chart_patterns)
        all_candle.extend(r.candlestick_signals)
    report.total_chart_patterns = len(all_chart)
    report.total_candle_signals = len(all_candle)

    # Obey rates by pattern type
    pattern_types = set(p.pattern_type for p in all_chart)
    for pt in sorted(pattern_types):
        subset = [p for p in all_chart if p.pattern_type == pt]
        obeyed = [p for p in subset if p.obeyed]
        report.pattern_obey_rates[pt] = {
            "count": len(subset),
            "obeyed": len(obeyed),
            "obey_rate": round(len(obeyed) / len(subset) * 100, 1) if subset else 0,
            "avg_pnl_pct": round(np.mean([p.pnl_pct for p in subset]), 2) if subset else 0,
            "avg_rr": round(np.mean([p.rr_ratio for p in subset]), 2) if subset else 0,
            "avg_confidence": round(np.mean([p.confidence for p in subset]), 1) if subset else 0,
        }

    # Obey rates by timeframe
    for tf in ["daily", "weekly", "monthly"]:
        subset = [p for p in all_chart if p.timeframe == tf]
        if subset:
            obeyed = [p for p in subset if p.obeyed]
            report.timeframe_obey_rates[tf] = {
                "count": len(subset),
                "obeyed": len(obeyed),
                "obey_rate": round(len(obeyed) / len(subset) * 100, 1) if subset else 0,
                "avg_pnl": round(np.mean([p.pnl_pct for p in subset]), 2) if subset else 0,
            }

    # Obey rates by sector
    sector_map = {}
    for r in stocks_with_patterns:
        sec = r.sector or "Unknown"
        if sec not in sector_map:
            sector_map[sec] = {"stocks": 0, "chart_obey": 0, "chart_total": 0}
        sector_map[sec]["stocks"] += 1
        sector_map[sec]["chart_total"] += len(r.chart_patterns)
        sector_map[sec]["chart_obey"] += sum(1 for p in r.chart_patterns if p.obeyed)
    for sec, data in sorted(sector_map.items()):
        report.sector_obey_rates[sec] = {
            "stocks": data["stocks"],
            "chart_total": data["chart_total"],
            "chart_obey_rate": round(data["chart_obey"] / data["chart_total"] * 100, 1) if data["chart_total"] else 0,
        }

    # Overall obey rates
    if all_chart:
        report.overall_chart_obey_rate = round(
            sum(1 for p in all_chart if p.obeyed) / len(all_chart) * 100, 1
        )

    if all_candle:
        report.overall_candle_obey_rate = round(
            sum(1 for c in all_candle if c.obeyed) / len(all_candle) * 100, 1
        )

    # Prediction breakdown
    report.total_stocks_grow_prediction = sum(1 for r in all_results if r.prediction == "GROW")
    report.total_stocks_fall_prediction = sum(1 for r in all_results if r.prediction == "FALL")

    # ── Convolution distribution ──
    for r in all_results:
        rating = r.conviction_rating or "NEUTRAL"
        if rating in report.conviction_distribution:
            report.conviction_distribution[rating] += 1
    report.conviction_grow_count = sum(1 for r in all_results if r.conviction_direction == "bullish")
    report.conviction_fall_count = sum(1 for r in all_results if r.conviction_direction == "bearish")

    # Top high-conviction stocks (STRONG + MODERATE)
    high_conv = [r for r in all_results if r.conviction_rating in ("STRONG", "MODERATE")]
    high_conv.sort(key=lambda x: x.conviction_score, reverse=True)
    for r in high_conv[:30]:
        report.high_conviction_stocks.append({
            "symbol": r.symbol,
            "company": r.company_name,
            "sector": r.sector,
            "conviction_score": r.conviction_score,
            "conviction_rating": r.conviction_rating,
            "conviction_direction": r.conviction_direction,
            "prediction": r.prediction,
            "confidence": r.prediction_confidence,
            "chart_patterns": len(r.chart_patterns),
            "signal_confluence": r.signal_confluence.get("signal_types", 0),
            "timeframes": r.signal_confluence.get("timeframes", 0),
        })

    # Cross-validation
    if cross_val:
        report.app_analysis_match_rate = round(cross_val.get("match_rate", 0), 1)
        report.discrepancies = cross_val.get("discrepancies", [])

    return report


def print_report(report: ValidationReport):
    """Print comprehensive report to stdout."""
    print("\n" + "█" * 80)
    print("   MULTI-PATTERN VALIDATION REPORT — Full NSE Universe")
    print("   Chart Patterns | Candlestick Patterns | Fundamental Analysis")
    print("   Predictive Validation | Obey/Not-Obey Classification")
    print("█" * 80)

    # ── Scan Parameters ──
    print(f"\n📋 SCAN PARAMETERS")
    for k, v in report.scan_parameters.items():
        print(f"   {k}: {v}")

    # ── Overview ──
    print(f"\n📊 OVERVIEW")
    print(f"   Total stocks scanned:     {report.total_stocks}")
    print(f"   Stocks with patterns:     {report.stocks_with_patterns} "
          f"({report.stocks_with_patterns / max(report.total_stocks, 1) * 100:.1f}%)")
    print(f"   Total chart patterns:     {report.total_chart_patterns}")
    print(f"   Total candle signals:     {report.total_candle_signals}")
    print(f"   Grow predictions:         {report.total_stocks_grow_prediction}")
    print(f"   Fall predictions:         {report.total_stocks_fall_prediction}")

    # ── Obey Rates by Pattern Type ──
    print(f"\n📈 CHART PATTERN OBEY RATES")
    print(f"   {'Pattern':25s} {'Count':>6s} {'Obeyed':>7s} {'Rate':>6s} {'Avg P&L':>8s} {'Avg R:R':>7s}")
    print(f"   {'-'*59}")
    for pt, data in sorted(report.pattern_obey_rates.items()):
        print(f"   {pt:25s} {data['count']:6d} {data['obeyed']:7d} {data['obey_rate']:5.1f}% "
              f"{data['avg_pnl_pct']:>+7.2f}% {data['avg_rr']:>6.1f}:1")

    print(f"\n   Overall chart obey rate:  {report.overall_chart_obey_rate:.1f}%")
    print(f"   Overall candle obey rate: {report.overall_candle_obey_rate:.1f}%")

    # ── By Timeframe ──
    print(f"\n⏱  OBEY RATES BY TIMEFRAME")
    print(f"   {'Timeframe':12s} {'Count':>6s} {'Obeyed':>7s} {'Rate':>6s} {'Avg P&L':>8s}")
    print(f"   {'-'*39}")
    for tf, data in sorted(report.timeframe_obey_rates.items()):
        print(f"   {tf:12s} {data['count']:6d} {data['obeyed']:7d} {data['obey_rate']:5.1f}% "
              f"{data['avg_pnl']:>+7.2f}%")

    # ── By Sector ──
    print(f"\n🏭 OBEY RATES BY SECTOR")
    print(f"   {'Sector':20s} {'Stocks':>7s} {'Patterns':>9s} {'Obey Rate':>10s}")
    print(f"   {'-'*46}")
    for sec, data in sorted(report.sector_obey_rates.items(), key=lambda x: x[1]["stocks"], reverse=True)[:15]:
        print(f"   {sec[:20]:20s} {data['stocks']:7d} {data['chart_total']:9d} {data['chart_obey_rate']:9.1f}%")

    # ── Top Obeying Patterns ──
    best_patterns = sorted(
        [(pt, d) for pt, d in report.pattern_obey_rates.items() if d["count"] >= 5],
        key=lambda x: x[1]["obey_rate"], reverse=True
    )
    if best_patterns:
        print(f"\n🥇 HIGHEST OBEY RATE PATTERNS (≥5 occurrences)")
        for pt, d in best_patterns[:5]:
            print(f"   {pt:25s} {d['obey_rate']:5.1f}% obey ({d['obeyed']}/{d['count']})")

    worst_patterns = sorted(
        [(pt, d) for pt, d in report.pattern_obey_rates.items() if d["count"] >= 5],
        key=lambda x: x[1]["obey_rate"]
    )
    if worst_patterns:
        print(f"\n⚠️  LOWEST OBEY RATE PATTERNS (≥5 occurrences)")
        for pt, d in worst_patterns[:5]:
            print(f"   {pt:25s} {d['obey_rate']:5.1f}% obey ({d['obeyed']}/{d['count']})")

    # ── Cross-Validation ──
    if report.discrepancies:
        print(f"\n🔄 CROSS-VALIDATION DISCREPANCIES")
        print(f"   Match rate: {report.app_analysis_match_rate:.1f}%")
        print(f"   Total discrepancies: {len(report.discrepancies)}")
        for d in report.discrepancies[:20]:
            print(f"   {d['symbol']:20s} App: {d['app_prediction']:8s} vs Manual: {d['manual_prediction']:8s}")

    # ── Top Stocks ──
    grow_stocks = [r for r in report.stock_results if r.prediction == "GROW"
                  and len(r.chart_patterns) >= 2]
    if grow_stocks:
        print(f"\n📗 TOP GROW PREDICTIONS (≥2 patterns, chart obeying)")
        grow_stocks.sort(key=lambda r: r.prediction_confidence, reverse=True)
        for r in grow_stocks[:10]:
            charts = len(r.chart_patterns)
            candles = len(r.candlestick_signals)
            fund = r.fundamental.overall_rating if r.fundamental else "N/A"
            print(f"   {r.symbol:20s} {r.company_name[:30]:30s} "
                  f"Charts:{charts} Cndl:{candles} Fund:{fund:12s} "
                  f"Conf:{r.prediction_confidence:.0f}%")

    fall_stocks = [r for r in report.stock_results if r.prediction == "FALL"
                  and len(r.chart_patterns) >= 2]
    if fall_stocks:
        print(f"\n📕 TOP FALL PREDICTIONS (≥2 patterns, chart obeying)")
        fall_stocks.sort(key=lambda r: r.prediction_confidence, reverse=True)
        for r in fall_stocks[:10]:
            charts = len(r.chart_patterns)
            candles = len(r.candlestick_signals)
            fund = r.fundamental.overall_rating if r.fundamental else "N/A"
            print(f"   {r.symbol:20s} {r.company_name[:30]:30s} "
                  f"Charts:{charts} Cndl:{candles} Fund:{fund:12s} "
                  f"Conf:{r.prediction_confidence:.0f}%")

    # ── Convolution Validation Section ──
    print(f"\n🔬 CONVOLUTION VALIDATION — Signal Confluence Engine")
    print(f"   {'Rating':12s} {'Count':>6s} {'% of Total':>11s}")
    print(f"   {'-'*29}")
    total_conv = sum(report.conviction_distribution.values()) or 1
    for rating in ("STRONG", "MODERATE", "WEAK", "NEUTRAL"):
        cnt = report.conviction_distribution.get(rating, 0)
        print(f"   {rating:12s} {cnt:6d} {cnt/total_conv*100:10.1f}%")
    print(f"   Bullish-direction stocks: {report.conviction_grow_count}")
    print(f"   Bearish-direction stocks: {report.conviction_fall_count}")
    high_strong = report.conviction_distribution.get("STRONG", 0)
    high_mod = report.conviction_distribution.get("MODERATE", 0)
    print(f"   High-conviction (STRONG+MODERATE): {high_strong + high_mod} "
          f"({(high_strong+high_mod)/total_conv*100:.1f}% of scanned)")

    # Top convictions
    if report.high_conviction_stocks:
        print(f"\n🏆 TOP HIGH-CONVICTION STOCKS")
        print(f"   {'Symbol':16s} {'Conv':>5s} {'Rating':10s} {'Dir':8s} {'Pred':6s} "
              f"{'Conf':>5s} {'SigTypes':>9s} {'TF':>3s}")
        print(f"   {'-'*62}")
        for s in report.high_conviction_stocks[:15]:
            print(f"   {s['symbol']:16s} {s['conviction_score']:5.1f} {s['conviction_rating']:10s} "
                  f"{s['conviction_direction']:8s} {s['prediction']:6s} {s['confidence']:5.0f} "
                  f"{s['signal_confluence']:4d} types {s['timeframes']:2d} TF")

    # ── Summary ──
    print(f"\n✅ VALIDATION SUMMARY")
    print(f"   The pattern detection engine has been validated against {report.total_stocks} NSE stocks")
    print(f"   across daily, weekly, and monthly timeframes.")
    print(f"   Overall chart obey rate: {report.overall_chart_obey_rate:.1f}%")
    print(f"   Stocks with enough data to predict: {report.total_stocks_grow_prediction + report.total_stocks_fall_prediction}")
    print(f"   Convolution-high-conviction stocks: {high_strong + high_mod}")
    print(f"   Reports saved to: {REPORT_DIR.resolve()}")

    print(f"\n{'=' * 80}\n")


def save_report(report: ValidationReport):
    """Save report data to JSON files."""
    # Main report
    report_dict = {
        "scan_parameters": report.scan_parameters,
        "total_stocks": report.total_stocks,
        "stocks_with_patterns": report.stocks_with_patterns,
        "total_chart_patterns": report.total_chart_patterns,
        "total_candle_signals": report.total_candle_signals,
        "pattern_obey_rates": report.pattern_obey_rates,
        "timeframe_obey_rates": report.timeframe_obey_rates,
        "sector_obey_rates": report.sector_obey_rates,
        "overall_chart_obey_rate": report.overall_chart_obey_rate,
        "overall_candle_obey_rate": report.overall_candle_obey_rate,
        "total_stocks_grow_prediction": report.total_stocks_grow_prediction,
        "total_stocks_fall_prediction": report.total_stocks_fall_prediction,
        "app_analysis_match_rate": report.app_analysis_match_rate,
        "discrepancies": report.discrepancies[:50],  # cap
        # Convolution validation
        "conviction_distribution": report.conviction_distribution,
        "conviction_grow_count": report.conviction_grow_count,
        "conviction_fall_count": report.conviction_fall_count,
        "high_conviction_stocks": report.high_conviction_stocks[:50],
    }

    report_path = REPORT_DIR / "validation_report.json"
    with open(report_path, "w") as f:
        json.dump(report_dict, f, indent=2, default=str)
    print(f"  [✓] Report saved: {report_path}")

    # Detailed per-stock CSV
    rows = []
    for r in report.stock_results:
        chart_count = len(r.chart_patterns)
        chart_obey = sum(1 for p in r.chart_patterns if p.obeyed)
        candle_count = len(r.candlestick_signals)
        candle_obey = sum(1 for c in r.candlestick_signals if c.obeyed)
        fund_rating = r.fundamental.overall_rating if r.fundamental else "N/A"
        fund_score = r.fundamental.score if r.fundamental else 0

        signal_types = r.signal_confluence.get("signal_types", 0)
        tf_count = r.signal_confluence.get("timeframes", 0)

        rows.append({
            "symbol": r.symbol,
            "company": r.company_name,
            "sector": r.sector,
            "chart_patterns": chart_count,
            "chart_obeyed": chart_obey,
            "chart_obey_rate": round(chart_obey / chart_count * 100, 1) if chart_count else 0,
            "candle_signals": candle_count,
            "candle_obeyed": candle_obey,
            "candle_obey_rate": round(candle_obey / candle_count * 100, 1) if candle_count else 0,
            "fundamental_rating": fund_rating,
            "fundamental_score": fund_score,
            "prediction": r.prediction,
            "prediction_confidence": r.prediction_confidence,
            # Convolution fields
            "conviction_score": r.conviction_score,
            "conviction_rating": r.conviction_rating,
            "conviction_direction": r.conviction_direction,
            "signal_types": signal_types,
            "timeframes": tf_count,
            "errors": "; ".join(r.errors),
        })

    csv_path = REPORT_DIR / "stock_predictions.csv"
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    print(f"  [✓] Stock predictions CSV: {csv_path}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Multi-Pattern Validator — Full NSE Universe",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--scan", type=str, nargs="?", const="50", default=None,
                        help="Scan N stocks (default: 50, use 'all' for full universe)")
    parser.add_argument("--symbol", type=str, help="Analyze a single symbol")
    parser.add_argument("--workers", type=int, default=8, help="Parallel workers")
    parser.add_argument("--fresh", action="store_true", help="Clear cache")
    parser.add_argument("--report-only", action="store_true",
                        help="Only regenerate report from cached results")
    parser.add_argument("--cross-validate", type=str, default=None,
                        help="JSON file with manual analysis for cross-validation")
    args = parser.parse_args()

    if args.fresh:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
        CACHE_DIR.mkdir(exist_ok=True)

    # ── Load symbols ──
    all_results: List[StockResult] = []
    cache_file = OUTPUT_DIR / "all_stock_results.json"

    if args.report_only:
        if cache_file.exists():
            print(f"[INFO] Loading cached results from {cache_file}")
            # For report-only mode, we load from high-level cache
            with open(cache_file) as f:
                raw = json.load(f)
            # Reconstruct StockResult objects
            for r_data in raw:
                sr = StockResult(symbol=r_data.get("symbol", ""))
                sr.company_name = r_data.get("company_name", "")
                sr.sector = r_data.get("sector", "")
                sr.prediction = r_data.get("prediction", "")
                sr.prediction_confidence = r_data.get("prediction_confidence", 0)

                for p_data in r_data.get("chart_patterns", []):
                    p = ChartPattern(**p_data)
                    sr.chart_patterns.append(p)

                for c_data in r_data.get("candlestick_signals", []):
                    cs = CandlestickSignal(**c_data)
                    sr.candlestick_signals.append(cs)

                if r_data.get("fundamental"):
                    sr.fundamental = FundamentalSignal(**r_data["fundamental"])

                sr.overall_chart_obey = r_data.get("overall_chart_obey", False)
                sr.overall_candle_obey = r_data.get("overall_candle_obey", False)
                sr.overall_fundamental_bullish = r_data.get("overall_fundamental_bullish", False)
                sr.errors = r_data.get("errors", [])
                # Restore convolution fields
                sr.conviction_score = r_data.get("conviction_score", 0.0)
                sr.conviction_rating = r_data.get("conviction_rating", "")
                sr.conviction_direction = r_data.get("conviction_direction", "")
                sr.signal_confluence = r_data.get("signal_confluence", {})
                all_results.append(sr)

            print(f"[INFO] Loaded {len(all_results)} stock results")
        else:
            print("[ERROR] No cached results found. Run a scan first.")
            sys.exit(1)
    else:
        # Build symbol list
        symbols = []
        if args.symbol:
            symbols = [args.symbol]
        elif args.scan:
            all_syms = fetch_nse_symbols()
            if args.scan.lower() == "all":
                symbols = all_syms
            else:
                symbols = all_syms[:int(args.scan)]
            print(f"[INFO] Scanning {len(symbols)} NSE symbols")
        else:
            symbols = fetch_nse_symbols()[:50]
            print(f"[INFO] Default: scanning first 50 symbols")

        if not symbols:
            print("[ERROR] No symbols to scan")
            sys.exit(1)

        # Scan
        t0 = time.time()
        done = 0
        total = len(symbols)

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            fut_map = {ex.submit(analyze_stock, sym, fresh=args.fresh): sym for sym in symbols}
            for fut in as_completed(fut_map):
                done += 1
                try:
                    result = fut.result()
                    if result:
                        all_results.append(result)
                except Exception as e:
                    print(f"  [WARN] Error: {fut_map[fut]}: {e}", file=sys.stderr)

                if done % 100 == 0 or done == total:
                    elapsed = time.time() - t0
                    charts = sum(len(r.chart_patterns) for r in all_results)
                    candles = sum(len(r.candlestick_signals) for r in all_results)
                    print(f"[{done}/{total}] {elapsed:.0f}s | "
                          f"Chart patterns: {charts} | Candle signals: {candles}",
                          file=sys.stderr)

        elapsed = time.time() - t0
        print(f"\n[INFO] Complete: {done} symbols in {elapsed:.1f}s")

        # Cache results (simplified)
        raw_results = []
        for r in all_results:
            rd = {
                "symbol": r.symbol,
                "company_name": r.company_name,
                "sector": r.sector,
                "chart_patterns": [asdict(p) for p in r.chart_patterns],
                "candlestick_signals": [asdict(c) for c in r.candlestick_signals],
                "fundamental": asdict(r.fundamental) if r.fundamental else None,
                "overall_chart_obey": r.overall_chart_obey,
                "overall_candle_obey": r.overall_candle_obey,
                "overall_fundamental_bullish": r.overall_fundamental_bullish,
                "prediction": r.prediction,
                "prediction_confidence": r.prediction_confidence,
                "errors": r.errors,
                # Convolution fields
                "conviction_score": r.conviction_score,
                "conviction_rating": r.conviction_rating,
                "conviction_direction": r.conviction_direction,
                "signal_confluence": r.signal_confluence,
            }
            raw_results.append(rd)

        with open(cache_file, "w") as f:
            json.dump(raw_results, f, indent=2, default=str)
        print(f"[INFO] Results cached: {cache_file}")

    # ── Cross-Validation ──
    cross_val = None
    if args.cross_validate:
        cross_val = cross_validate(all_results, args.cross_validate)
        print(f"[INFO] Cross-validation: {cross_val['match_rate']:.1f}% match rate")

    # ── Generate Report ──
    scan_params = {
        "command": " ".join(sys.argv),
        "timestamp": datetime.now().isoformat(),
        "total_symbols": len(all_results),
        "workers": args.workers,
        "fresh_data": args.fresh,
    }

    report = generate_report(all_results, scan_params, cross_val)
    print_report(report)
    save_report(report)

    # ── Save detailed per-stock report ──
    detailed_path = REPORT_DIR / "detailed_analysis.json"
    with open(detailed_path, "w") as f:
        json.dump([{
            "symbol": r.symbol,
            "company": r.company_name,
            "sector": r.sector,
            "prediction": r.prediction,
            "confidence": r.prediction_confidence,
            "chart_patterns": [asdict(p) for p in r.chart_patterns],
            "candle_signals": [asdict(c) for c in r.candlestick_signals],
            "fundamental": asdict(r.fundamental) if r.fundamental else None,
            "errors": r.errors,
            "conviction_score": r.conviction_score,
            "conviction_rating": r.conviction_rating,
            "conviction_direction": r.conviction_direction,
            "signal_confluence": r.signal_confluence,
        } for r in all_results], f, indent=2, default=str)
    print(f"  [✓] Detailed analysis: {detailed_path}")

    print(f"\n📁 All outputs in {OUTPUT_DIR.resolve()}")
    print(f"📁 Reports in {REPORT_DIR.resolve()}")


if __name__ == "__main__":
    main()
