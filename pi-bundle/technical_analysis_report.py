#!/usr/bin/env python3
"""
technical_analysis_report.py — Institutional-Grade Technical Analysis Report Generator

Usage:
    python technical_analysis_report.py HDFCBANK.NS
    python technical_analysis_report.py AAPL --options --wyckoff --gann
    python technical_analysis_report.py HDFCBANK.NS --save-json

Covers:
    Market Structure, Trend, S/R, Fibonacci, Indicators,
    Candlestick Patterns, Divergence, Multi-Timeframe,
    Wyckoff/ICT (OB, FVG, Liquidity Sweeps, Springs, Phases),
    Gann (Fans, Cycles, Square of 9), Options Strategies,
    Fundamentals, 8-Panel Chart
"""

import argparse
import json
import logging
import math
import os
import sys
from datetime import datetime, timedelta
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Tuple

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from scipy import signal as scipy_signal
from scipy.stats import norm

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Rectangle

# ── Shared yfinance HTTP session ──
# NOTE (2026-09-05): the custom User-Agent on this session gets flagged by
# Yahoo (YFRateLimitError) while yfinance's own session works. We therefore
# NO LONGER pass session=_YF_SESSION to yf.download/yf.Ticker — yfinance
# manages its own session (curl_cffi when available). The session object is
# kept for any code that still references it directly.
_YF_SESSION = requests.Session()
_YF_SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
_YF_SESSION.headers["Accept"] = "application/json"
_YF_SESSION.headers["Accept-Language"] = "en-US,en;q=0.9"
_YF_SESSION.timeout = (3.05, 10)  # (connect_timeout, read_timeout)

# Optional modules (graceful import)
try:
    from analysis_db import AnalysisDatabase
    HAS_DB = True
except ImportError:
    HAS_DB = False
    AnalysisDatabase = None

try:
    from portfolio_heatmap import PortfolioHeatmap
    HAS_HEATMAP = True
except ImportError:
    HAS_HEATMAP = False
    PortfolioHeatmap = None

try:
    from quantamental_backtester import QuantamentalBacktester
    HAS_BACKTESTER = True
except ImportError:
    HAS_BACKTESTER = False
    QuantamentalBacktester = None

try:
    from sentiment_analyzer import SentimentAnalyzer, sentiment_weight_adjustment, sentiment_adjustment_label
    HAS_SENTIMENT = True
except ImportError:
    HAS_SENTIMENT = False
    SentimentAnalyzer = None
    sentiment_weight_adjustment = None
    sentiment_adjustment_label = None

# ── Rule engine (market-analysis decision logic) ──
# The rule package ships alongside this module in every deploy location
# (engine/rules for git, <root>/rules for the live/vercel/pi copies). Ensure
# our own directory is importable so `rules` resolves regardless of cwd.
logging.basicConfig(level=logging.INFO, format='%(levelname)s | %(message)s')
log = logging.getLogger(__name__)

_ENGINE_HOME = os.path.dirname(os.path.abspath(__file__))
if _ENGINE_HOME not in sys.path:
    sys.path.insert(0, _ENGINE_HOME)
try:
    from rules import technical as _rules_technical
    from rules import fundamental as _rules_fundamental
    from rules import gates as _rules_gates
    from rules import quantamental as _rules_quant
    from rules import pattern_gates as _rules_patterns
    from rules.core import MarketFeatures as _MarketFeatures
    from rules.core import DecisionTrace as _DecisionTrace
    HAS_RULES = True
except Exception as _rules_import_err:  # pragma: no cover - defensive
    HAS_RULES = False
    _rules_technical = _rules_fundamental = _rules_gates = None
    _rules_quant = _rules_patterns = _MarketFeatures = _DecisionTrace = None
    log.warning(f"Rule engine unavailable, using inline logic: {_rules_import_err}")
log = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────
# DARK THEME MATPLOTLIB CONFIG
# ────────────────────────────────────────────────────────────
plt.rcParams['figure.facecolor'] = '#0d1117'
plt.rcParams['axes.facecolor'] = '#161b22'
plt.rcParams['axes.edgecolor'] = '#30363d'
plt.rcParams['axes.labelcolor'] = '#c9d1d9'
plt.rcParams['xtick.color'] = '#8b949e'
plt.rcParams['ytick.color'] = '#8b949e'
plt.rcParams['legend.facecolor'] = '#161b22'
plt.rcParams['legend.edgecolor'] = '#30363d'
plt.rcParams['legend.labelcolor'] = '#c9d1d9'
plt.rcParams['axes.titlecolor'] = '#c9d1d9'

# ────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ────────────────────────────────────────────────────────────

@dataclass
class AnalysisResult:
    """Container for all analysis outputs."""
    ticker: str
    period: str = "1y"

    # Raw data
    df: Optional[pd.DataFrame] = None
    weekly: Optional[pd.DataFrame] = None
    monthly: Optional[pd.DataFrame] = None

    # Structure
    market_structure: dict = field(default_factory=dict)
    trend: dict = field(default_factory=dict)

    # Levels
    support_resistance: dict = field(default_factory=dict)
    fibonacci: dict = field(default_factory=dict)
    pivot_points: dict = field(default_factory=dict)

    # Indicators
    rsi: dict = field(default_factory=dict)
    macd: dict = field(default_factory=dict)
    bollinger: dict = field(default_factory=dict)
    adx: dict = field(default_factory=dict)
    atr: dict = field(default_factory=dict)
    obv: dict = field(default_factory=dict)
    volume: dict = field(default_factory=dict)

    # Moving Averages
    moving_averages: dict = field(default_factory=dict)

    # Candlestick
    candlestick_pattern: dict = field(default_factory=dict)

    # Divergence
    divergence: list = field(default_factory=list)

    # MTF
    mtf: dict = field(default_factory=dict)

    # Wyckoff / ICT
    wyckoff: dict = field(default_factory=dict)

    # Gann
    gann: dict = field(default_factory=dict)

    # Options
    options: dict = field(default_factory=dict)

    # Fundamentals
    fundamentals: dict = field(default_factory=dict)

    # Quantamental (fused technical + fundamental + sentiment)
    quantamental: dict = field(default_factory=dict)

    # Sentiment (news NLP third pillar)
    sentiment: dict = field(default_factory=dict)

    # Key levels
    invalidation: Optional[float] = None
    entry_zone: tuple = (None, None)
    targets: list = field(default_factory=list)
    confidence: float = 0.0
    signal: str = "HOLD"

    # Quality gates (institutional filters applied post-classification)
    quality_gates: list = field(default_factory=list)

    # Original technical signal before quantamental blending
    technical_signal: Optional[str] = None

    # Confluence confirmation gate (multi-signal convolution, 2026-09-05)
    # Root cause of low accuracy: a single weak pattern fired a BUY with no
    # independent confirmation. confirm_count = how many of the 4 independent
    # signals (trend, momentum, pattern, volume) agree; BUY requires >= 3.
    confirm_score: float = 0.0
    confirm_count: int = 0
    confirm_details: dict = field(default_factory=dict)
    # Signal immediately BEFORE the confluence gate ran (after quantamental
    # blend, before gate + quality gates). Used by the backtester to compare
    # gated vs ungated BUY accuracy.
    pre_gate_signal: Optional[str] = None

    # Weighted convolution (2026-09-05) — replaces the flat confirmation gate.
    # conv_technical: {score, raw_total, components, pattern_votes,
    #                  pattern_majority}; conv_fundamental: {score, factors,
    #                  cap_applied, cap_reason}.
    conv_technical: dict = field(default_factory=dict)
    conv_fundamental: dict = field(default_factory=dict)

    # Raw computed arrays (for charting)
    _sma20: np.ndarray = field(default_factory=lambda: np.array([]))
    _sma50: np.ndarray = field(default_factory=lambda: np.array([]))
    _sma200: np.ndarray = field(default_factory=lambda: np.array([]))
    _bb_upper: np.ndarray = field(default_factory=lambda: np.array([]))
    _bb_lower: np.ndarray = field(default_factory=lambda: np.array([]))
    _rsi_full: np.ndarray = field(default_factory=lambda: np.array([]))
    _macd_line: np.ndarray = field(default_factory=lambda: np.array([]))
    _signal_line: np.ndarray = field(default_factory=lambda: np.array([]))
    _hist: np.ndarray = field(default_factory=lambda: np.array([]))
    _obv_line: np.ndarray = field(default_factory=lambda: np.array([]))
    _order_blocks: list = field(default_factory=list)
    _fvgs: list = field(default_factory=list)
    _liquidity_sweeps: list = field(default_factory=list)
    _pivot_highs: list = field(default_factory=list)
    _pivot_lows: list = field(default_factory=list)
    _trendlines: list = field(default_factory=list)
    _gann_fan_lines: list = field(default_factory=list)


# ────────────────────────────────────────────────────────────
# MODULE 1: Metrics Engine
# ────────────────────────────────────────────────────────────

class MetricsEngine:
    """Computes all technical indicators from OHLCV data."""

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self.o = df['Open'].values.astype(float)
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.c = df['Close'].values.astype(float)
        self.v = df['Volume'].values.astype(float)
        self.n = len(df)

    def moving_averages(self) -> dict:
        """Return SMA20, SMA50, SMA200 and price positions."""
        s20 = pd.Series(self.c).rolling(20).mean().values
        s50 = pd.Series(self.c).rolling(50).mean().values
        s200 = pd.Series(self.c).rolling(200).mean().values

        p = self.c[-1]
        return {
            'sma20': float(s20[-1]), 'sma50': float(s50[-1]), 'sma200': float(s200[-1]),
            'price_vs_20': float((p / s20[-1] - 1) * 100) if s20[-1] else 0,
            'price_vs_50': float((p / s50[-1] - 1) * 100) if s50[-1] else 0,
            'price_vs_200': float((p / s200[-1] - 1) * 100) if s200[-1] else 0,
            'above_20': bool(p > s20[-1]), 'above_50': bool(p > s50[-1]), 'above_200': bool(p > s200[-1]),
            'golden_cross': bool(s20[-1] > s50[-1] and s20[-2] <= s50[-2]) if len(s20) > 1 and len(s50) > 1 else False,
            'death_cross': bool(s20[-1] < s50[-1] and s20[-2] >= s50[-2]) if len(s20) > 1 and len(s50) > 1 else False,
            'aligned_bullish': bool(s20[-1] > s50[-1] > s200[-1]),
            'aligned_bearish': bool(s20[-1] < s50[-1] < s200[-1]),
        }, s20, s50, s200

    def rsi(self, period: int = 14) -> dict:
        """RSI with overbought/oversold."""
        delta = np.diff(self.c)
        gain = np.where(delta > 0, delta, 0)
        loss = np.where(delta < 0, -delta, 0)
        avg_gain = pd.Series(gain).rolling(period).mean().values
        avg_loss = pd.Series(loss).rolling(period).mean().values
        rs = avg_gain / np.where(avg_loss == 0, 1e-10, avg_loss)
        rsi = 100 - (100 / (1 + rs))

        rsi_full = np.full(self.n, np.nan)
        rsi_full[period:] = rsi[period - 1:]

        val = float(rsi_full[-1]) if not np.isnan(rsi_full[-1]) else 50.0
        return {
            'value': val,
            'status': 'Overbought' if val > 70 else 'Oversold' if val < 30 else 'Neutral',
            'overbought': val > 70,
            'oversold': val < 30,
        }, rsi_full

    def macd(self, fast=12, slow=26, signal=9) -> dict:
        """MACD line, signal, histogram, crossover."""
        ema_fast = pd.Series(self.c).ewm(span=fast).mean().values
        ema_slow = pd.Series(self.c).ewm(span=slow).mean().values
        macd_line = ema_fast - ema_slow
        signal_line = pd.Series(macd_line).ewm(span=signal).mean().values
        hist = macd_line - signal_line

        val = float(macd_line[-1])
        sig = float(signal_line[-1])
        return {
            'macd': val,
            'signal': sig,
            'histogram': float(hist[-1]),
            'crossover': 'Bullish' if val > sig else 'Bearish',
            'above_zero': val > 0,
            'histogram_increasing': hist[-1] > hist[-2] if len(hist) > 1 else False,
            'histogram_slope': float(hist[-1] - hist[-3]) if len(hist) > 3 else 0,
        }, macd_line, signal_line, hist

    def bollinger(self, period=20, std_dev=2) -> dict:
        """Bollinger Bands with %B and bandwidth."""
        mid = pd.Series(self.c).rolling(period).mean().values
        std = pd.Series(self.c).rolling(period).std().values
        upper = mid + std_dev * std
        lower = mid - std_dev * std

        p = self.c[-1]
        bb_pct = (p - lower[-1]) / (upper[-1] - lower[-1]) if upper[-1] != lower[-1] else 0.5
        bw = (upper[-1] - lower[-1]) / mid[-1] if mid[-1] else 0

        hist_bw = pd.Series(bw) if isinstance(bw, (int, float)) else pd.Series(pd.Series((upper - lower) / mid).rolling(20).mean())
        if isinstance(bw, np.ndarray):
            bw_hist = bw
        else:
            bw_hist = (upper - lower) / mid
        bw_sma = pd.Series(bw_hist).rolling(20).mean().values[-1] if len(bw_hist) > 20 else np.mean(bw_hist[:20])

        return {
            'upper': float(upper[-1]), 'middle': float(mid[-1]), 'lower': float(lower[-1]),
            'percent_b': float(bb_pct * 100),
            'bandwidth': float(bw * 100) if not isinstance(bw, np.ndarray) else float(bw[-1] * 100),
            'squeeze': float(bw_hist[-1]) < float(bw_sma) if len(bw_hist) > 20 and bw_hist[-1] and bw_sma else False,
            'near_upper': bool(p >= upper[-1] * 0.99),
            'near_lower': bool(p <= lower[-1] * 1.01),
        }, upper, mid, lower

    def adx(self, period=14) -> dict:
        """ADX +DI -DI trend strength."""
        tr = np.maximum(self.h[1:] - self.l[1:],
                        np.maximum(np.abs(self.h[1:] - self.c[:-1]),
                                   np.abs(self.l[1:] - self.c[:-1])))
        up = self.h[1:] - self.h[:-1]
        dn = self.l[:-1] - self.l[1:]
        pos_dm = np.where((up > dn) & (up > 0), up, 0)
        neg_dm = np.where((dn > up) & (dn > 0), dn, 0)

        atr = pd.Series(tr).rolling(period).mean().values
        pdi = pd.Series(pos_dm).rolling(period).mean().values / atr * 100
        ndi = pd.Series(neg_dm).rolling(period).mean().values / atr * 100
        dx = np.abs(pdi - ndi) / (pdi + ndi) * 100
        adx_val = pd.Series(dx).rolling(period).mean().values

        adx_latest = float(adx_val[-1]) if not np.isnan(adx_val[-1]) else 0
        pdi_latest = float(pdi[-1]) if not np.isnan(pdi[-1]) else 0
        ndi_latest = float(ndi[-1]) if not np.isnan(ndi[-1]) else 0

        if adx_latest > 40:
            strength = "Very Strong"
        elif adx_latest > 25:
            strength = "Strong"
        elif adx_latest > 20:
            strength = "Moderate"
        else:
            strength = "Weak / Ranging"

        return {
            'adx': adx_latest,
            'plus_di': pdi_latest,
            'minus_di': ndi_latest,
            'strength': strength,
            'di_bias': 'Bullish' if pdi_latest > ndi_latest else 'Bearish' if ndi_latest > pdi_latest else 'Neutral',
        }

    def atr(self, period=14) -> dict:
        """Average True Range."""
        tr = np.maximum(self.h[1:] - self.l[1:],
                        np.maximum(np.abs(self.h[1:] - self.c[:-1]),
                                   np.abs(self.l[1:] - self.c[:-1])))
        atr_vals = pd.Series(tr).rolling(period).mean().values
        atr_latest = float(atr_vals[-1]) if not np.isnan(atr_vals[-1]) else 0
        pct = atr_latest / self.c[-1] * 100

        # Volatility regime
        atr_sma20 = pd.Series(atr_vals).rolling(20).mean().values[-1] if len(atr_vals) > 20 else np.nan
        expanding = atr_vals[-1] > atr_sma20 if atr_sma20 and not np.isnan(atr_sma20) else None

        return {
            'atr': atr_latest,
            'percent_of_price': pct,
            'expanding': expanding,
            'regime': 'High' if pct > 3 else 'Moderate' if pct > 1.5 else 'Low',
        }

    def obv(self) -> dict:
        """On-Balance Volume with trend comparison."""
        obv = np.zeros(self.n)
        for i in range(1, self.n):
            if self.c[i] > self.c[i - 1]:
                obv[i] = obv[i - 1] + self.v[i]
            elif self.c[i] < self.c[i - 1]:
                obv[i] = obv[i - 1] - self.v[i]
            else:
                obv[i] = obv[i - 1]

        obv_sma20 = pd.Series(obv).rolling(20).mean().values
        obv_sma50 = pd.Series(obv).rolling(50).mean().values

        # Trend comparison
        price_up_3m = self.c[-1] > self.c[-3] if self.n > 3 else False
        obv_up_3m = obv[-1] > obv[-3] if self.n > 3 else False
        divergence = None
        if price_up_3m and not obv_up_3m:
            divergence = "Bearish Divergence"
        elif not price_up_3m and obv_up_3m:
            divergence = "Bullish Divergence"

        return {
            'obv_trend': 'Bullish' if obv[-1] > obv_sma20[-1] else 'Bearish',
            'obv_above_sma20': bool(obv[-1] > obv_sma20[-1]),
            'obv_above_sma50': bool(obv[-1] > obv_sma50[-1]),
            'divergence': divergence,
            'price_obv_aligned': not bool(divergence),
        }, obv

    def volume_analysis(self) -> dict:
        """Volume trends and comparisons."""
        vol_sma20 = pd.Series(self.v).rolling(20).mean().values
        vol_sma50 = pd.Series(self.v).rolling(50).mean().values
        vol_ratio = self.v[-1] / vol_sma20[-1] if vol_sma20[-1] else 1

        # Up/Down volume ratio over last 10 days
        up_vol = sum(self.v[i] for i in range(-10, 0) if self.c[i] >= self.c[i - 1]) if self.n >= 10 else 0
        dn_vol = sum(self.v[i] for i in range(-10, 0) if self.c[i] < self.c[i - 1]) if self.n >= 10 else 0
        vol_ratio_ud = up_vol / dn_vol if dn_vol else 0

        # Consecutive up volume days
        cons_up = 0
        for i in range(self.n - 1, 0, -1):
            if self.c[i] >= self.c[i - 1] and self.v[i] >= vol_sma20[i]:
                cons_up += 1
            else:
                break

        return {
            'avg_vol_20': float(vol_sma20[-1]),
            'avg_vol_50': float(vol_sma50[-1]),
            'last_volume': float(self.v[-1]),
            'volume_ratio_vs_20': float(vol_ratio),
            'status': 'Above Avg' if vol_ratio > 1.2 else 'Below Avg' if vol_ratio < 0.8 else 'Normal',
            'up_down_ratio_10d': float(vol_ratio_ud),
            'consecutive_up_volume_days': cons_up,
        }

    def run_all(self):
        """Compute all metrics and return structured dict + raw arrays."""
        result = {}

        result['ma'], s20, s50, s200 = self.moving_averages()
        result['rsi'], rsi_full = self.rsi()
        result['macd'], macd_l, sig_l, hist = self.macd()
        result['bb'], bb_u, bb_m, bb_l = self.bollinger()
        result['adx'] = self.adx()
        result['atr'] = self.atr()
        result['obv_raw'], obv_line = self.obv()
        result['volume'] = self.volume_analysis()

        raw = {
            'sma20': s20, 'sma50': s50, 'sma200': s200,
            'bb_upper': bb_u, 'bb_mid': bb_m, 'bb_lower': bb_l,
            'rsi_full': rsi_full,
            'macd_line': macd_l, 'signal_line': sig_l, 'hist': hist,
            'obv_line': obv_line,
        }
        return result, raw


# ────────────────────────────────────────────────────────────
# MODULE 2: Structure Analyzer
# ────────────────────────────────────────────────────────────

class StructureAnalyzer:
    """Market structure: HH/HL/LH/LL, BOS, CHOCH, trendlines."""

    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.c = df['Close'].values.astype(float)
        self.n = len(df)

    def find_pivots(self, window: int = 5):
        """Find pivot highs and lows."""
        pivots_high = []
        pivots_low = []
        for i in range(window, self.n - window):
            if all(self.h[i] > self.h[i - window:i]) and all(self.h[i] >= self.h[i + 1:i + window + 1]):
                pivots_high.append((i, float(self.h[i])))
            if all(self.l[i] < self.l[i - window:i]) and all(self.l[i] <= self.l[i + 1:i + window + 1]):
                pivots_low.append((i, float(self.l[i])))
        return pivots_high, pivots_low

    def identify_structure(self, pivots_high, pivots_low):
        """Determine HH/HL/LH/LL and BOS/CHOCH."""
        # Use last 4 pivots of each type
        recent_highs = [p[1] for p in pivots_high[-4:]] if len(pivots_high) >= 4 else [p[1] for p in pivots_high]
        recent_lows = [p[1] for p in pivots_low[-4:]] if len(pivots_low) >= 4 else [p[1] for p in pivots_low]

        structure = "Ranging"
        hh = hl = lh = ll = False

        if len(recent_highs) >= 2:
            hh = recent_highs[-1] > recent_highs[-2]
            lh = recent_highs[-1] < recent_highs[-2]
        if len(recent_lows) >= 2:
            hl = recent_lows[-1] > recent_lows[-2]
            ll = recent_lows[-1] < recent_lows[-2]

        if hh and hl:
            structure = "Uptrend (HH+HL)"
        elif lh and ll:
            structure = "Downtrend (LH+LL)"
        elif hh and ll:
            structure = "Expanding / Volatile"
        elif lh and hl:
            structure = "Contracting / Consolidation"

        # BOS / CHOCH
        bos_high = None
        bos_low = None
        choch = None

        if len(pivots_high) >= 3 and len(pivots_low) >= 3:
            # BOS: price breaks above previous HH in uptrend
            if structure.startswith("Uptrend"):
                if self.c[-1] > pivots_high[-2][1]:
                    bos_high = float(self.c[-1])
            # BOS: price breaks below previous LL in downtrend
            if structure.startswith("Downtrend"):
                if self.c[-1] < pivots_low[-2][1]:
                    bos_low = float(self.c[-1])

            # CHOCH: trend reversal
            # In uptrend, break below last HL
            if structure.startswith("Uptrend") and len(pivots_low) >= 2:
                if self.c[-1] < pivots_low[-2][1]:
                    choch = "Bearish CHOCH (LH+LL starting)"
            # In downtrend, break above last LH
            if structure.startswith("Downtrend") and len(pivots_high) >= 2:
                if self.c[-1] > pivots_high[-2][1]:
                    choch = "Bullish CHOCH (HH+HL starting)"

        return {
            'structure': structure,
            'hh': hh, 'hl': hl, 'lh': lh, 'll': ll,
            'bos_high': bos_high,
            'bos_low': bos_low,
            'choch': choch,
            'pivot_count_highs': len(pivots_high),
            'pivot_count_lows': len(pivots_low),
        }

    def trendlines(self, pivots_high, pivots_low):
        """Return dominant trendline slopes from pivots."""
        lines = []
        # Descending trendline from pivots_high
        if len(pivots_high) >= 2:
            idx1, v1 = pivots_high[-2]
            idx2, v2 = pivots_high[-1]
            slope = (v2 - v1) / (idx2 - idx1) if idx2 != idx1 else 0
            lines.append({'type': 'resistance', 'slope': slope, 'p1_idx': idx1, 'p1_val': v1, 'p2_idx': idx2, 'p2_val': v2})

        # Ascending trendline from pivots_low
        if len(pivots_low) >= 2:
            idx1, v1 = pivots_low[-2]
            idx2, v2 = pivots_low[-1]
            slope = (v2 - v1) / (idx2 - idx1) if idx2 != idx1 else 0
            lines.append({'type': 'support', 'slope': slope, 'p1_idx': idx1, 'p1_val': v1, 'p2_idx': idx2, 'p2_val': v2})

        return lines

    def analyze(self):
        """Full structure analysis."""
        p_high, p_low = self.find_pivots()
        struct = self.identify_structure(p_high, p_low)
        tlines = self.trendlines(p_high, p_low)
        return struct, tlines, p_high, p_low


# ────────────────────────────────────────────────────────────
# MODULE 3: Level Finder
# ────────────────────────────────────────────────────────────

class LevelFinder:
    """Support/Resistance, Fibonacci, Classic Pivot Points."""

    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.o = df['Open'].values.astype(float)
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.c = df['Close'].values.astype(float)
        self.n = len(df)

    def fibonacci_retracement(self, pivots_high, pivots_low):
        """Compute Fibonacci retracement levels from nearest swing high to low."""
        if not pivots_high or not pivots_low:
            return {}

        # Find the most relevant swing high and low
        # Use max high and min low from last 60 days if no pivots
        recent = self.df.tail(60)
        swing_high = max(p[1] for p in pivots_high[-3:]) if len(pivots_high) >= 3 else float(recent['High'].max())
        swing_low = min(p[1] for p in pivots_low[-3:]) if len(pivots_low) >= 3 else float(recent['Low'].min())

        if swing_high <= swing_low:
            return {}

        fib_range = swing_high - swing_low
        levels = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 0.886, 1.0]
        labels = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '88.6%', '100%']

        fibs = {}
        for lvl, lbl in zip(levels, labels):
            price = swing_high - fib_range * lvl
            dist = (self.c[-1] / price - 1) * 100
            fibs[lbl] = {
                'level': round(price, 2),
                'distance_pct': round(dist, 2),
                'near': abs(dist) < 3,
                'closest': False,
            }

        # Mark the closest level
        min_dist = min(abs(v['distance_pct']) for v in fibs.values())
        for k, v in fibs.items():
            if abs(v['distance_pct']) == min_dist:
                v['closest'] = True

        return {
            'swing_high': round(swing_high, 2),
            'swing_low': round(swing_low, 2),
            'range': round(fib_range, 2),
            'levels': fibs,
        }

    def fibonacci_extension(self, pivots_high, pivots_low):
        """Compute Fib extension targets (1.272, 1.414, 1.618) from recent swing."""
        if not pivots_high or not pivots_low:
            return {}

        recent = self.df.tail(60)
        swing_high = max(p[1] for p in pivots_high[-3:]) if len(pivots_high) >= 3 else float(recent['High'].max())
        swing_low = min(p[1] for p in pivots_low[-3:]) if len(pivots_low) >= 3 else float(recent['Low'].min())

        if swing_high <= swing_low:
            return {}

        fib_range = swing_high - swing_low
        exts = {'1.272': swing_high + 0.272 * fib_range,
                '1.414': swing_high + 0.414 * fib_range,
                '1.618': swing_high + 0.618 * fib_range,
                '2.000': swing_high + 1.0 * fib_range,
                '2.618': swing_high + 1.618 * fib_range}

        return {k: round(v, 2) for k, v in exts.items()}

    def pivot_points_classic(self):
        """Classic pivot points (PP, R1-R3, S1-S3)."""
        high_1d = float(self.h[-1]) if self.n > 0 else 0
        low_1d = float(self.l[-1]) if self.n > 0 else 0
        close_1d = float(self.c[-1]) if self.n > 0 else 0

        pp = (high_1d + low_1d + close_1d) / 3
        r1 = 2 * pp - low_1d
        r2 = pp + (high_1d - low_1d)
        r3 = high_1d + 2 * (pp - low_1d)
        s1 = 2 * pp - high_1d
        s2 = pp - (high_1d - low_1d)
        s3 = low_1d - 2 * (high_1d - pp)

        return {
            'PP': round(pp, 2),
            'R1': round(r1, 2), 'R2': round(r2, 2), 'R3': round(r3, 2),
            'S1': round(s1, 2), 'S2': round(s2, 2), 'S3': round(s3, 2),
        }

    def levels_from_pivots(self, pivots_high, pivots_low):
        """Extract S/R levels from pivot points with clustering.
        Uses only pivots from the last 6 months for recency."""
        # Filter to last 6 months (approx 126 trading days)
        recent_threshold = max(0, self.n - 126)
        recent_highs = [p[1] for p in pivots_high if p[0] >= recent_threshold]
        recent_lows = [p[1] for p in pivots_low if p[0] >= recent_threshold]

        def cluster(values, threshold_pct=1.5):
            if not values:
                return []
            sorted_vals = sorted(values)
            clusters = [[sorted_vals[0]]]
            for v in sorted_vals[1:]:
                if abs(v - clusters[-1][0]) / clusters[-1][0] * 100 < threshold_pct:
                    clusters[-1].append(v)
                else:
                    clusters.append([v])
            result = []
            for c in clusters:
                avg = sum(c) / len(c)
                strength = 'Strong' if len(c) >= 3 else 'Moderate' if len(c) >= 2 else 'Weak'
                result.append({'price': round(avg, 2), 'strength': strength, 'touches': len(c)})
            return result

        resistance_levels = cluster(recent_highs)
        support_levels = cluster(recent_lows)

        cp = self.c[-1]
        for l in resistance_levels:
            l['distance_pct'] = round((l['price'] / cp - 1) * 100, 2)
        for l in support_levels:
            l['distance_pct'] = round((l['price'] / cp - 1) * 100, 2)

        # Separate into above/below current price
        resistance_above = [l for l in resistance_levels if l['price'] > cp]
        resistance_below = [l for l in resistance_levels if l['price'] <= cp]
        support_below = [l for l in support_levels if l['price'] < cp]
        support_above = [l for l in support_levels if l['price'] >= cp]

        # Resistance levels above price (sorted ascending)
        resistance_above.sort(key=lambda x: x['price'])
        # Support levels below price (sorted descending)
        support_below.sort(key=lambda x: x['price'], reverse=True)

        return {
            'resistance': resistance_above[-5:] if len(resistance_above) > 5 else resistance_above,
            'support': support_below[-5:] if len(support_below) > 5 else support_below,
            'flipped_resistance_below': sorted(resistance_below, key=lambda x: x['price'], reverse=True)[:3],
            'flipped_support_above': sorted(support_above, key=lambda x: x['price'])[:3],
        }

    def analyze(self, pivots_high, pivots_low):
        """Full level analysis."""
        fib_ret = self.fibonacci_retracement(pivots_high, pivots_low)
        fib_ext = self.fibonacci_extension(pivots_high, pivots_low)
        pivots = self.pivot_points_classic()
        sr = self.levels_from_pivots(pivots_high, pivots_low)
        return fib_ret, fib_ext, pivots, sr


# ────────────────────────────────────────────────────────────
# MODULE 4: Candlestick Detector
# ────────────────────────────────────────────────────────────

class CandlestickDetector:
    """Detects candlestick patterns on the last N candles."""

    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.o = df['Open'].values.astype(float)
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.c = df['Close'].values.astype(float)
        self.n = len(df)

    def _body(self, i): return abs(self.c[i] - self.o[i])
    def _upper_wick(self, i): return self.h[i] - max(self.c[i], self.o[i])
    def _lower_wick(self, i): return min(self.c[i], self.o[i]) - self.l[i]
    def _total_range(self, i): return self.h[i] - self.l[i]
    def _is_green(self, i): return self.c[i] >= self.o[i]
    def _is_red(self, i): return self.c[i] < self.o[i]

    def analyze_last(self, n_candles=5):
        """Analyze last n candles for patterns."""
        patterns = []
        for i in range(max(0, self.n - n_candles), self.n):
            if i < 1:
                continue
            candle = {}
            candle['index'] = i
            candle['date'] = str(self.df.index[i].date())
            candle['o'] = float(self.o[i])
            candle['h'] = float(self.h[i])
            candle['l'] = float(self.l[i])
            candle['c'] = float(self.c[i])
            candle['green'] = self._is_green(i)
            candle['body'] = round(self._body(i), 2)
            candle['upper_wick'] = round(self._upper_wick(i), 2)
            candle['lower_wick'] = round(self._lower_wick(i), 2)

            # Doji
            body_pct = self._body(i) / self._total_range(i) * 100 if self._total_range(i) > 0 else 100
            candle['doji'] = body_pct < 10

            # Marubozu
            candle['marubozu'] = self._upper_wick(i) < 0.05 * self._total_range(i) and self._lower_wick(i) < 0.05 * self._total_range(i)

            # Hammer / Hanging Man
            if not self._is_green(i):
                lw_pct = self._lower_wick(i) / self._total_range(i) * 100 if self._total_range(i) > 0 else 0
                uw_pct = self._upper_wick(i) / self._total_range(i) * 100 if self._total_range(i) > 0 else 0
                candle['hammer'] = lw_pct > 60 and body_pct < 30
                candle['shooting_star'] = uw_pct > 60 and body_pct < 30

            # Engulfing with previous
            if i > 0:
                prev_green = self._is_green(i - 1)
                prev_body = self._body(i - 1)
                candle['bullish_engulfing'] = self._is_green(i) and not prev_green and self.c[i] > self.o[i - 1] and self.o[i] < self.c[i - 1]
                candle['bearish_engulfing'] = not self._is_green(i) and prev_green and self.c[i] < self.o[i - 1] and self.o[i] > self.c[i - 1]

            patterns.append(candle)

        # Summary: last candle
        last = patterns[-1] if patterns else {}
        pattern_names = []
        if last.get('doji'): pattern_names.append('Doji')
        if last.get('hammer'): pattern_names.append('Hammer')
        if last.get('shooting_star'): pattern_names.append('Shooting Star')
        if last.get('marubozu'): pattern_names.append('Marubozu')
        if last.get('bullish_engulfing'): pattern_names.append('Bullish Engulfing')
        if last.get('bearish_engulfing'): pattern_names.append('Bearish Engulfing')

        return {
            'last_pattern': ', '.join(pattern_names) if pattern_names else 'None',
            'last_candle': last.get('green', True) and 'Bullish' or 'Bearish',
            'details': patterns,
        }


# ────────────────────────────────────────────────────────────
# MODULE 5: Divergence Finder
# ────────────────────────────────────────────────────────────

class DivergenceFinder:
    """Detects regular and hidden divergences: RSI, MACD, OBV."""

    def __init__(self, df: pd.DataFrame, rsi_full: np.ndarray, macd_line: np.ndarray,
                 hist: np.ndarray, obv_line: np.ndarray):
        self.df = df
        self.c = df['Close'].values.astype(float)
        self.rsi = rsi_full
        self.macd = macd_line
        self.hist = hist
        self.obv = obv_line

    def find_pivot_indices(self, arr: np.ndarray, window=5):
        """Find pivot indices in an array."""
        highs = []
        lows = []
        n = len(arr)
        for i in range(window, n - window):
            if not np.isnan(arr[i]):
                if all(arr[i] > arr[i - window:i]) and all(arr[i] >= arr[i + 1:i + window + 1]):
                    highs.append(i)
                if all(arr[i] < arr[i - window:i]) and all(arr[i] <= arr[i + 1:i + window + 1]):
                    lows.append(i)
        return highs, lows

    def detect_divergence(self, price_pivots_high, price_pivots_low, indicator_array, name):
        """Detect regular and hidden divergences."""
        divs = []
        ind_highs, ind_lows = self.find_pivot_indices(indicator_array)

        # Regular bearish divergence: price makes higher high, indicator makes lower high
        for ph in price_pivots_high[-3:]:
            for ih in ind_highs[-3:]:
                if abs(ph - ih) <= 3:  # within 3 bars
                    continue
                if ph > price_pivots_high[-4:-3][0] if len(price_pivots_high) > 3 else False:
                    # Check if indicator high is lower when price high is higher
                    pass  # Simplified: flag for known patterns

        # Simplified: compare last 2 pivots
        if len(price_pivots_high) >= 2 and len(ind_highs) >= 2:
            ph1 = price_pivots_high[-2]
            ph2 = price_pivots_high[-1]
            ih1 = ind_highs[-2]
            ih2 = ind_highs[-1]
            # Map to nearest price pivot
            if self.c[ph1] < self.c[ph2] and indicator_array[ih1] > indicator_array[ih2]:
                divs.append({'type': 'Regular Bearish', 'source': name,
                             'price_level': float(self.c[ph2]),
                             'indicator_level': float(indicator_array[ih2])})

        if len(price_pivots_low) >= 2 and len(ind_lows) >= 2:
            pl1 = price_pivots_low[-2]
            pl2 = price_pivots_low[-1]
            il1 = ind_lows[-2]
            il2 = ind_lows[-1]
            if self.c[pl1] > self.c[pl2] and indicator_array[il1] < indicator_array[il2]:
                divs.append({'type': 'Regular Bullish', 'source': name,
                             'price_level': float(self.c[pl2]),
                             'indicator_level': float(indicator_array[il2])})

        return divs

    def analyze(self):
        """Detect all divergences."""
        # Price pivots
        price_highs, price_lows = self.find_pivot_indices(self.c)

        all_divs = []
        all_divs.extend(self.detect_divergence(price_highs, price_lows, self.rsi, 'RSI'))
        all_divs.extend(self.detect_divergence(price_highs, price_lows, self.macd, 'MACD'))
        all_divs.extend(self.detect_divergence(price_highs, price_lows, self.obv, 'OBV'))

        return all_divs


# ────────────────────────────────────────────────────────────
# MODULE 6: MTF Analyzer
# ────────────────────────────────────────────────────────────

class MTFAnalyzer:
    """Multi-Timeframe Analysis — Daily, Weekly, Monthly."""

    def __init__(self, df: pd.DataFrame):
        self.df = df

    def _calculate(self, series: np.ndarray):
        """Compute RSI(14) and MACD for a series."""
        n = len(series)
        if n < 26:
            return {'rsi': None, 'macd_crossover': None}

        # RSI
        delta = np.diff(series)
        gain = np.where(delta > 0, delta, 0)
        loss = np.where(delta < 0, -delta, 0)
        avg_gain = pd.Series(gain).rolling(14).mean().values[-1]
        avg_loss = pd.Series(loss).rolling(14).mean().values[-1]
        rs = avg_gain / avg_loss if avg_loss != 0 else 100
        rsi = 100 - (100 / (1 + rs))

        # MACD
        ema12 = pd.Series(series).ewm(span=12).mean().values[-1]
        ema26 = pd.Series(series).ewm(span=26).mean().values[-1]
        macd_v = ema12 - ema26
        macd_series = pd.Series(series).ewm(span=12).mean().values - pd.Series(series).ewm(span=26).mean().values
        sig = pd.Series(macd_series).ewm(span=9).mean().values[-1] if len(macd_series) > 0 else 0

        return {
            'rsi': round(rsi, 1),
            'macd_crossover': 'Bullish' if macd_v > sig else 'Bearish',
            'macd': round(macd_v, 2),
            'signal': round(sig, 2),
        }

    def analyze(self):
        """Analyze weekly, monthly, and daily timeframes."""
        weekly = self.df.resample('W').agg({'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'})
        monthly = self.df.resample('ME').agg({'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'})

        result = {
            'daily': self._calculate(self.df['Close'].values),
            'weekly': self._calculate(weekly['Close'].values),
            'monthly': self._calculate(monthly['Close'].values),
        }
        return result, weekly, monthly


# ────────────────────────────────────────────────────────────
# MODULE 7: Wyckoff/ICT Analyzer
# ────────────────────────────────────────────────────────────

class WyckoffICTAnalyzer:
    """
    Algorithmic Wyckoff / ICT analysis:
    - Order Blocks (OB)
    - Fair Value Gaps (FVG)
    - Liquidity Sweeps
    - Springs / Upthrusts
    - Wyckoff Phase detection
    """

    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.o = df['Open'].values.astype(float)
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.c = df['Close'].values.astype(float)
        self.v = df['Volume'].values.astype(float)
        self.n = len(df)

    def find_order_blocks(self):
        """
        Bullish OB: last bearish candle before a 3+ candle rally.
        Bearish OB: last bullish candle before a 3+ candle decline.
        """
        obs = []
        i = 1
        while i < self.n - 3:
            # Bullish OB: red candle followed by 3 consecutive greens
            if not (self.c[i] >= self.o[i]) and self._is_green(i + 1) and self._is_green(i + 2) and self._is_green(i + 3):
                obs.append({
                    'type': 'Bullish OB',
                    'index': i,
                    'date': str(self.df.index[i].date()),
                    'price': float(self.l[i]),
                    'body_high': float(self.o[i]),
                    'body_low': float(self.c[i]),
                    'strength': 'Strong' if self.v[i] > pd.Series(self.v).rolling(20).mean().values[i] else 'Moderate',
                })
                i += 4
                continue
            # Bearish OB: green candle followed by 3 consecutive reds
            if (self.c[i] >= self.o[i]) and not self._is_green(i + 1) and not self._is_green(i + 2) and not self._is_green(i + 3):
                obs.append({
                    'type': 'Bearish OB',
                    'index': i,
                    'date': str(self.df.index[i].date()),
                    'price': float(self.h[i]),
                    'body_high': float(self.c[i]),
                    'body_low': float(self.o[i]),
                    'strength': 'Strong' if self.v[i] > pd.Series(self.v).rolling(20).mean().values[i] else 'Moderate',
                })
                i += 4
                continue
            i += 1
        return obs

    def find_fair_value_gaps(self):
        """
        Bullish FVG: candle A high < candle C low (gap up).
        Bearish FVG: candle A low > candle C high (gap down).
        """
        fvgs = []
        for i in range(self.n - 2):
            # Bullish FVG: A's high < C's low
            if self.h[i] < self.l[i + 2]:
                fvgs.append({
                    'type': 'Bullish FVG',
                    'index': i + 1,
                    'date': str(self.df.index[i + 1].date()),
                    'gap_high': float(self.l[i + 2]),
                    'gap_low': float(self.h[i]),
                    'midpoint': round((self.l[i + 2] + self.h[i]) / 2, 2),
                    'size': round(self.l[i + 2] - self.h[i], 2),
                })
            # Bearish FVG: A's low > C's high
            if self.l[i] > self.h[i + 2]:
                fvgs.append({
                    'type': 'Bearish FVG',
                    'index': i + 1,
                    'date': str(self.df.index[i + 1].date()),
                    'gap_high': float(self.l[i]),
                    'gap_low': float(self.h[i + 2]),
                    'midpoint': round((self.l[i] + self.h[i + 2]) / 2, 2),
                    'size': round(self.l[i] - self.h[i + 2], 2),
                })
        return fvgs

    def find_liquidity_sweeps(self):
        """
        Liquidity sweep: price breaks a prior swing high/low by ≤2%
        then closes back within range (failed breakout).
        """
        sweeps = []
        # Find swing highs/lows
        window = 5
        swing_highs = []
        swing_lows = []
        for i in range(window, self.n - window):
            if all(self.h[i] > self.h[i - window:i]) and all(self.h[i] >= self.h[i + 1:i + window + 1]):
                swing_highs.append((i, float(self.h[i])))
            if all(self.l[i] < self.l[i - window:i]) and all(self.l[i] <= self.l[i + 1:i + window + 1]):
                swing_lows.append((i, float(self.l[i])))

        # Check for sweeps above swing highs (liquidity grab)
        for idx, val in swing_highs[-5:]:
            for j in range(idx + 1, min(idx + 10, self.n)):
                if self.h[j] > val * 1.002 and self.h[j] < val * 1.02:  # Break by 0.2% to 2%
                    if j < self.n - 1 and self.c[j + 1] < val:  # Closes back below
                        sweeps.append({
                            'type': 'Liquidity Sweep (High)',
                            'swing_index': idx,
                            'sweep_index': j,
                            'date': str(self.df.index[j].date()),
                            'level_breached': val,
                            'sweep_high': float(self.h[j]),
                            'close_back': float(self.c[j + 1]) if j + 1 < self.n else None,
                        })
                        break

        # Check for sweeps below swing lows
        for idx, val in swing_lows[-5:]:
            for j in range(idx + 1, min(idx + 10, self.n)):
                if self.l[j] < val * 0.998 and self.l[j] > val * 0.98:  # Break by 0.2% to 2%
                    if j < self.n - 1 and self.c[j + 1] > val:  # Closes back above
                        sweeps.append({
                            'type': 'Liquidity Sweep (Low)',
                            'swing_index': idx,
                            'sweep_index': j,
                            'date': str(self.df.index[j].date()),
                            'level_breached': val,
                            'sweep_low': float(self.l[j]),
                            'close_back': float(self.c[j + 1]) if j + 1 < self.n else None,
                        })
                        break

        return sweeps, swing_highs, swing_lows

    def find_springs_upthrusts(self, support_levels=None, resistance_levels=None):
        """Identify Wyckoff Springs and Upthrusts."""
        patterns = []
        # Spring: price breaks below S/R support, then reverses back above
        for sl in (support_levels or []):
            for i in range(max(1, self.n - 30), self.n):
                if self.l[i] < sl * 0.995 and self.l[i] > sl * 0.97:
                    if i < self.n - 1 and self.c[i + 1] > sl:
                        patterns.append({
                            'type': 'Spring',
                            'index': i,
                            'date': str(self.df.index[i].date()),
                            'level': sl,
                            'low': float(self.l[i]),
                            'close_next': float(self.c[i + 1]) if i + 1 < self.n else None,
                        })
                        break

        # Upthrust: price breaks above S/R resistance, then reverses back below
        for rl in (resistance_levels or []):
            for i in range(max(1, self.n - 30), self.n):
                if self.h[i] > rl * 1.005 and self.h[i] < rl * 1.03:
                    if i < self.n - 1 and self.c[i + 1] < rl:
                        patterns.append({
                            'type': 'Upthrust',
                            'index': i,
                            'date': str(self.df.index[i].date()),
                            'level': rl,
                            'high': float(self.h[i]),
                            'close_next': float(self.c[i + 1]) if i + 1 < self.n else None,
                        })
                        break

        return patterns

    def wyckoff_phase(self):
        """Detect Wyckoff accumulation/distribution phases."""
        recent = self.df.tail(60)
        if len(recent) < 30:
            return {'phase': 'Unknown', 'confidence': 0}

        vol = recent['Volume'].values
        close = recent['Close'].values
        high = recent['High'].values
        low = recent['Low'].values

        # A: Accumulation — tight range after selling climax, decreasing volume
        vol_trend = (vol[-5:].mean() - vol[:5].mean()) / vol[:5].mean() * 100 if vol[:5].mean() else 0
        price_range = (high.max() - low.min()) / low.min() * 100
        price_trend = (close[-1] - close[0]) / close[0] * 100

        if price_trend > 8 and vol_trend > 10:
            phase = 'Markup'
            conf = 75
        elif price_trend < -8 and vol_trend > 10:
            phase = 'Markdown'
            conf = 75
        elif price_range < 25 and vol_trend < -15 and price_trend > -5:
            phase = 'Accumulation'
            conf = 65
        elif price_range < 25 and vol_trend > 15 and price_trend < 5:
            phase = 'Distribution'
            conf = 65
        elif price_trend > 5 and vol_trend < -10:
            phase = 'Markup (vol drying)'
            conf = 55
        elif price_trend < -5 and vol_trend < -10:
            phase = 'Markdown (vol drying)'
            conf = 55
        else:
            phase = 'Ranging / Unknown'
            conf = 40

        return {'phase': phase, 'confidence': conf, 'vol_trend_pct': round(vol_trend, 1),
                'price_trend_pct': round(price_trend, 1), 'range_pct': round(price_range, 1)}

    def _is_green(self, i): return i < self.n and self.c[i] >= self.o[i]

    def analyze(self, support_levels=None, resistance_levels=None):
        """Full Wyckoff/ICT analysis."""
        obs = self.find_order_blocks()
        fvgs = self.find_fair_value_gaps()
        sweeps, swing_highs, swing_lows = self.find_liquidity_sweeps()
        springs = self.find_springs_upthrusts(support_levels, resistance_levels)
        phase = self.wyckoff_phase()

        return {
            'order_blocks': obs,
            'fair_value_gaps': fvgs,
            'liquidity_sweeps': sweeps,
            'springs_upthrusts': springs,
            'wyckoff_phase': phase,
        }, obs, fvgs, sweeps


# ────────────────────────────────────────────────────────────
# MODULE 8: Gann/Cycle Analyzer
# ────────────────────────────────────────────────────────────

class GannCycler:
    """
    Gann analysis:
    - Gann Fan lines from pivot
    - Dominant cycle detection via FFT
    - Square of 9 levels
    """

    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.c = df['Close'].values.astype(float)
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.n = len(df)

    def gann_fan(self, pivot_idx: int, pivot_price: float, lookahead: int = 60):
        """
        Gann Fan: 1x1 (45°), 1x2, 2x1, 1x3, 3x1, 1x4, 4x1.
        Grid size = (price range) / (time range) for scaling.
        """
        lines = []
        end_idx = min(self.n - 1, pivot_idx + lookahead)
        if end_idx <= pivot_idx:
            return lines

        # Calculate time and price unit
        dx = end_idx - pivot_idx
        dy = abs(self.h[end_idx] - self.l[pivot_idx])
        unit = dy / dx if dx > 0 else 1

        angles = {
            '1x1 (45°)': 1.0, '2x1': 0.5, '1x2': 2.0,
            '3x1': 0.333, '1x3': 3.0, '4x1': 0.25, '1x4': 4.0,
        }
        for name, slope in angles.items():
            end_price = pivot_price + dy * slope if self.c[-1] > pivot_price else pivot_price - dy * slope
            lines.append({
                'name': name,
                'pivot_idx': pivot_idx,
                'pivot_price': pivot_price,
                'slope': slope,
                'end_price': round(end_price, 2),
            })

        return lines

    def dominant_cycles(self):
        """Find dominant cycle lengths using FFT and autocorrelation."""
        if self.n < 50:
            return {}

        # Detrend the price
        detrended = self.c - pd.Series(self.c).rolling(20).mean().values
        detrended = detrended[~np.isnan(detrended)]

        if len(detrended) < 30:
            return {}

        # FFT
        fft = np.fft.fft(detrended)
        freqs = np.fft.fftfreq(len(detrended))
        magnitudes = np.abs(fft)
        # Find dominant frequencies (exclude DC)
        valid = freqs > 0
        if np.any(valid):
            dominant_freq = freqs[valid][np.argmax(magnitudes[valid])]
            period_fft = int(1 / dominant_freq) if dominant_freq > 0 else 0
        else:
            period_fft = 0

        # Autocorrelation
        autocorr = pd.Series(detrended).autocorr()
        # Find peaks in autocorrelation
        corr_vals = [pd.Series(detrended).autocorr(lag=l) for l in range(1, min(60, len(detrended) // 2))]
        if corr_vals:
            peak_lag = np.argmax(np.abs(corr_vals)) + 1
        else:
            peak_lag = 0

        return {
            'fft_dominant_period': int(period_fft) if period_fft > 0 else None,
            'autocorr_peak_lag': peak_lag,
            'cycles_detected': bool(period_fft > 0 or peak_lag > 0),
        }

    def square_of_9(self, pivot_price: float):
        """Gann Square of 9 levels from a pivot."""
        if pivot_price <= 0:
            return {}

        levels = {}
        # Core formula: convert price to Gann number
        def gann_sq9(price, increment):
            root = np.sqrt(price)
            return (round(root) + increment) ** 2

        for inc in range(-8, 9):
            level = gann_sq9(pivot_price, inc)
            if level > 0:
                levels[f'{inc:+d}'] = round(level, 2)

        return levels

    def analyze(self):
        """Full Gann/Cycle analysis."""
        # Find best pivot (last significant swing)
        pivots_h = []
        pivots_l = []
        window = 5
        for i in range(window, self.n - window):
            if all(self.h[i] > self.h[i - window:i]) and all(self.h[i] >= self.h[i + 1:i + window + 1]):
                pivots_h.append((i, float(self.h[i])))
            if all(self.l[i] < self.l[i - window:i]) and all(self.l[i] <= self.l[i + 1:i + window + 1]):
                pivots_l.append((i, float(self.l[i])))

        # Use the most recent significant pivot for Gann Fan
        fan_lines = []
        cycles = self.dominant_cycles()
        sq9 = {}
        best_pivot = None

        if pivots_h or pivots_l:
            # Choose the nearer pivot (closer to price)
            cp = self.c[-1]
            best_dist = float('inf')

            for p in pivots_h[-3:] + pivots_l[-3:]:
                dist = abs(cp - p[1])
                if dist < best_dist:
                    best_dist = dist
                    best_pivot = p

            if best_pivot:
                fan_lines = self.gann_fan(best_pivot[0], best_pivot[1])
                sq9 = self.square_of_9(best_pivot[1])

        return {
            'gann_fan': fan_lines,
            'cycles': cycles,
            'square_of_9': sq9,
            'pivot_used': best_pivot,
        }, fan_lines


# ────────────────────────────────────────────────────────────
# MODULE 9: Options Strategist
# ────────────────────────────────────────────────────────────

class OptionsStrategist:
    """
    Options analysis:
    - Fetch options chain
    - Compute implied greeks
    - Map market view to option strategy
    """

    def __init__(self, ticker, df: pd.DataFrame):
        self.ticker = ticker
        self.df = df
        self.c = df['Close'].values.astype(float)
        self.current_price = float(self.c[-1])
        self.rf_rate = 0.065  # India 10Y ~6.5%, adjust as needed

    @staticmethod
    def _d1(S, K, T, r, sigma):
        if sigma <= 0 or T <= 0:
            return 0
        return (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))

    @staticmethod
    def _black_scholes(S, K, T, r, sigma, option_type='call'):
        """Calculate option price and greeks."""
        if sigma <= 0 or T <= 0:
            return {'price': max(0, S - K if option_type == 'call' else K - S), 'delta': 0, 'gamma': 0, 'vega': 0, 'theta': 0}

        d1 = OptionsStrategist._d1(S, K, T, r, sigma)
        d2 = d1 - sigma * np.sqrt(T)

        if option_type == 'call':
            price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
            delta = norm.cdf(d1)
            theta = (-S * norm.pdf(d1) * sigma / (2 * np.sqrt(T)) - r * K * np.exp(-r * T) * norm.cdf(d2)) / 365
        else:
            price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
            delta = -norm.cdf(-d1)
            theta = (-S * norm.pdf(d1) * sigma / (2 * np.sqrt(T)) + r * K * np.exp(-r * T) * norm.cdf(-d2)) / 365

        gamma = norm.pdf(d1) / (S * sigma * np.sqrt(T))
        vega = S * norm.pdf(d1) * np.sqrt(T) / 100

        return {'price': round(price, 2), 'delta': round(delta, 4), 'gamma': round(gamma, 6),
                'vega': round(vega, 4), 'theta': round(theta, 4)}

    def fetch_and_analyze(self, signal: str = 'HOLD'):
        """Fetch options chain and map to strategies."""
        try:
            tk = yf.Ticker(self.ticker if not self.ticker.endswith('.NS') else self.ticker)
            # Get expirations
            expirations = tk.options
            if not expirations:
                return {'status': 'No options data available'}

            # Use nearest weekly expiry
            expiry = expirations[0]
            chain = tk.option_chain(expiry)

            if chain.calls.empty and chain.puts.empty:
                return {'status': 'Empty options chain'}

            # Estimate IV from ATM options
            atm_strike = round(self.current_price / 5) * 5  # Round to nearest 5

            # Find ATM call and put
            calls = chain.calls
            puts = chain.puts
            atm_call = calls.iloc[(calls['strike'] - self.current_price).abs().argsort()[:1]]
            atm_put = puts.iloc[(puts['strike'] - self.current_price).abs().argsort()[:1]]

            iv = None
            if not atm_call.empty and 'impliedVolatility' in atm_call.columns:
                call_iv = atm_call['impliedVolatility'].values[0]
                put_iv = atm_put['impliedVolatility'].values[0] if not atm_put.empty else call_iv
                iv = (call_iv + put_iv) / 2 if put_iv else call_iv

            if iv is None or np.isnan(iv) or iv == 0:
                iv = 0.25  # Default fallback

            # Compute days to expiry
            exp_date = datetime.strptime(expiry, '%Y-%m-%d')
            dte = max((exp_date - datetime.now()).days, 1)
            T = dte / 365.0

            # Compute historical volatility (30d)
            returns = np.diff(np.log(self.c[-31:])) if len(self.c) > 31 else np.diff(np.log(self.c))
            hist_vol = float(np.std(returns) * np.sqrt(252)) if len(returns) > 0 else 0.25

            # Greeks for ATM strikes
            call_greeks = self._black_scholes(self.current_price, self.current_price, T, self.rf_rate, iv, 'call')
            put_greeks = self._black_scholes(self.current_price, self.current_price, T, self.rf_rate, iv, 'put')

            # Strategy mapping based on signal
            strategies = self._map_strategies(signal, iv)

            return {
                'status': 'OK',
                'expiry': expiry,
                'dte': dte,
                'iv': round(iv * 100, 1),
                'hv': round(hist_vol * 100, 1),
                'iv_rank': 'High' if iv > hist_vol * 1.2 else 'Low' if iv < hist_vol * 0.8 else 'Normal',
                'atm_call': call_greeks,
                'atm_put': put_greeks,
                'strategies': strategies,
            }

        except Exception as e:
            log.warning(f"Options data error: {e}")
            return {'status': f'Error: {e}'}

    def _map_strategies(self, signal: str, iv: float):
        """Map trading signal to option strategies."""
        strategies = []
        S = self.current_price
        T = 30 / 365  # ~30 DTE

        if signal == 'BUY' or signal == 'CAUTIOUS BUY':
            strategies.append({
                'name': 'Bull Call Spread',
                'description': f'Buy ATM Call, sell OTM Call 10% above',
                'buy_strike': round(S / 5) * 5,
                'sell_strike': round(S * 1.1 / 5) * 5,
                'max_loss': 'Net premium paid',
                'max_profit': f'{(round(S*1.1/5)*5 - round(S/5)*5):.0f} - premium',
                'break_even': f'ATM strike + premium',
                'delta_neutral': False,
            })
            strategies.append({
                'name': 'Call Option (Long)',
                'description': 'Outright call purchase for directional bet',
                'delta': round(norm.cdf(self._d1(S, S, T, self.rf_rate, iv)), 2),
            })

        elif signal == 'SELL' or signal == 'CAUTIOUS SELL':
            strategies.append({
                'name': 'Bear Put Spread',
                'description': f'Buy ATM Put, sell OTM Put 10% below',
                'buy_strike': round(S / 5) * 5,
                'sell_strike': round(S * 0.9 / 5) * 5,
                'max_loss': 'Net premium paid',
                'max_profit': f'{(round(S/5)*5 - round(S*0.9/5)*5):.0f} - premium',
            })
            strategies.append({
                'name': 'Put Option (Long)',
                'description': 'Outright put purchase for directional bet',
                'delta': round(-norm.cdf(-self._d1(S, S, T, self.rf_rate, iv)), 2),
            })

        if iv > 0.3:
            strategies.append({
                'name': 'Iron Condor',
                'description': 'Sell OTM call+put, buy further OTM wings. Best for low volatility expectation.',
                'short_call': round(S * 1.1 / 5) * 5,
                'short_put': round(S * 0.9 / 5) * 5,
                'long_call': round(S * 1.2 / 5) * 5,
                'long_put': round(S * 0.8 / 5) * 5,
                'max_profit': 'Net credit received',
                'max_loss': 'Wing width - credit',
            })
        else:
            strategies.append({
                'name': 'Long Straddle',
                'description': 'Buy ATM Call + Put. Best when expecting breakout.',
                'strike': round(S / 5) * 5,
                'cost': 'ATM Call premium + ATM Put premium',
                'breakevens': f'{round(S - (call_prem + put_prem)):.0f} / {round(S + (call_prem + put_prem)):.0f}',
            })

        return strategies


# ────────────────────────────────────────────────────────────
# MODULE 10: Fundamental Collector
# ────────────────────────────────────────────────────────────

class FundamentalAnalyzer:
    """
    Comprehensive 22-Section Fundamental Analysis Engine.

    Sources:
      - yfinance info dict
      - yfinance financials, balance_sheet, cashflow
      - yfinance quarterly_financials
      - yfinance major_holders, institutional_holders, mutualfund_holders
      - yfinance dividends, splits, news (if available)
      - Computed ratios from raw statements

    Sections:
      01  Company Overview
      02  Business Quality & Moat
      03  Management & Governance
      04  Shareholding Pattern
      05  Profit & Loss Statement
      06  Balance Sheet
      07  Cash Flow Statement
      08  Financial Ratios
      09  Growth Metrics
      10  Earnings Analysis
      11  Dividend Analysis
      12  Valuation Analysis
      13  Industry & Peer Context
      14  Economic Sensitivity
      15  Risk Assessment
      16  Corporate Actions
      17  Quarterly Results Detail
      18  Annual Report Summary
      19  Conference Call / MD&A
      20  News & Sentiment
      21  Screening Score
      22  Investment Suitability
    """

    DEFAULT_MANUAL_FILE = "manual_data.json"

    MANUAL_SECTION_MAP = {
        'section_02_business_quality': ['moat_rating', 'moat_indicators', 'pricing_power',
                                         'competitive_advantage', 'revenue_concentration',
                                         'diversification', 'notes'],
        'section_03_management': ['promoter_holding_pct', 'promoter_pledge_pct',
                                   'board_members_count', 'avg_tenure', 'governance_score',
                                   'auditor', 'related_party_transactions', 'notes'],
        'section_04_shareholding': ['promoter_group_pct', 'fil_fii_pct', 'dii_mf_pct',
                                     'retail_others_pct', 'government_holding_pct',
                                     'pledged_pct', 'source_note'],
        'section_13_industry': ['peers_mentioned', 'industry_rank', 'market_cap_rank',
                                 'growth_relative_to_industry', 'notes'],
        'section_14_economic_sensitivity': ['notes'],
        'section_15_risk': ['risk_flags', 'notes'],
        'section_18_annual_report': ['business_summary', 'key_business_segments'],
        'section_19_conference_call': ['last_earnings_call', 'transcript',
                                        'management_outlook', 'md_and_a',
                                        'forward_guidance', 'notes'],
        'section_20_news': ['articles', 'sentiment'],
        'section_22_suitability': ['key_strengths', 'key_concerns', 'detail', 'notes'],
    }

    def __init__(self, ticker: str, manual_overrides: Optional[dict] = None,
                 now: Optional[datetime] = None):
        self.ticker = ticker
        self._t = yf.Ticker(ticker)
        self.info: dict = {}
        self.financials: pd.DataFrame = pd.DataFrame()
        self.balance_sheet: pd.DataFrame = pd.DataFrame()
        self.cashflow: pd.DataFrame = pd.DataFrame()
        self.q_financials: pd.DataFrame = pd.DataFrame()
        self._loaded = False
        self.manual_overrides = manual_overrides or {}
        self._overridden_fields: dict = {}  # section_name -> [field_names]
        # Determinism seam: when a frozen clock is supplied, all timestamps this
        # analyzer emits (cache TTL, saved_at, generated_at) use it instead of
        # the wall clock. Default None preserves live behaviour.
        self._now = now

    def _clock_now(self) -> datetime:
        return self._now if self._now is not None else datetime.now()

    # ────────────────────────────────────────────────────────────
    # MANUAL DATA OVERRIDE SYSTEM
    # ────────────────────────────────────────────────────────────
    @classmethod
    def load_manual_file(cls, filepath: str) -> dict:
        """Load manual fundamental overrides from a JSON file.

        Expected JSON structure (all keys optional):
        {
            "section_02_business_quality": {"moat_rating": "Wide Moat", ...},
            "section_03_management": {"promoter_pledge_pct": 0, "auditor": "...", ...},
            "section_04_shareholding": {"dii_mf_pct": 24.5, "pledged_pct": 0, ...},
            "section_13_industry": {"peers_mentioned": ["ICICIBANK.NS", ...], ...},
            "section_15_risk": {"risk_flags": [...], "notes": "..."},
            "section_19_conference_call": {"management_outlook": "...", ...},
            "section_20_news": {"sentiment": "Positive", ...},
            "section_22_suitability": {"key_strengths": [...], ...},
            ...
        }
        """
        try:
            if not os.path.isfile(filepath):
                log.warning(f"Manual data file not found: {filepath}")
                return {}
            with open(filepath, 'r') as f:
                data = json.load(f)
            if not isinstance(data, dict):
                log.warning("Manual data file must contain a JSON object")
                return {}
            log.info(f"Loaded manual overrides from {filepath} ({len(data)} sections)")
            return data
        except (json.JSONDecodeError, OSError) as e:
            log.warning(f"Failed to load manual data file: {e}")
            return {}

    def _merge_manual(self, section_data: dict, section_key: str) -> dict:
        """Merge manual overrides into auto-fetched section data.

        For each field in the manual override dict that matches the section,
        the manual value replaces the auto value. Tracks which fields
        were overridden and marks them in the output.
        """
        manual_for_section = self.manual_overrides.get(section_key, {})
        if not manual_for_section:
            return section_data

        merged = dict(section_data)  # shallow copy
        overrides_applied = []
        allowed = self.MANUAL_SECTION_MAP.get(section_key, [])

        for field_key, manual_val in manual_for_section.items():
            # Allow override only if field is in the allowed list (or wildcard)
            if allowed and field_key not in allowed:
                log.debug(f"  Skipping manual field '{field_key}' — not in allowed list for {section_key}")
                continue

            # Handle None specifically: keeps auto value
            if manual_val is None:
                continue

            merged[field_key] = manual_val
            merged[f'{field_key}_source'] = 'manual_override'
            overrides_applied.append(field_key)

        if overrides_applied:
            self._overridden_fields[section_key] = overrides_applied
            merged['_manual_overrides_count'] = len(overrides_applied)
            log.info(f"  ✓ Applied {len(overrides_applied)} manual override(s) to {section_key}: {', '.join(overrides_applied)}")

        return merged

    # ────────────────────────────────────────────────────────────
    # HELPERS
    # ────────────────────────────────────────────────────────────
    def _scrub(self, d: dict) -> dict:
        """Remove None/NaN values, round floats."""
        out = {}
        for k, v in d.items():
            if v is None or (isinstance(v, float) and np.isnan(v)):
                continue
            if isinstance(v, float):
                out[k] = round(v, 4)
            elif isinstance(v, np.floating):
                out[k] = round(float(v), 4)
            elif isinstance(v, np.integer):
                out[k] = int(v)
            elif isinstance(v, (int, str, bool)):
                out[k] = v
            elif isinstance(v, dict):
                out[k] = self._scrub(v)
            elif isinstance(v, list):
                # Keep dicts as dicts, convert other non-scalars to string
                cleaned_list = []
                for x in v[:10]:
                    if isinstance(x, (int, float, str, bool)):
                        cleaned_list.append(x)
                    elif isinstance(x, dict):
                        cleaned_list.append(self._scrub(x))
                    else:
                        cleaned_list.append(str(x)[:200])
                out[k] = cleaned_list
            else:
                out[k] = str(v)[:200]
        return out

    def _crore(self, val) -> str:
        """Format a value in INR crores."""
        if val is None:
            return 'N/A'
        try:
            v = float(val)
            return f'₹{v/1e7:,.2f} Cr'
        except (TypeError, ValueError):
            return str(val)

    def _percent(self, val) -> str:
        if val is None:
            return 'N/A'
        try:
            v = float(val)
            if math.isnan(v) or math.isinf(v):
                return 'N/A'
            return f'{v*100:.2f}%' if abs(v) < 1 else f'{v:.2f}%'
        except (TypeError, ValueError):
            return str(val)

    def _ratio(self, val) -> str:
        if val is None:
            return 'N/A'
        try:
            v = float(val)
            if math.isnan(v) or math.isinf(v):
                return 'N/A'
            return f'{v:.2f}'
        except (TypeError, ValueError):
            return str(val)

    def _is_bank(self) -> bool:
        """Return True only when the stock is actually a bank.

        yfinance sector/industry strings are used to avoid mislabelling
        non-bank financials (e.g. defense PSUs) as RBI-regulated banks.
        """
        sector = str(self.info.get('sector', '')).lower()
        industry = str(self.info.get('industry', '')).lower()
        if 'financial services' not in sector:
            return False
        bank_keywords = ('banks', 'regional banks', 'money center banks', 'bank - diversified')
        return any(kw in industry for kw in bank_keywords)

    def _dividend_yield(self) -> str:
        """Compute dividend yield robustly.

        yfinance returns `dividendYield` inconsistently: a fraction (0.0061)
        for some stocks and an already-percent value (0.61) for others.
        Prefer dividendRate / currentPrice when both are present.
        """
        i = self.info
        # Preferred: dividendRate / currentPrice * 100
        rate = i.get('dividendRate', None)
        price = i.get('currentPrice', None)
        if rate is not None and price is not None:
            try:
                r = float(rate)
                p = float(price)
                if p > 0 and not math.isnan(r) and not math.isinf(r):
                    return f'{r / p * 100:.2f}%'
            except (TypeError, ValueError):
                pass
        # Fallback: raw dividendYield (fraction vs already-percent)
        raw = i.get('dividendYield', None)
        if raw is None:
            return 'N/A'
        try:
            v = float(raw)
            if math.isnan(v) or math.isinf(v):
                return 'N/A'
            if v > 0.5:
                # Already expressed as a percentage (e.g. 0.61 -> 0.61%)
                return f'{v:.2f}%'
            return f'{v * 100:.2f}%'
        except (TypeError, ValueError):
            return str(raw)

    def _debt_to_equity(self) -> str:
        """Normalize yfinance `debtToEquity` to a ratio string.

        yfinance returns this inconsistently: a ratio (0.27) for some stocks
        and an already-percent value (36.65 -> 36.65%) for others. Values
        above 1 are treated as percent and converted to a ratio.
        """
        raw = self.info.get('debtToEquity', None)
        if raw is None:
            return 'N/A'
        try:
            v = float(raw)
            if math.isnan(v) or math.isinf(v):
                return 'N/A'
            if abs(v) > 1:
                v = v / 100.0
            return f'{v:.2f}'
        except (TypeError, ValueError):
            return str(raw)

    def _get_roe(self) -> Optional[float]:
        """Return ROE as a fraction (0.15 = 15%), with a financials fallback.

        yfinance `info` frequently omits `returnOnEquity` for Indian stocks,
        so compute it from the financials/balance-sheet when missing:
        ROE = Net Income Common Stockholders / Stockholders Equity.
        """
        roe = self.info.get('returnOnEquity', None)
        if roe is not None:
            try:
                v = float(roe)
                if not math.isnan(v) and not math.isinf(v):
                    return v
            except (TypeError, ValueError):
                pass
        try:
            fs = self.financials
            bs = self.balance_sheet
            if fs is not None and not fs.empty and bs is not None and not bs.empty:
                if 'Net Income Common Stockholders' in fs.index and 'Stockholders Equity' in bs.index:
                    ni = float(fs.loc['Net Income Common Stockholders'].iloc[0])
                    eq = float(bs.loc['Stockholders Equity'].iloc[0])
                    if eq != 0 and not math.isnan(ni) and not math.isnan(eq):
                        return ni / eq
        except Exception:
            pass
        return None

    def _fetch_safe(self, attr: str):
        """Fetch a yfinance attribute with error handling."""
        try:
            obj = getattr(self._t, attr, None)
            if isinstance(obj, pd.DataFrame) and not obj.empty:
                return obj
            if isinstance(obj, pd.Series) and not obj.empty:
                return obj
            if isinstance(obj, list) and len(obj) > 0:
                return obj
        except Exception:
            pass
        return pd.DataFrame() if attr not in ('dividends', 'splits') else pd.Series(dtype=float)

    def _sec_val(self, section: dict, key: str, year: str) -> str:
        """Safely read a year value from a section field that may be a dict or 'N/A' string."""
        v = section.get(key, 'N/A')
        if isinstance(v, dict):
            return v.get(year, 'N/A')
        return v

    # ────────────────────────────────────────────────────────────
    # SECTION 01 - COMPANY OVERVIEW
    # ────────────────────────────────────────────────────────────
    def _section_company_overview(self) -> dict:
        i = self.info
        return self._scrub({
            'company_name': i.get('longName', i.get('shortName', self.ticker)),
            'ticker': self.ticker,
            'sector': i.get('sector', 'N/A'),
            'industry': i.get('industry', 'N/A'),
            'country': i.get('country', 'N/A'),
            'city': i.get('city', 'N/A'),
            'address': f"{i.get('address1', '')}, {i.get('address2', '')}".strip(', '),
            'website': i.get('website', 'N/A'),
            'phone': i.get('phone', 'N/A'),
            'zip': i.get('zip', 'N/A'),
            'full_time_employees': i.get('fullTimeEmployees', 'N/A'),
            'exchange': i.get('fullExchangeName', i.get('exchange', 'N/A')),
            'currency': i.get('currency', 'INR'),
            'business_summary': i.get('longBusinessSummary', 'Not available.')[:500],
            'fiscal_year_end': self._timestamp_str(i.get('lastFiscalYearEnd')),
            'is_esg_populated': i.get('esgPopulated', False),
        })

    @staticmethod
    def _timestamp_str(ts):
        if ts is None:
            return 'N/A'
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts, tz=None).strftime('%Y-%m-%d')
        return str(ts)[:10]

    # ────────────────────────────────────────────────────────────
    # SECTION 02 - BUSINESS QUALITY & MOAT
    # ────────────────────────────────────────────────────────────
    def _section_business_quality(self) -> dict:
        i = self.info
        summary = i.get('longBusinessSummary', '')
        # Derive moat indicators from data
        roe = i.get('returnOnEquity', None)
        roa = i.get('returnOnAssets', None)
        pm = i.get('profitMargins', None)
        opm = i.get('operatingMargins', None)
        employees = i.get('fullTimeEmployees', 0)
        market_cap = i.get('marketCap', 0)
        rev = i.get('totalRevenue', 0)
        has_moat = 'HDFC' in summary or 'largest' in summary.lower() or 'leading' in summary.lower()
        moat_indicators = []
        if market_cap and market_cap > 1e11:
            moat_indicators.append(f'Large-cap (₹{market_cap/1e7:,.0f} Cr)')
        if roe and roe > 0.12:
            moat_indicators.append(f'High ROE ({roe*100:.1f}%)')
        if pm and pm > 0.15:
            moat_indicators.append(f'Strong margins ({pm*100:.1f}%)')
        if employees and employees > 50000:
            moat_indicators.append('Extensive branch/employee network')
        if has_moat:
            moat_indicators.append('Industry leadership implied in business summary')
        return self._scrub({
            'moat_rating': 'Wide Moat' if len(moat_indicators) >= 3 else 'Narrow Moat' if moat_indicators else 'No Clear Moat',
            'moat_indicators': moat_indicators if moat_indicators else ['Requires manual research'],
            'pricing_power': self._infer_pricing_power(i),
            'competitive_advantage': self._infer_competitive_advantage(i),
            'revenue_concentration': self._infer_revenue_concentration(i),
            'diversification': self._infer_diversification(i),
            'business_model_type': self._infer_business_model(i),
            'geographic_presence': self._infer_geography(summary),
            'notes': 'Analysis based on quantitative data. Full qualitative moat assessment requires manual research.',
        })

    def _infer_pricing_power(self, i) -> str:
        if i.get('profitMargins', 0) and i['profitMargins'] > 0.25:
            return 'Strong (high margins)'
        elif i.get('profitMargins', 0) and i['profitMargins'] > 0.15:
            return 'Moderate'
        return 'Requires manual research'

    def _infer_competitive_advantage(self, i) -> str:
        summary = i.get('longBusinessSummary', '').lower()
        if 'largest' in summary or 'leading' in summary or 'market leader' in summary:
            return 'Market leader in segment'
        if i.get('marketCap', 0) > 1e12:
            return 'Large-cap dominance'
        return 'Requires manual research'

    def _infer_revenue_concentration(self, i) -> str:
        summary = i.get('longBusinessSummary', '').lower()
        if 'diversified' in summary:
            return 'Diversified across segments'
        if 'only' in summary or 'primarily' in summary:
            return 'Concentrated in primary business'
        return 'Requires manual research'

    def _infer_diversification(self, i) -> str:
        summary = i.get('longBusinessSummary', '').lower()
        segments = ['retail', 'wholesale', 'treasury', 'insurance', 'rural', 'corporate']
        found = [s for s in segments if s in summary]
        if len(found) >= 3:
            return f'Well-diversified across {len(found)} segments'
        return f'Limited diversification data ({len(found)} segments identified)'

    def _infer_business_model(self, i) -> str:
        sector = i.get('sector', '').lower()
        industry = i.get('industry', '').lower()
        if 'bank' in industry or 'bank' in sector:
            return 'Banking (Net Interest Income + Fee Income)'
        if 'insurance' in industry:
            return 'Insurance (Premium + Investment Income)'
        return f'{i.get("industry", "N/A")} business model'

    def _infer_geography(self, summary: str) -> str:
        countries = ['India', 'Bahrain', 'Hong Kong', 'Singapore', 'Dubai', 'US', 'UK']
        found = [c for c in countries if c in summary]
        return ', '.join(found) if found else 'Primarily domestic (India)'

    # ────────────────────────────────────────────────────────────
    # SECTION 03 - MANAGEMENT & GOVERNANCE
    # ────────────────────────────────────────────────────────────
    def _section_management(self) -> dict:
        i = self.info
        officers = i.get('companyOfficers', [])
        officer_list = []
        for off in officers[:10]:
            if isinstance(off, dict):
                name = off.get('name', off.get('title', 'Unknown'))
                title = off.get('title', off.get('name', ''))
                age = off.get('age', None)
                yearBorn = off.get('yearBorn', None)
                officer_list.append({
                    'name': name if name != title else title,
                    'title': title if title != name else '',
                    'age': age,
                    'year_born': yearBorn,
                })
        insiders = i.get('heldPercentInsiders', None)
        insider_pct = insiders * 100 if insiders else 0
        return self._scrub({
            'promoter_holding_pct': round(insider_pct, 2) if insiders else 'Check shareholding pattern',
            'promoter_pledge_pct': 'Not available via yfinance',
            'insider_holding_pct': round(insider_pct, 2) if insiders else 0,
            'board_members_count': len(officers) if officers else 'N/A',
            'key_officers': officer_list[:5] if officer_list else ['Not available'],
            'avg_tenure': 'Requires manual research',
            'governance_score': 'Requires manual research (CRISIL/ICRA)',
            'auditor': 'Requires manual research',
            'related_party_transactions': 'Requires manual research',
            'compensation_info': i.get('compensationAsOfEpochDate', 'N/A'),
            'notes': 'Insider holding from yfinance. Pledge, governance score, auditor from annual report.',
        })

    # ────────────────────────────────────────────────────────────
    # SECTION 04 - SHAREHOLDING PATTERN
    # ────────────────────────────────────────────────────────────
    def _section_shareholding(self) -> dict:
        i = self.info
        major = self._fetch_safe('major_holders')
        inst = self._fetch_safe('institutional_holders')
        mf = self._fetch_safe('mutualfund_holders')

        insiders_pct = i.get('heldPercentInsiders', None)
        inst_pct = i.get('heldPercentInstitutions', None)
        inst_count = i.get('institutionsCount', None)
        float_pct = i.get('institutionsFloatPercentHeld', None)

        # Parse major holders breakdown
        major_dict = {}
        if not major.empty and len(major.columns) >= 2:
            for _, row in major.iterrows():
                try:
                    label = str(row.iloc[0])
                    val = str(row.iloc[1])
                    major_dict[label] = val
                except Exception:
                    pass

        return self._scrub({
            'promoter_group_pct': round(insiders_pct * 100, 2) if insiders_pct else 'N/A',
            'fil_fii_pct': round(inst_pct * 100, 2) if inst_pct else 'N/A',
            'dii_mf_pct': 'Not directly available from yfinance',
            'retail_others_pct': 'Computed as balance if promoter+FII+DII known',
            'government_holding_pct': 'Not available via yfinance',
            'pledged_pct': 'Not available via yfinance',
            'institution_count': int(inst_count) if inst_count else 'N/A',
            'institutional_float_pct': round(float_pct * 100, 2) if float_pct else 'N/A',
            'major_holders_breakdown': major_dict if major_dict else 'N/A',
            'top_institutional_holders': self._format_holders(inst),
            'top_mutual_fund_holders': self._format_holders(mf),
            'source_note': 'Shareholding data from yfinance (may be delayed). For Indian stocks, refer to latest BSE/NSE shareholding pattern filing.',
        })

    def _format_holders(self, df: pd.DataFrame) -> list:
        if df is None or df.empty:
            return ['Not available']
        rows = []
        for _, row in df.head(10).iterrows():
            try:
                row_dict = {}
                for col in df.columns:
                    row_dict[str(col)] = str(row[col])[:100]
                rows.append(row_dict)
            except Exception:
                pass
        return rows if rows else ['Not available']

    # ────────────────────────────────────────────────────────────
    # SECTION 05 - PROFIT & LOSS STATEMENT
    # ────────────────────────────────────────────────────────────
    def _section_pl(self) -> dict:
        fs = self.financials
        if fs.empty:
            return {'status': 'No P&L data available'}
        section = {'currency': 'INR Crores', 'source': 'yfinance annual financials'}
        # Key line items
        pl_items = {
            'total_revenue': 'Total Revenue',
            'operating_revenue': 'Operating Revenue',
            'interest_income': 'Interest Income',
            'interest_expense': 'Interest Expense',
            'net_interest_income': 'Net Interest Income',
            'total_expenses': None,
            'selling_general_admin': 'Selling General And Administration',
            'salaries_wages': 'Salaries And Wages',
            'depreciation': 'Depreciation And Amortization In Income Statement',
            'provisions': None,
            'operating_income': None,
            'pretax_income': 'Pretax Income',
            'tax_provision': 'Tax Provision',
            'net_income': 'Net Income Common Stockholders',
            'net_income_controlling': 'Net Income Including Noncontrolling Interests',
            'diluted_eps': 'Diluted EPS',
            'basic_eps': 'Basic EPS',
            'diluted_shares': 'Diluted Average Shares',
            'basic_shares': 'Basic Average Shares',
        }
        for label, yf_key in pl_items.items():
            if yf_key and yf_key in fs.index:
                row = fs.loc[yf_key]
                vals = {}
                for col in fs.columns:
                    try:
                        # EPS and shares should not be divided by 1e7
                        is_per_share = label in ('diluted_eps', 'basic_eps', 'diluted_shares', 'basic_shares')
                        val = float(row[col])
                        if not is_per_share:
                            val = val / 1e7  # to crores
                        vals[str(col)[:10]] = round(val, 2) if not isinstance(val, str) else val
                    except (TypeError, ValueError):
                        vals[str(col)[:10]] = str(row[col])
                section[label] = vals
            else:
                section[label] = 'N/A'

        # Compute operating income (Pretax + InterestExpense if available)
        if 'Pretax Income' in fs.index and 'Interest Expense' in fs.index:
            op_inc = {}
            for col in fs.columns:
                try:
                    pt = float(fs.loc['Pretax Income', col])
                    ie = float(fs.loc['Interest Expense', col])
                    op_inc[str(col)[:10]] = round((pt + ie) / 1e7, 2)
                except Exception:
                    op_inc[str(col)[:10]] = 'N/A'
            section['operating_income_est'] = op_inc

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 06 - BALANCE SHEET
    # ────────────────────────────────────────────────────────────
    def _section_balance_sheet(self) -> dict:
        bs = self.balance_sheet
        if bs.empty:
            return {'status': 'No Balance Sheet data available'}
        section = {'currency': 'INR Crores', 'source': 'yfinance annual balance sheet'}
        bs_items = {
            'total_assets': 'Total Assets',
            'total_liabilities': 'Total Liabilities Net Minority Interest',
            'stockholders_equity': 'Stockholders Equity',
            'total_equity': 'Total Equity Gross Minority Interest',
            'minority_interest': 'Minority Interest',
            'total_debt': 'Total Debt',
            'long_term_debt': 'Long Term Debt',
            'current_debt': 'Current Debt And Capital Lease Obligation',
            'cash_equivalents': 'Cash And Cash Equivalents',
            'accounts_receivable': 'Accounts Receivable',
            'net_ppe': 'Net PPE',
            'goodwill': 'Goodwill',
            'intangible_assets': 'Other Intangible Assets',
            'investments': 'Investments And Advances',
            'book_value_per_share': None,
            'net_debt': 'Net Debt',
            'tangible_book_value': 'Tangible Book Value',
            'retained_earnings': 'Retained Earnings',
            'common_stock': 'Common Stock',
        }
        for label, yf_key in bs_items.items():
            if yf_key and yf_key in bs.index:
                row = bs.loc[yf_key]
                vals = {}
                for col in bs.columns:
                    try:
                        vals[str(col)[:10]] = float(row[col]) / 1e7
                    except (TypeError, ValueError):
                        vals[str(col)[:10]] = str(row[col])
                section[label] = vals
            else:
                section[label] = 'N/A'

        # Compute book value per share
        if 'Stockholders Equity' in bs.index and 'Ordinary Shares Number' in bs.index:
            bvps = {}
            for col in bs.columns:
                try:
                    eq = float(bs.loc['Stockholders Equity', col])
                    sh = float(bs.loc['Ordinary Shares Number', col])
                    bvps[str(col)[:10]] = round(eq / sh, 2)
                except Exception:
                    pass
            section['book_value_per_share'] = bvps if bvps else 'N/A'

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 07 - CASH FLOW STATEMENT
    # ────────────────────────────────────────────────────────────
    def _section_cashflow(self) -> dict:
        cf = self.cashflow
        if cf.empty:
            return {'status': 'No Cash Flow data available'}
        section = {'currency': 'INR Crores', 'source': 'yfinance annual cashflow'}
        cf_items = {
            'operating_cashflow': 'Operating Cash Flow',
            'investing_cashflow': 'Investing Cash Flow',
            'financing_cashflow': 'Financing Cash Flow',
            'free_cashflow': 'Free Cash Flow',
            'capital_expenditure': 'Capital Expenditure',
            'dividends_paid': 'Cash Dividends Paid',
            'repurchase_of_stock': 'Repurchase Of Capital Stock',
            'issuance_of_debt': 'Issuance Of Debt',
            'repayment_of_debt': 'Repayment Of Debt',
            'net_income_start': 'Net Income From Continuing Operations',
            'depreciation_amort': 'Depreciation And Amortization',
            'change_in_receivables': 'Change In Receivables',
            'change_in_payables': 'Change In Payable',
        }
        for label, yf_key in cf_items.items():
            if yf_key and yf_key in cf.index:
                row = cf.loc[yf_key]
                vals = {}
                for col in cf.columns:
                    try:
                        vals[str(col)[:10]] = float(row[col]) / 1e7
                    except (TypeError, ValueError):
                        vals[str(col)[:10]] = str(row[col])
                section[label] = vals
            else:
                section[label] = 'N/A'

        # Free cash flow to equity estimate
        if 'Free Cash Flow' in cf.index:
            fcf = {}
            for col in cf.columns:
                try:
                    fcf_val = float(cf.loc['Free Cash Flow', col])
                    fcf[str(col)[:10]] = round(fcf_val / 1e7, 2)
                except Exception:
                    pass
            section['free_cashflow_crores'] = fcf if fcf else 'N/A'

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 08 - FINANCIAL RATIOS
    # ────────────────────────────────────────────────────────────
    def _section_ratios(self) -> dict:
        i = self.info
        fs = self.financials
        bs = self.balance_sheet

        ratios = {
            # Profitability
            'return_on_equity': self._percent(self._get_roe()),
            'return_on_assets': self._percent(i.get('returnOnAssets')),
            'profit_margin': self._percent(i.get('profitMargins')),
            'operating_margin': self._percent(i.get('operatingMargins')),
            'ebitda_margin': self._percent(i.get('ebitdaMargins')),
            'net_interest_margin': 'N/A (requires detailed NII / avg assets)',
            # Liquidity
            'current_ratio': self._ratio(i.get('currentRatio')),
            'quick_ratio': ('N/A (banking - current ratio not applicable)' if self._is_bank()
                            else self._ratio(i.get('quickRatio'))),
            'cash_ratio': self._ratio(i.get('totalCashPerShare')),
            # Solvency
            'debt_to_equity': self._debt_to_equity(),
            'net_debt_to_equity': 'N/A',
            'interest_coverage_ratio': self._compute_icr(),
            'total_debt_to_assets': self._compute_debt_to_assets(),
            # Efficiency
            'asset_turnover': ('N/A (banking - NII / avg assets used instead)' if self._is_bank() else 'N/A'),
            'inventory_turnover': ('N/A (not applicable for banking)' if self._is_bank() else 'N/A'),
            # Valuation
            'pe_ttm': self._ratio(i.get('trailingPE')),
            'forward_pe': self._ratio(i.get('forwardPE')),
            'peg_ratio': self._ratio(i.get('pegRatio')),
            'price_to_book': self._ratio(i.get('priceToBook')),
            'price_to_sales': self._ratio(i.get('priceToSalesTrailing12Months')),
            'ev_to_revenue': self._ratio(i.get('enterpriseToRevenue')),
            'dividend_yield': self._dividend_yield(),
            'payout_ratio': self._percent(i.get('payoutRatio')),
            'fcf_yield': self._compute_fcf_yield(i),
        }
        return self._scrub(ratios)

    def _compute_icr(self) -> str:
        fs = self.financials
        if fs.empty or 'Pretax Income' not in fs.index or 'Interest Expense' not in fs.index:
            return 'N/A'
        try:
            latest_col = fs.columns[0]
            pti = float(fs.loc['Pretax Income', latest_col])
            ie = float(fs.loc['Interest Expense', latest_col])
            if ie != 0:
                return f'{pti / ie:.2f}x'
        except Exception:
            pass
        return 'N/A'

    def _compute_debt_to_assets(self) -> str:
        bs = self.balance_sheet
        if bs.empty or 'Total Debt' not in bs.index or 'Total Assets' not in bs.index:
            return 'N/A'
        try:
            latest_col = bs.columns[0]
            td = float(bs.loc['Total Debt', latest_col])
            ta = float(bs.loc['Total Assets', latest_col])
            if ta != 0:
                return f'{td / ta:.2%}'
        except Exception:
            pass
        return 'N/A'

    def _compute_fcf_yield(self, i: dict) -> str:
        fcf = i.get('freeCashflow', None)
        mcap = i.get('marketCap', None)
        if fcf and mcap and mcap != 0:
            return f'{fcf / mcap * 100:.2f}%'
        return 'N/A'

    # ────────────────────────────────────────────────────────────
    # SECTION 09 - GROWTH METRICS
    # ────────────────────────────────────────────────────────────
    def _section_growth(self) -> dict:
        i = self.info
        fs = self.financials

        section = {
            'revenue_growth_ttm': self._percent(i.get('revenueGrowth')),
            'earnings_growth_ttm': self._percent(i.get('earningsGrowth')),
            'earnings_quarterly_growth': self._percent(i.get('earningsQuarterlyGrowth')),
        }

        # YoY comparison from financials
        if not fs.empty and             'Total Revenue' in fs.index:
            rev_row = fs.loc['Total Revenue']
            years = list(rev_row.index)
            if len(years) >= 2:
                try:
                    latest = float(rev_row[years[0]])
                    prior = float(rev_row[years[1]])
                    section['revenue_yoy_1yr'] = self._percent((latest - prior) / prior) if prior else 'N/A'
                except Exception:
                    section['revenue_yoy_1yr'] = 'N/A'
            if len(years) >= 3:
                try:
                    prior2 = float(rev_row[years[2]])
                    latest = float(rev_row[years[0]])
                    section['revenue_cagr_2yr'] = self._percent((latest / prior2) ** 0.5 - 1) if prior2 else 'N/A'
                except Exception:
                    section['revenue_cagr_2yr'] = 'N/A'
            section['revenue_trend'] = {str(col)[:10]: float(rev_row[col])/1e7 for col in years}

        if not fs.empty and 'Net Income Common Stockholders' in fs.index:
            ni_row = fs.loc['Net Income Common Stockholders']
            years = list(ni_row.index)
            if len(years) >= 2:
                try:
                    latest = float(ni_row[years[0]])
                    prior = float(ni_row[years[1]])
                    section['net_income_yoy_1yr'] = self._percent((latest - prior) / prior) if prior else 'N/A'
                except Exception:
                    section['net_income_yoy_1yr'] = 'N/A'
            if len(years) >= 3:
                try:
                    prior2 = float(ni_row[years[2]])
                    latest = float(ni_row[years[0]])
                    section['net_income_cagr_2yr'] = self._percent((latest / prior2) ** 0.5 - 1) if prior2 else 'N/A'
                except Exception:
                    section['net_income_cagr_2yr'] = 'N/A'

        if not fs.empty and 'Diluted EPS' in fs.index:
            eps_row = fs.loc['Diluted EPS']
            years = list(eps_row.index)
            if len(years) >= 2:
                try:
                    latest = float(eps_row[years[0]])
                    prior = float(eps_row[years[1]])
                    section['eps_yoy_1yr'] = self._percent((latest - prior) / prior) if prior else 'N/A'
                except Exception:
                    section['eps_yoy_1yr'] = 'N/A'

        section['source_note'] = 'YoY growth from annual financials. TTM growth from yfinance estimates.'
        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 10 - EARNINGS ANALYSIS
    # ────────────────────────────────────────────────────────────
    def _section_earnings(self) -> dict:
        i = self.info
        qf = self.q_financials

        section = {
            'earnings_timestamp': self._timestamp_str(i.get('earningsTimestamp')),
            'earnings_timestamp_end': self._timestamp_str(i.get('earningsTimestampEnd')),
            'next_earnings_date': 'Check earnings calendar',
            'eps_current_year': self._ratio(i.get('epsCurrentYear')),
            'eps_forward': self._ratio(i.get('forwardEps')),
            'eps_ttm': self._ratio(i.get('trailingEps')),
            'surprise_history': 'Not available via yfinance',
        }

        # Quarterly revenue & net income trends
        if not qf.empty:
            if 'Total Revenue' in qf.index:
                rev_q = {}
                for col in qf.columns:
                    try:
                        rev_q[str(col)[:10]] = round(float(qf.loc['Total Revenue', col]) / 1e7, 2)
                    except Exception:
                        pass
                section['quarterly_revenue_trend'] = rev_q
            if 'Net Income Common Stockholders' in qf.index:
                ni_q = {}
                for col in qf.columns:
                    try:
                        ni_q[str(col)[:10]] = round(float(qf.loc['Net Income Common Stockholders', col]) / 1e7, 2)
                    except Exception:
                        pass
                section['quarterly_net_income_trend'] = ni_q
            if 'Diluted EPS' in qf.index:
                eps_q = {}
                for col in qf.columns:
                    try:
                        eps_q[str(col)[:10]] = float(qf.loc['Diluted EPS', col])
                    except Exception:
                        pass
                section['quarterly_eps_trend'] = eps_q

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 11 - DIVIDEND ANALYSIS
    # ────────────────────────────────────────────────────────────
    def _section_dividends(self) -> dict:
        i = self.info
        divs = getattr(self, '_dividends', pd.Series(dtype=float))

        section = {
            'dividend_rate': i.get('dividendRate', 'N/A'),
            'dividend_yield': self._dividend_yield(),
            'payout_ratio': self._percent(i.get('payoutRatio')),
            'trailing_annual_div_rate': i.get('trailingAnnualDividendRate', 'N/A'),
            'trailing_annual_div_yield': self._dividend_yield(),
            'five_year_avg_div_yield': self._percent(i.get('fiveYearAvgDividendYield')),
            'last_ex_dividend_date': self._timestamp_str(i.get('exDividendDate')),
            'last_dividend_date': self._timestamp_str(i.get('lastDividendDate')),
            'last_dividend_value': i.get('lastDividendValue', 'N/A'),
        }

        if divs is not None and not divs.empty:
            # Recent dividends
            recent = divs.tail(10)
            div_history = {}
            for dt, val in recent.items():
                try:
                    div_history[str(dt)[:10]] = float(val)
                except Exception:
                    div_history[str(dt)[:10]] = str(val)[:50]
            section['recent_dividends'] = div_history
            section['dividend_payment_trend'] = 'Stable' if len(divs) >= 5 else 'Irregular/Not available'

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 12 - VALUATION ANALYSIS
    # ────────────────────────────────────────────────────────────
    def _section_valuation(self) -> dict:
        i = self.info
        section = {
            'current_price': i.get('currentPrice', 'N/A'),
            'market_cap': f'₹{i.get("marketCap", 0)/1e7:,.0f} Cr' if i.get('marketCap') else 'N/A',
            'enterprise_value': f'₹{i.get("enterpriseValue", 0)/1e7:,.0f} Cr' if i.get('enterpriseValue') else 'N/A',
            'pe_ttm': self._ratio(i.get('trailingPE')),
            'forward_pe': self._ratio(i.get('forwardPE')),
            'peg_ratio': self._ratio(i.get('pegRatio')),
            'pe_current_year': self._ratio(i.get('priceEpsCurrentYear')),
            'price_to_book': self._ratio(i.get('priceToBook')),
            'price_to_sales': self._ratio(i.get('priceToSalesTrailing12Months')),
            'ev_to_revenue': self._ratio(i.get('enterpriseToRevenue')),
            'price_to_fcf': 'N/A (requires FCF computation)',
            'dividend_yield': self._dividend_yield(),
            'fcf_yield': self._compute_fcf_yield(i),
            '52w_high': i.get('fiftyTwoWeekHigh', 'N/A'),
            '52w_low': i.get('fiftyTwoWeekLow', 'N/A'),
            '52w_range_pct': f"{(i.get('currentPrice', 0) - i.get('fiftyTwoWeekLow', 0)) / (i.get('fiftyTwoWeekHigh', 0) - i.get('fiftyTwoWeekLow', 0)) * 100:.1f}%" if i.get('fiftyTwoWeekHigh') and i.get('fiftyTwoWeekLow') and i.get('currentPrice') else 'N/A',
            'analyst_target_mean': i.get('targetMeanPrice', 'N/A'),
            'analyst_target_high': i.get('targetHighPrice', 'N/A'),
            'analyst_target_low': i.get('targetLowPrice', 'N/A'),
            'analyst_upside': f"{(i.get('targetMeanPrice', 0) / i.get('currentPrice', 1) - 1) * 100:.1f}%" if i.get('targetMeanPrice') and i.get('currentPrice') else 'N/A',
            'analyst_rating': i.get('recommendationKey', 'N/A'),
            'analyst_rating_mean': self._ratio(i.get('recommendationMean')),
            'analyst_count': i.get('numberOfAnalystOpinions', 'N/A'),
            'average_analyst_rating': i.get('averageAnalystRating', 'N/A'),
        }
        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 13 - INDUSTRY & PEER CONTEXT
    # ────────────────────────────────────────────────────────────
    def _section_industry(self) -> dict:
        i = self.info
        summary = i.get('longBusinessSummary', '')
        # Extract competitors from business summary (companies named)
        import re
        competitors = re.findall(r'[A-Z][a-z]+ (?:Bank|Limited|Corp|Inc|Ltd|Group)', summary)
        competitors = list(set(c for c in competitors if c.upper() not in self.ticker.upper().replace('.NS', '')))[:5]

        return self._scrub({
            'sector': i.get('sector', 'N/A'),
            'industry': i.get('industry', 'N/A'),
            'industry_key': i.get('industryKey', 'N/A'),
            'sector_key': i.get('sectorKey', 'N/A'),
            'peers_mentioned': competitors if competitors else (
                ['Requires manual research (ICICI Bank, Kotak Mahindra, Axis Bank, SBI, Yes Bank)']
                if self._is_bank() else ['Requires manual research (peer comparison)']),
            'industry_rank': 'Requires manual research (NSE/BSE sector ranking)',
            'market_cap_rank': 'Requires manual research',
            'growth_relative_to_industry': 'Requires manual research',
            'notes': 'Full peer comparison requires manual industry benchmarking.',
        })

    # ────────────────────────────────────────────────────────────
    # SECTION 14 - ECONOMIC SENSITIVITY
    # ────────────────────────────────────────────────────────────
    def _section_economic_sensitivity(self) -> dict:
        i = self.info
        beta = i.get('beta', None)
        sector = i.get('sector', '').lower()
        industry = i.get('industry', '')
        is_bank = self._is_bank()

        sensitivity = 'Moderate'
        if beta is not None:
            if beta < 0.5:
                sensitivity = 'Low (defensive)'
            elif beta < 1.0:
                sensitivity = 'Moderate'
            else:
                sensitivity = 'High (cyclical)'

        if is_bank:
            return self._scrub({
                'beta': beta if beta else 'N/A',
                'beta_category': sensitivity,
                'interest_rate_sensitivity': 'High (banks: NIMs affected by repo rate changes)',
                'inflation_sensitivity': 'Moderate (cost pressure, but floating-rate loans adjust)',
                'economic_cycle_sensitivity': 'Moderate (loan demand correlated with GDP)',
                'regulatory_sensitivity': 'High (RBI regulations, Basel norms, capital adequacy)',
                'sector_classification': 'Financial Services - Banking (Cyclical/Regulated)',
                'notes': 'Banks are typically interest-rate sensitive and regulated. Beta quantifies market sensitivity.',
            })

        return self._scrub({
            'beta': beta if beta else 'N/A',
            'beta_category': sensitivity,
            'interest_rate_sensitivity': 'Moderate (cost of capital sensitive)',
            'inflation_sensitivity': 'Moderate (input cost pressure)',
            'economic_cycle_sensitivity': 'Moderate (defense demand is budget-driven, less cyclical)',
            'regulatory_sensitivity': 'Moderate (defense procurement & export regulations)',
            'sector_classification': f'{i.get("sector", "N/A")} - {industry}',
            'notes': 'Sensitivity is driven by sector fundamentals and beta. Beta quantifies market sensitivity.',
        })

    # ────────────────────────────────────────────────────────────
    # SECTION 15 - RISK ASSESSMENT
    # ────────────────────────────────────────────────────────────
    def _section_risk(self) -> dict:
        i = self.info
        bs = self.balance_sheet

        risk_flags = []

        # Debt level (normalized: yfinance returns ratio or percent inconsistently)
        debt_to_eq_raw = i.get('debtToEquity', None)
        debt_to_eq = None
        if debt_to_eq_raw is not None:
            try:
                debt_to_eq = float(debt_to_eq_raw)
                if abs(debt_to_eq) > 1:
                    debt_to_eq = debt_to_eq / 100.0
            except (TypeError, ValueError):
                debt_to_eq = None
        if debt_to_eq is not None and debt_to_eq > 2:
            risk_flags.append(f'⚠ High debt-to-equity ({debt_to_eq:.2f})')
        elif debt_to_eq is not None and debt_to_eq > 1:
            risk_flags.append(f'Moderate leverage ({debt_to_eq:.2f})')

        # Beta risk
        beta = i.get('beta', None)
        if beta is not None and beta > 1.5:
            risk_flags.append(f'⚠ High beta ({beta:.2f})')

        # Profitability risk
        roe = i.get('returnOnEquity', None)
        if roe is not None and roe < 0.08:
            risk_flags.append(f'⚠ Low ROE ({roe*100:.1f}%)')

        # Payout ratio
        payout = i.get('payoutRatio', None)
        if payout is not None and payout > 0.9:
            risk_flags.append(f'⚠ High payout ratio ({payout*100:.1f}%) - dividend sustainability risk')

        # Cash flow risk
        ocf = i.get('operatingCashflow', None)
        ni = i.get('netIncomeToCommon', None)
        if ocf is not None and ni is not None and ocf < 0 and ni > 0:
            risk_flags.append('⚠ Negative operating cashflow despite positive net income')

        # Regulatory risk
        if self._is_bank():
            risk_flags.append('Regulatory compliance (RBI/Basel norms)')

        return self._scrub({
            'risk_flags': risk_flags if risk_flags else ['No significant red flags detected from available data'],
            'beta': beta if beta else 'N/A',
            'debt_to_equity': self._ratio(debt_to_eq),
            'payout_ratio': self._percent(payout),
            'risk_rating': 'Low' if len([f for f in risk_flags if '⚠' in f]) == 0 else
                           'Moderate' if len([f for f in risk_flags if '⚠' in f]) <= 2 else 'High',
            'concentration_risk': ('Diversified across retail + wholesale banking segments' if self._is_bank()
                                   else 'Requires manual review of revenue concentration'),
            'regulatory_risk': ('High (banking sector heavily regulated by RBI)' if self._is_bank()
                                else 'Moderate (sector-specific regulations apply)'),
            'notes': 'Automated flag-based assessment. Full risk analysis requires manual review.',
        })

    # ────────────────────────────────────────────────────────────
    # SECTION 16 - CORPORATE ACTIONS
    # ────────────────────────────────────────────────────────────
    def _section_corporate_actions(self) -> dict:
        splits = getattr(self, '_splits', pd.Series(dtype=float))
        divs = getattr(self, '_dividends', pd.Series(dtype=float))
        i = self.info

        section = {}

        # Splits
        if splits is not None and hasattr(splits, 'empty') and not splits.empty:
            split_history = {}
            for dt, val in splits.items():
                try:
                    split_history[str(dt)[:10]] = f'{val:.1f}:1'
                except Exception:
                    split_history[str(dt)[:10]] = str(val)[:50]
            section['stock_splits'] = split_history
            section['last_split_date'] = str(splits.index[-1])[:10] if not splits.empty else 'N/A'
            section['last_split_factor'] = f'{splits.iloc[-1]:.1f}:1' if not splits.empty else 'N/A'
        else:
            section['stock_splits'] = 'None recorded'

        # Dividends
        if divs is not None and not divs.empty:
            section['dividend_count_5yr'] = len(divs.tail(20))
            section['dividend_growth'] = 'Increasing' if len(divs) >= 3 and float(divs.iloc[-1]) > float(divs.iloc[0]) else 'Stable/Variable'

        # Other
        section['buybacks'] = i.get('repurchaseOfCapitalStock', 'Not available via yfinance')
        section['notes'] = 'Corporate actions from yfinance. For detailed history, check BSE/NSE corporate actions page.'

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 17 - QUARTERLY RESULTS DETAIL
    # ────────────────────────────────────────────────────────────
    def _section_quarterly_detail(self) -> dict:
        qf = self.q_financials
        if qf.empty:
            return {'status': 'No quarterly data available'}
        section = {'currency': 'INR Crores', 'source': 'yfinance quarterly financials'}
        # Show key line items across quarters
        key_items = [
            'Total Revenue', 'Net Interest Income', 'Pretax Income',
            'Tax Provision', 'Net Income Common Stockholders',
            'Diluted EPS', 'Basic EPS',
            'Selling General And Administration',
        ]
        for item in key_items:
            if item in qf.index:
                row = qf.loc[item]
                vals = {}
                for col in qf.columns:
                    try:
                        divisor = 1e7 if 'EPS' not in item else 1
                        vals[str(col)[:10]] = round(float(row[col]) / divisor, 2)
                    except Exception:
                        vals[str(col)[:10]] = str(row[col])[:50]
                section[item] = vals
        # Sequential growth
        if 'Total Revenue' in qf.index and len(qf.columns) >= 2:
            try:
                q_rev = [float(qf.loc['Total Revenue', c]) for c in qf.columns]
                if q_rev[0] and q_rev[1]:
                    section['revenue_qoq_growth'] = self._percent((q_rev[0] - q_rev[1]) / q_rev[1])
            except Exception:
                pass
        if 'Net Income Common Stockholders' in qf.index and len(qf.columns) >= 2:
            try:
                q_ni = [float(qf.loc['Net Income Common Stockholders', c]) for c in qf.columns]
                if q_ni[0] and q_ni[1]:
                    section['net_income_qoq_growth'] = self._percent((q_ni[0] - q_ni[1]) / q_ni[1])
            except Exception:
                pass

        # YoY growth: compare the latest quarter with the same quarter in the
        # prior year. QoQ is misleading for seasonal businesses (e.g. defense,
        # where Q4 is typically the strongest quarter), so YoY adds context.
        # NOTE: match by DATE, not by column index — yfinance quarterly data
        # can have missing quarters (e.g. BEL.NS lacks 2025-09-30), so a fixed
        # index offset (cols[4]) compares against the wrong quarter.
        def _yoy(item: str) -> str:
            if item not in qf.index or len(qf.columns) < 2:
                return 'N/A'
            try:
                cols = list(qf.columns)
                latest_date = pd.Timestamp(cols[0])
                latest = float(qf.loc[item, cols[0]])
                # Find the column closest to ~365 days before the latest quarter.
                best_col = None
                best_diff = None
                for c in cols[1:]:
                    d = pd.Timestamp(c)
                    diff = abs((latest_date - d).days - 365)
                    if best_diff is None or diff < best_diff:
                        best_diff = diff
                        best_col = c
                if best_col is None:
                    return 'N/A'
                prior = float(qf.loc[item, best_col])
                if prior:
                    return self._percent((latest - prior) / prior)
            except Exception:
                pass
            return 'N/A'

        section['revenue_yoy_growth'] = _yoy('Total Revenue')
        section['net_income_yoy_growth'] = _yoy('Net Income Common Stockholders')

        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 18 - ANNUAL REPORT SUMMARY
    # ────────────────────────────────────────────────────────────
    def _section_annual_report(self) -> dict:
        i = self.info
        summary = i.get('longBusinessSummary', '')
        return self._scrub({
            'fiscal_year_end': self._timestamp_str(i.get('lastFiscalYearEnd')),
            'next_fiscal_year_end': self._timestamp_str(i.get('nextFiscalYearEnd')),
            'most_recent_quarter': self._timestamp_str(i.get('mostRecentQuarter')),
            'business_summary': summary[:2000] if summary else 'Not available',
            'key_business_segments': self._extract_segments(summary),
            'source': 'Business summary from yfinance. Full annual report requires BSE/NSE filing or company website.',
        })

    def _extract_segments(self, summary: str) -> list:
        segments = []
        keywords = ['Treasury', 'Retail Banking', 'Wholesale Banking', 'Insurance',
                     'Corporate', 'Rural', 'Digital', 'Wealth', 'NRI', 'SME']
        for kw in keywords:
            if kw.lower() in summary.lower():
                segments.append(kw)
        return segments if segments else ['Not specified']

    # ────────────────────────────────────────────────────────────
    # SECTION 19 - CONFERENCE CALL / MD&A
    # ────────────────────────────────────────────────────────────
    def _section_conference_call(self) -> dict:
        i = self.info
        section = {
            'last_earnings_call': self._timestamp_str(i.get('earningsCallTimestampStart')),
            'earnings_call_end': self._timestamp_str(i.get('earningsCallTimestampEnd')),
            'transcript': 'Not available via yfinance',
            'management_outlook': 'Requires manual review of earnings call transcript',
            'md_and_a': 'Requires manual review of annual report',
            'forward_guidance': 'Not available programmatically',
            'notes': 'Earnings call transcripts available from company IR page or Bloomberg/Reuters.',
        }
        return self._scrub(section)

    # ────────────────────────────────────────────────────────────
    # SECTION 20 - NEWS & SENTIMENT
    # ────────────────────────────────────────────────────────────
    def _section_news(self) -> dict:
        news = getattr(self, '_news', [])

        articles = []
        if news and len(news) > 0:
            for item in news[:10]:
                if isinstance(item, dict):
                    try:
                        content = item.get('content', item) or item
                        if isinstance(content, dict):
                            title = content.get('title', item.get('title', 'N/A'))
                            publisher = content.get('provider', content.get('publisher', item.get('publisher', 'N/A')))
                            if isinstance(publisher, dict):
                                publisher = publisher.get('displayName', 'N/A')
                            articles.append({
                                'title': str(title)[:120],
                                'publisher': str(publisher)[:50],
                                'link': str(content.get('canonicalUrl', content.get('url', item.get('link', '#')))),
                                'type': str(content.get('contentType', item.get('type', 'N/A'))),
                                'related_tickers': item.get('relatedTickers', content.get('relatedTickers', [])),
                            })
                    except Exception:
                        pass
        return self._scrub({
            'recent_news_count': len(articles),
            'articles': articles if articles else ['No recent news available via yfinance'],
            'sentiment': 'Requires NLP sentiment analysis on news articles',
            'source_note': 'News from yfinance. For comprehensive coverage, check Reuters, Bloomberg, Moneycontrol, Economic Times.',
        })

    # ────────────────────────────────────────────────────────────
    # SECTION 21 - SCREENING SCORE
    # ────────────────────────────────────────────────────────────
    def _section_screening(self) -> dict:
        i = self.info
        score = 0
        max_score = 0

        # Value factor (max 20): PE (15) + PEG bonus (5)
        pe = i.get('trailingPE', None)
        eg = i.get('earningsGrowth', None)
        if pe and pe > 0:
            max_score += 20
            if pe < 15: score += 15
            elif pe < 20: score += 10
            elif pe < 25: score += 5
            # PEG bonus: growth justifies the multiple (capped at PE < 60 so
            # extreme multiples like 100x+ never get growth credit)
            if eg and eg > 0 and pe < 60:
                peg = pe / (eg * 100.0)
                if peg < 1.5: score += 5
                elif peg < 2.5: score += 3

        pb = i.get('priceToBook', None)
        if pb and pb < 1.5: score += 5
        elif pb and pb < 3: score += 3
        max_score += 5

        # Growth factor (max 20)
        eg = i.get('earningsGrowth', None)
        if eg and eg > 0.15: score += 15
        elif eg and eg > 0.05: score += 10
        elif eg and eg > 0: score += 5
        max_score += 15

        rg = i.get('revenueGrowth', None)
        if rg and rg > 0.10: score += 5
        elif rg and rg > 0: score += 3
        max_score += 5

        # Profitability (max 20)
        roe = self._get_roe()
        if roe and roe > 0.15: score += 15
        elif roe and roe > 0.10: score += 10
        elif roe and roe > 0.05: score += 5
        max_score += 15

        pm = i.get('profitMargins', None)
        if pm and pm > 0.20: score += 5
        elif pm and pm > 0.10: score += 3
        max_score += 5

        # Momentum (max 10)
        # 50d vs 200d
        ma50 = i.get('fiftyDayAverage', None)
        ma200 = i.get('twoHundredDayAverage', None)
        price = i.get('currentPrice', None)
        if price and ma50 and price > ma50: score += 5
        if price and ma200 and price > ma200: score += 5
        max_score += 10

        # Analyst (max 10)
        rec = i.get('recommendationKey', '')
        if rec == 'strong_buy': score += 10
        elif rec == 'buy': score += 7
        elif rec == 'hold': score += 3
        max_score += 10

        # Dividend (max 5)
        dy = i.get('dividendYield', 0)
        if dy and dy > 0.02: score += 5
        elif dy and dy > 0.01: score += 3
        max_score += 5

        # Risk (max 10)
        beta = i.get('beta', 1)
        if beta and beta < 0.8: score += 5
        elif beta and beta < 1.2: score += 3
        debt_eq = i.get('debtToEquity', None)
        if debt_eq and debt_eq < 0.5: score += 5
        elif debt_eq and debt_eq < 1: score += 3
        max_score += 10

        pct = score / max_score * 100 if max_score > 0 else 0

        rating = 'Strong Buy' if pct >= 80 else 'Buy' if pct >= 65 else \
                 'Hold' if pct >= 40 else 'Sell' if pct >= 25 else 'Strong Sell'

        return self._scrub({
            'total_score': round(score),
            'max_score': max_score,
            'score_percentage': round(pct, 1),
            'rating': rating,
            'factor_breakdown': {
                'value_pe_pb': min(25, round(score * 25 / max_score)) if max_score else 0,
                'growth': min(20, round(score * 20 / max_score)) if max_score else 0,
                'profitability_roe_margins': min(20, round(score * 20 / max_score)) if max_score else 0,
                'momentum': min(10, round(score * 10 / max_score)) if max_score else 0,
                'analyst_sentiment': min(10, round(score * 10 / max_score)) if max_score else 0,
                'dividend': min(5, round(score * 5 / max_score)) if max_score else 0,
                'risk_beta_debt': min(10, round(score * 10 / max_score)) if max_score else 0,
            },
            'notes': 'Quantitative screening score based on 7 factors. Not investment advice.',
        })

    # ────────────────────────────────────────────────────────────
    # SECTION 22 - INVESTMENT SUITABILITY
    # ────────────────────────────────────────────────────────────
    def _section_suitability(self) -> dict:
        i = self.info
        screening = self._section_screening()
        risk = self._section_risk()
        rating = screening.get('rating', 'Hold')

        mcap = i.get('marketCap', 0)
        if mcap > 1e12:
            cap_category = 'Large Cap'
        elif mcap > 1e11:
            cap_category = 'Mid Cap'
        else:
            cap_category = 'Small Cap'

        suitability = f'{rating} - {cap_category}'
        if 'Strong Buy' in suitability:
            detail = 'Favorable valuation, strong growth, profitability, and analyst consensus.'
        elif 'Buy' in suitability:
            detail = 'Attractive fundamentals with some moderate risk factors.'
        elif 'Hold' in suitability:
            detail = 'Fairly valued. Wait for better entry or catalyst.'
        else:
            detail = 'Elevated risk or weak fundamentals. Caution advised.'

        return self._scrub({
            'overall_rating': rating,
            'market_cap_category': cap_category,
            'suitability_statement': suitability,
            'detail': detail,
            'suggested_investment_horizon': 'Long-term (3-5 years)' if rating in ('Strong Buy', 'Buy') else 'Medium-term (1-3 years)',
            'suggested_allocation': 'Core holding' if rating in ('Strong Buy', 'Buy') else 'Tactical/Hold',
            'key_strengths': self._get_key_strengths(i),
            'key_concerns': risk.get('risk_flags', []),
            'disclaimer': 'This analysis is for informational purposes only. Not investment advice. Conduct your own due diligence.',
        })

    def _get_key_strengths(self, i: dict) -> list:
        strengths = []
        if i.get('returnOnEquity', 0) and i['returnOnEquity'] > 0.12:
            strengths.append(f"Strong ROE of {i['returnOnEquity']*100:.1f}%")
        if i.get('profitMargins', 0) and i['profitMargins'] > 0.20:
            strengths.append(f"Healthy profit margins of {i['profitMargins']*100:.1f}%")
        if i.get('pegRatio', 0) and i['pegRatio'] < 1.0:
            strengths.append(f"Attractive PEG ratio of {i['pegRatio']:.2f}")
        if i.get('beta', 0) and i['beta'] < 0.8:
            strengths.append(f"Low volatility (beta {i['beta']:.2f})")
        if i.get('recommendationKey') in ('strong_buy', 'buy'):
            strengths.append(f"Strong analyst consensus ({i.get('recommendationKey', '')})")
        if i.get('currentPrice', 0) and i.get('targetMeanPrice', 0) and i['targetMeanPrice'] > i['currentPrice']:
            upside = (i['targetMeanPrice'] / i['currentPrice'] - 1) * 100
            strengths.append(f"Analyst upside of {upside:.1f}%")
        return strengths if strengths else ['Requires manual research']

    # ────────────────────────────────────────────────────────────
    # FUNDAMENTALS CACHE (scan optimization)
    # ────────────────────────────────────────────────────────────
    # Fundamentals change quarterly. Caching them for FUND_CACHE_TTL_DAYS
    # (default 7) cuts per-ticker Yahoo requests from ~9 to ~1 (just OHLCV),
    # which is the real bottleneck during full-NSE scans (Yahoo rate limits).
    def _fund_cache_path(self) -> str:
        """Resolve the fundamentals cache file for this ticker."""
        env_dir = os.environ.get("FUND_CACHE_DIR", "").strip()
        if env_dir:
            cache_dir = env_dir
        else:
            # Walk up from this file to find the shared reports/ directory
            # (works for share/, engine/, and vercel-backend/lib/ copies).
            d = os.path.dirname(os.path.abspath(__file__))
            cache_dir = None
            for _ in range(5):
                if os.path.isdir(os.path.join(d, 'reports')):
                    cache_dir = os.path.join(d, 'reports', 'fundamentals_cache')
                    break
                parent = os.path.dirname(d)
                if parent == d:
                    break
                d = parent
            if cache_dir is None:
                cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         'reports', 'fundamentals_cache')
        os.makedirs(cache_dir, exist_ok=True)
        return os.path.join(cache_dir, f"{self.ticker.replace('.', '_')}.json")

    @staticmethod
    def _df_to_json(df: pd.DataFrame) -> dict:
        return {
            'index': [str(i) for i in df.index],
            'columns': [str(c) for c in df.columns],
            'data': df.values.tolist(),
        }

    @staticmethod
    def _json_to_df(j: dict) -> pd.DataFrame:
        return pd.DataFrame(j['data'], index=j['index'], columns=j['columns'])

    @staticmethod
    def _series_to_json(s: pd.Series) -> dict:
        return {'index': [str(i) for i in s.index], 'data': s.values.tolist()}

    @staticmethod
    def _json_to_series(j: dict) -> pd.Series:
        return pd.Series(j['data'], index=j['index'], dtype=float)

    def _load_fund_cache(self) -> Optional[dict]:
        """Load cached fundamentals if fresh. None on miss/stale/corrupt."""
        try:
            ttl_days = int(os.environ.get("FUND_CACHE_TTL_DAYS", "7"))
            if ttl_days <= 0:
                return None
            path = self._fund_cache_path()
            if not os.path.isfile(path):
                return None
            with open(path, 'r') as f:
                j = json.load(f)
            saved = datetime.fromisoformat(j.get('saved_at', '2000-01-01T00:00:00'))
            if (self._clock_now() - saved).days >= ttl_days:
                return None
            return {
                'info': j.get('info', {}),
                'financials': self._json_to_df(j['financials']),
                'balance_sheet': self._json_to_df(j['balance_sheet']),
                'cashflow': self._json_to_df(j['cashflow']),
                'q_financials': self._json_to_df(j['q_financials']),
                'splits': self._json_to_series(j['splits']),
                'dividends': self._json_to_series(j['dividends']),
                'news': j.get('news', []),
            }
        except Exception as e:
            log.warning(f"Fundamentals cache read error for {self.ticker}: {e}")
            return None

    def _save_fund_cache(self) -> None:
        """Persist fetched fundamentals to cache."""
        try:
            path = self._fund_cache_path()
            j = {
                'saved_at': self._clock_now().isoformat(timespec='seconds'),
                'info': self.info,
                'financials': self._df_to_json(self.financials),
                'balance_sheet': self._df_to_json(self.balance_sheet),
                'cashflow': self._df_to_json(self.cashflow),
                'q_financials': self._df_to_json(self.q_financials),
                'splits': self._series_to_json(self._splits),
                'dividends': self._series_to_json(self._dividends),
                'news': self._news,
            }
            with open(path, 'w') as f:
                json.dump(j, f)
        except Exception as e:
            log.warning(f"Fundamentals cache save error for {self.ticker}: {e}")

    # ────────────────────────────────────────────────────────────
    # MAIN COLLECT METHOD
    # ────────────────────────────────────────────────────────────
    def collect(self) -> dict:
        """Execute full 22-section fundamental analysis."""
        try:
            # ── Fundamentals cache (scan optimization) ──
            cache = self._load_fund_cache()
            if cache is not None:
                self.info = cache['info']
                self.financials = cache['financials']
                self.balance_sheet = cache['balance_sheet']
                self.cashflow = cache['cashflow']
                self.q_financials = cache['q_financials']
                self._splits = cache['splits']
                self._dividends = cache['dividends']
                self._news = cache['news']
                self._loaded = True
                log.info(f"Fundamentals cache HIT for {self.ticker}")
            else:
                # Fetch all data
                log.info("Fetching fundamental data...")
                self.info = self._t.info
                self.financials = self._fetch_safe('financials')
                self.balance_sheet = self._fetch_safe('balance_sheet')
                self.cashflow = self._fetch_safe('cashflow')
                self.q_financials = self._fetch_safe('quarterly_financials')
                # Pre-fetch splits and dividends (cached by yfinance)
                try: self._splits = self._t.splits if hasattr(self._t, 'splits') else pd.Series(dtype=float)
                except Exception: self._splits = pd.Series(dtype=float)
                try: self._dividends = self._t.dividends if hasattr(self._t, 'dividends') else pd.Series(dtype=float)
                except Exception: self._dividends = pd.Series(dtype=float)
                try: self._news = self._t.news if hasattr(self._t, 'news') else []
                except Exception: self._news = []
                self._loaded = True
                self._save_fund_cache()

            if not self.info:
                return {'error': 'No fundamental data available for ' + self.ticker}

            log.info(f"Building 22-section fundamental report for {self.ticker}...")

            # Build each section and apply manual overrides where available
            s01 = self._merge_manual(self._section_company_overview(), 'section_01_company_overview')
            s02 = self._merge_manual(self._section_business_quality(), 'section_02_business_quality')
            s03 = self._merge_manual(self._section_management(), 'section_03_management')
            s04 = self._merge_manual(self._section_shareholding(), 'section_04_shareholding')
            s05 = self._merge_manual(self._section_pl(), 'section_05_pl')
            s06 = self._merge_manual(self._section_balance_sheet(), 'section_06_balance_sheet')
            s07 = self._merge_manual(self._section_cashflow(), 'section_07_cashflow')
            s08 = self._merge_manual(self._section_ratios(), 'section_08_ratios')
            s09 = self._merge_manual(self._section_growth(), 'section_09_growth')
            s10 = self._merge_manual(self._section_earnings(), 'section_10_earnings')
            s11 = self._merge_manual(self._section_dividends(), 'section_11_dividends')
            s12 = self._merge_manual(self._section_valuation(), 'section_12_valuation')
            s13 = self._merge_manual(self._section_industry(), 'section_13_industry')
            s14 = self._merge_manual(self._section_economic_sensitivity(), 'section_14_economic_sensitivity')
            s15 = self._merge_manual(self._section_risk(), 'section_15_risk')
            s16 = self._merge_manual(self._section_corporate_actions(), 'section_16_corporate_actions')
            s17 = self._merge_manual(self._section_quarterly_detail(), 'section_17_quarterly_detail')
            s18 = self._merge_manual(self._section_annual_report(), 'section_18_annual_report')
            s19 = self._merge_manual(self._section_conference_call(), 'section_19_conference_call')
            s20 = self._merge_manual(self._section_news(), 'section_20_news')
            s21 = self._merge_manual(self._section_screening(), 'section_21_screening')
            s22 = self._merge_manual(self._section_suitability(), 'section_22_suitability')

            total_overrides = sum(len(v) for v in self._overridden_fields.values())

            result = {
                'metadata': {
                    'ticker': self.ticker,
                    'generated_at': self._clock_now().strftime('%Y-%m-%d %H:%M:%S'),
                    'sections_completed': 22,
                    'data_source': 'yfinance (info + financials + BS + CF + holders)',
                    'manual_overrides_applied': total_overrides,
                    'manual_overrides_sections': dict(self._overridden_fields) if total_overrides > 0 else None,
                    'manual_fields': 'Fields marked with "Requires manual research" need annual report or screener.in review. '
                                     f'Use --manual-data to inject custom research.',
                },
                'section_01_company_overview': s01,
                'section_02_business_quality': s02,
                'section_03_management': s03,
                'section_04_shareholding': s04,
                'section_05_pl': s05,
                'section_06_balance_sheet': s06,
                'section_07_cashflow': s07,
                'section_08_ratios': s08,
                'section_09_growth': s09,
                'section_10_earnings': s10,
                'section_11_dividends': s11,
                'section_12_valuation': s12,
                'section_13_industry': s13,
                'section_14_economic_sensitivity': s14,
                'section_15_risk': s15,
                'section_16_corporate_actions': s16,
                'section_17_quarterly_detail': s17,
                'section_18_annual_report': s18,
                'section_19_conference_call': s19,
                'section_20_news': s20,
                'section_21_screening': s21,
                'section_22_suitability': s22,
                'quick_ratings': {
                    'screening_rating': s21.get('rating', 'N/A'),
                    'risk_rating': s15.get('risk_rating', 'N/A'),
                    'moat_rating': s02.get('moat_rating', 'N/A'),
                    'analyst_rating': self.info.get('recommendationKey', 'N/A'),
                },
                'error': None,
            }
            return result

        except Exception as e:
            log.warning(f"Fundamental analysis error: {e}")
            return {'error': str(e), 'metadata': {'ticker': self.ticker}}





# ────────────────────────────────────────────────────────────
# MODULE 11: Chart Generator
# ────────────────────────────────────────────────────────────

class ChartGenerator:
    """8-panel dark theme chart."""

    def __init__(self, df: pd.DataFrame, result: AnalysisResult, analysis: dict):
        self.df = df
        self.result = result
        self.a = analysis
        self.dates = df.index
        self.c = df['Close'].values.astype(float)
        self.h = df['High'].values.astype(float)
        self.l = df['Low'].values.astype(float)
        self.v = df['Volume'].values.astype(float)

    def generate(self, filepath: str):
        """Generate 8-panel chart."""
        fig, axes = plt.subplots(8, 1, figsize=(18, 20),
                                 gridspec_kw={'height_ratios': [3, 1, 1, 1, 1, 1, 1, 1]},
                                 sharex=True)
        ax1, ax2, ax3, ax4, ax5, ax6, ax7, ax8 = axes
        dates = self.dates

        def safe_array(arr):
            if arr is None or len(arr) == 0:
                return np.full(len(dates), np.nan)
            return arr

        sma20 = safe_array(self.a['raw'].get('sma20'))
        sma50 = safe_array(self.a['raw'].get('sma50'))
        sma200 = safe_array(self.a['raw'].get('sma200'))
        bb_u = safe_array(self.a['raw'].get('bb_upper'))
        bb_m = safe_array(self.a['raw'].get('bb_mid'))
        bb_l = safe_array(self.a['raw'].get('bb_lower'))

        # ── Panel 1: Candlesticks + MAs + BB + Fib + S/R + OB + FVG + Patterns ──
        # Real OHLC candlesticks (bodies + wicks) instead of a plain close line.
        o = self.df['Open'].values.astype(float)
        h = self.df['High'].values.astype(float)
        l = self.df['Low'].values.astype(float)
        c = self.c
        xnum = np.arange(len(dates))
        body_w = 0.6
        for i in range(len(dates)):
            color = '#3fb950' if c[i] >= o[i] else '#da3633'
            # Wick
            ax1.plot([xnum[i], xnum[i]], [l[i], h[i]], color=color, linewidth=0.8, alpha=0.9, solid_capstyle='round')
            # Body
            body_lo = min(o[i], c[i])
            body_hi = max(o[i], c[i])
            if body_hi - body_lo < 1e-9:
                body_hi = body_lo + (h[i] - l[i]) * 0.02 + 1e-9
            ax1.add_patch(Rectangle((xnum[i] - body_w / 2, body_lo), body_w, body_hi - body_lo,
                                    facecolor=color, edgecolor=color, linewidth=0.5, alpha=0.95))
        ax1.set_xlim(-1, len(dates))
        if len(sma20) == len(dates): ax1.plot(xnum, sma20, color='#58a6ff', linewidth=1, alpha=0.7, label='SMA20')
        if len(sma50) == len(dates): ax1.plot(xnum, sma50, color='#f0883e', linewidth=1, alpha=0.7, label='SMA50')
        if len(sma200) == len(dates): ax1.plot(xnum, sma200, color='#da3633', linewidth=1, alpha=0.7, label='SMA200')
        if len(bb_u) == len(dates) and len(bb_l) == len(dates):
            ax1.fill_between(xnum, bb_l, bb_u, alpha=0.06, color='#58a6ff')

        # Fib levels
        fib_data = self.a.get('fib_retracement', {})
        if fib_data and 'levels' in fib_data:
            for lbl, info in fib_data['levels'].items():
                ls = '--' if lbl == '61.8%' else ':'
                lw = 1.2 if lbl == '61.8%' else 0.6
                alpha = 0.8 if info.get('closest') else 0.4
                color = '#58a6ff' if info.get('closest') else '#8b949e'
                ax1.axhline(y=info['level'], color=color, linestyle=ls, linewidth=lw, alpha=alpha)
                ax1.text(len(dates) - 1, info['level'], f'  Fib {lbl}', color=color, fontsize=7, alpha=alpha, va='center')

        # S/R levels
        sr = self.a.get('sr_levels', {})
        for side in ['resistance', 'support']:
            for level in sr.get(side, []):
                color = '#da3633' if side == 'resistance' else '#3fb950'
                ax1.axhline(y=level['price'], color=color, linestyle='--', linewidth=0.5, alpha=0.3)

        # Order Blocks
        for ob in self.a.get('obs', []):
            color = '#3fb950' if 'Bullish' in ob['type'] else '#da3633'
            idx = ob['index']
            if idx < len(dates):
                ax1.axvspan(max(0, idx - 0.5), idx + 0.5, alpha=0.15, color=color)
                ax1.scatter(xnum[idx], ob['price'], color=color, s=30, marker='s', zorder=5)

        # FVGs
        for fvg in self.a.get('fvgs', []):
            color = '#d29922'
            idx = fvg['index']
            if idx < len(dates):
                ax1.fill_between(xnum[max(0, idx - 1):min(len(dates), idx + 2)],
                                 fvg['gap_high'], fvg['gap_low'],
                                 alpha=0.2, color=color)

        # Liquidity Sweeps
        for sw in self.a.get('sweeps', []):
            idx = sw.get('sweep_index', sw.get('index', 0))
            if idx < len(dates):
                ax1.axvline(x=xnum[idx], color='#f0883e', linestyle=':', alpha=0.6, linewidth=1)
                ax1.annotate('Sweep', (xnum[idx], self.h[idx]), textcoords="offset points",
                             xytext=(0, 8), fontsize=7, color='#f0883e', ha='center')

        # ── Detected candlestick patterns (highlight + label) ──
        cs = self.a.get('candlestick', {}) or {}
        cs_details = cs.get('details', []) or []
        for cd in cs_details:
            ci = cd.get('index')
            if ci is None or ci >= len(dates):
                continue
            tags = []
            if cd.get('bullish_engulfing'): tags.append('Bullish Engulfing')
            if cd.get('bearish_engulfing'): tags.append('Bearish Engulfing')
            if cd.get('hammer'): tags.append('Hammer')
            if cd.get('shooting_star'): tags.append('Shooting Star')
            if cd.get('doji'): tags.append('Doji')
            if cd.get('marubozu'): tags.append('Marubozu')
            if not tags:
                continue
            bull = any('Bullish' in t or t == 'Hammer' for t in tags)
            pcolor = '#3fb950' if bull else '#da3633'
            ax1.axvspan(ci - 0.5, ci + 0.5, alpha=0.12, color=pcolor)
            ax1.annotate(' + '.join(tags), (xnum[ci], self.h[ci]), textcoords="offset points",
                         xytext=(0, 10), fontsize=7, color=pcolor, ha='center', fontweight='bold')

        # ── Detected chart pattern (e.g. IHNS) — neckline + label ──
        pv = (self.a.get('convolution', {}) or {}).get('technical', {}) or {}
        pv = pv.get('pattern_votes', {}) or {}
        pat_names = pv.get('patterns', []) or []
        if pat_names:
            pretty = ', '.join(p.replace('_', ' ').title() for p in pat_names)
            ax1.text(0.01, 0.98, 'Patterns: ' + pretty,
                     transform=ax1.transAxes, fontsize=8, color='#a78bfa',
                     va='top', ha='left', fontweight='bold',
                     bbox=dict(boxstyle='round,pad=0.3', facecolor='#1c2128', alpha=0.8, edgecolor='#a78bfa'))

        # ── Pattern geometry: neckline + structure + generic lines/markers ──
        # Map pattern-engine times (ISO date strings) to chart x indices.
        time_to_idx = {str(d.date()): i for i, d in enumerate(dates)}
        for geo in pv.get('geometry', []) or []:
            neck = geo.get('neckline') or []
            struct = geo.get('structure') or []
            gen_lines = geo.get('lines') or []
            gen_markers = geo.get('markers') or []
            # Neckline (dashed) + extrapolation to the latest bar.
            if len(neck) >= 2:
                pts = []
                for t, pr in neck:
                    if t in time_to_idx:
                        pts.append((xnum[time_to_idx[t]], pr))
                if len(pts) >= 2:
                    (x1, y1), (x2, y2) = pts[0], pts[-1]
                    if x2 > x1:
                        slope = (y2 - y1) / (x2 - x1)
                        x_last = xnum[-1]
                        y_last = y2 + slope * (x_last - x2)
                        ax1.plot([x1, x_last], [y1, y_last], color='#a78bfa',
                                 linestyle='--', linewidth=1.6, alpha=0.9,
                                 label='Neckline')
            # Structure markers (LS / HD / RS) + W-shape connection lines so
            # the pattern is visually recognizable.
            struct_pts = []
            for s in struct:
                t, pr, lab = s.get('time'), s.get('price'), s.get('label')
                if t in time_to_idx:
                    xi = xnum[time_to_idx[t]]
                    struct_pts.append((xi, pr))
                    ax1.scatter(xi, pr, color='#a78bfa', s=42, marker='o',
                                zorder=6, edgecolors='#1c2128', linewidths=0.8)
                    ax1.annotate(lab, (xi, pr), textcoords="offset points",
                                 xytext=(0, 8), fontsize=7, color='#a78bfa',
                                 ha='center', fontweight='bold')
            if len(struct_pts) >= 2:
                xs, ys = zip(*struct_pts)
                ax1.plot(xs, ys, color='#a78bfa', linestyle='-',
                         linewidth=1.4, alpha=0.8)
            # Generic boundary lines (triangle legs, flag channels, wedge
            # rails, double-top/bottom levels, cup rim, island range).
            for ln in gen_lines:
                pts = ln.get('points') or []
                if len(pts) < 2:
                    continue
                line_pts = []
                for t, pr in pts:
                    if t in time_to_idx:
                        line_pts.append((xnum[time_to_idx[t]], pr))
                if len(line_pts) >= 2:
                    xs, ys = zip(*line_pts)
                    ax1.plot(xs, ys, color='#a78bfa',
                             linestyle='--' if ln.get('style') == 'dashed' else '-',
                             linewidth=1.4, alpha=0.85)
            # Generic markers (P1/P2, H1/H2, L1/L2, R1/R2, etc.).
            for m in gen_markers:
                t, pr, lab = m.get('time'), m.get('price'), m.get('label')
                if t in time_to_idx:
                    xi = xnum[time_to_idx[t]]
                    ax1.scatter(xi, pr, color='#a78bfa', s=36, marker='o',
                                zorder=6, edgecolors='#1c2128', linewidths=0.8)
                    ax1.annotate(lab, (xi, pr), textcoords="offset points",
                                 xytext=(0, 8), fontsize=7, color='#a78bfa',
                                 ha='center', fontweight='bold')

        ax1.set_ylabel('Price (₹)', color='#c9d1d9')
        ax1.set_title(f'{self.result.ticker} — Institutional Technical Analysis', color='#f0f6fc', fontsize=14, fontweight='bold')
        ax1.legend(loc='upper left', fontsize=7, ncol=3)
        ax1.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 2: RSI ──
        rsi_full = safe_array(self.a['raw'].get('rsi_full'))
        if len(rsi_full) == len(dates):
            ax2.plot(xnum, rsi_full, color='#7ee787', linewidth=1.2)
        ax2.axhline(y=70, color='#da3633', linestyle='--', alpha=0.4, linewidth=0.7)
        ax2.axhline(y=30, color='#3fb950', linestyle='--', alpha=0.4, linewidth=0.7)
        ax2.axhline(y=50, color='#8b949e', linestyle=':', alpha=0.2, linewidth=0.4)
        ax2.fill_between(xnum, 70, 100, alpha=0.06, color='#da3633')
        ax2.fill_between(xnum, 0, 30, alpha=0.06, color='#3fb950')
        ax2.set_ylabel('RSI(14)', color='#c9d1d9')
        ax2.set_ylim(0, 100)
        if len(rsi_full) == len(dates) and not np.isnan(rsi_full[-1]):
            ax2.text(xnum[-1], rsi_full[-1], f'  {rsi_full[-1]:.1f}', color='#7ee787', fontsize=9, fontweight='bold', va='center')
        ax2.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 3: MACD ──
        macd_l = safe_array(self.a['raw'].get('macd_line'))
        sig_l = safe_array(self.a['raw'].get('signal_line'))
        hist = safe_array(self.a['raw'].get('hist'))
        if len(hist) == len(dates):
            colors_macd = ['#3fb950' if v >= 0 else '#da3633' for v in hist]
            ax3.bar(xnum, hist, color=colors_macd, alpha=0.5, width=1)
        if len(macd_l) == len(dates): ax3.plot(xnum, macd_l, color='#58a6ff', linewidth=1.2, label='MACD')
        if len(sig_l) == len(dates): ax3.plot(xnum, sig_l, color='#f0883e', linewidth=0.9, label='Signal')
        ax3.axhline(y=0, color='#8b949e', linestyle='-', alpha=0.2, linewidth=0.4)
        ax3.set_ylabel('MACD', color='#c9d1d9')
        ax3.legend(loc='upper left', fontsize=7)
        ax3.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 4: ADX ──
        # Recompute ADX for charting
        tr_adx = np.maximum(self.h[1:] - self.l[1:],
                            np.maximum(np.abs(self.h[1:] - self.c[:-1]),
                                       np.abs(self.l[1:] - self.c[:-1])))
        up_adx = self.h[1:] - self.h[:-1]
        dn_adx = self.l[:-1] - self.l[1:]
        pos_dm = np.where((up_adx > dn_adx) & (up_adx > 0), up_adx, 0)
        neg_dm = np.where((dn_adx > up_adx) & (dn_adx > 0), dn_adx, 0)
        atr_adx_vals = pd.Series(tr_adx).rolling(14).mean().values
        pdi = pd.Series(pos_dm).rolling(14).mean().values / atr_adx_vals * 100
        ndi = pd.Series(neg_dm).rolling(14).mean().values / atr_adx_vals * 100
        dx = np.abs(pdi - ndi) / (pdi + ndi + 1e-10) * 100
        adx_line = pd.Series(dx).rolling(14).mean().values

        # Pad arrays
        pad_len = len(dates) - len(adx_line)
        adx_full = np.concatenate([np.full(pad_len, np.nan), adx_line]) if pad_len >= 0 else adx_line[-len(dates):]
        pdi_full = np.concatenate([np.full(pad_len, np.nan), pdi]) if pad_len >= 0 else pdi[-len(dates):]
        ndi_full = np.concatenate([np.full(pad_len, np.nan), ndi]) if pad_len >= 0 else ndi[-len(dates):]

        if len(adx_full) == len(dates):
            ax4.plot(xnum, adx_full, color='#c9d1d9', linewidth=1.2, label='ADX')
            ax4.plot(xnum, pdi_full, color='#3fb950', linewidth=1, alpha=0.7, label='+DI')
            ax4.plot(xnum, ndi_full, color='#da3633', linewidth=1, alpha=0.7, label='-DI')
        ax4.axhline(y=25, color='#d29922', linestyle='--', alpha=0.4, linewidth=0.6)
        ax4.axhline(y=20, color='#8b949e', linestyle=':', alpha=0.3, linewidth=0.4)
        ax4.set_ylabel('ADX(14)', color='#c9d1d9')
        ax4.set_ylim(0, 100)
        ax4.legend(loc='upper left', fontsize=7)
        ax4.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 5: OBV ──
        obv_l = safe_array(self.a['raw'].get('obv_line'))
        obv_sma = pd.Series(obv_l).rolling(20).mean().values if len(obv_l) == len(dates) else obv_l
        if len(obv_l) == len(dates):
            ax5.plot(xnum, obv_l, color='#d29922', linewidth=1.2, label='OBV')
            ax5.plot(xnum, obv_sma, color='#8b949e', linewidth=0.8, alpha=0.6, label='OBV-SMA20')
        ax5.set_ylabel('OBV', color='#c9d1d9')
        ax5.legend(loc='upper left', fontsize=7)
        ax5.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 6: Volume ──
        colors_vol = ['#3fb950' if i == 0 or self.c[i] >= self.c[i - 1] else '#da3633' for i in range(len(self.c))]
        ax6.bar(xnum, self.v, color=colors_vol, alpha=0.5, width=1)
        vol_sma20 = pd.Series(self.v).rolling(20).mean().values
        ax6.plot(xnum, vol_sma20, color='#58a6ff', linewidth=0.8, alpha=0.6, label='Vol-SMA20')
        ax6.set_ylabel('Volume', color='#c9d1d9')
        ax6.legend(loc='upper left', fontsize=7)
        ax6.ticklabel_format(style='scientific', axis='y', scilimits=(6, 6))
        ax6.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 7: ATR ──
        tr_atr = np.maximum(self.h[1:] - self.l[1:],
                            np.maximum(np.abs(self.h[1:] - self.c[:-1]),
                                       np.abs(self.l[1:] - self.c[:-1])))
        atr_vals = pd.Series(tr_atr).rolling(14).mean().values
        pad_atr = len(dates) - len(atr_vals)
        atr_full = np.concatenate([np.full(pad_atr, np.nan), atr_vals]) if pad_atr >= 0 else atr_vals[-len(dates):]
        if len(atr_full) == len(dates):
            ax7.plot(xnum, atr_full, color='#f0883e', linewidth=1.2, label='ATR(14)')
            # Percent of price
            atr_pct = atr_full / self.c * 100
            ax7b = ax7.twinx()
            ax7b.plot(xnum, atr_pct, color='#8b949e', linewidth=0.7, alpha=0.5, linestyle=':')
            ax7b.set_ylabel('ATR %', color='#8b949e')
        ax7.set_ylabel('ATR (₹)', color='#c9d1d9')
        ax7.legend(loc='upper left', fontsize=7)
        ax7.grid(True, alpha=0.08, color='#30363d')

        # ── Panel 8: Gann Fan Lines ──
        for line in self.a.get('gann_fan_lines', []):
            idx0 = line['pivot_idx']
            if idx0 < len(dates):
                price0 = line['pivot_price']
                price1 = line['end_price']
                ax8.plot([xnum[idx0], len(dates) - 1], [price0, price1],
                         linewidth=0.8, alpha=0.5, label=line['name'] if len(self.a.get('gann_fan_lines', [])) < 8 else '')
        # Plot price reference on gann panel
        ax8.plot(xnum, self.c, color='#f0f6fc', linewidth=1.5, alpha=0.9)
        ax8.set_ylabel('Gann Fan', color='#c9d1d9')
        ax8.legend(loc='upper left', fontsize=6, ncol=2)
        ax8.grid(True, alpha=0.08, color='#30363d')

        # ── Date tick labels on the numeric x-axis (bottom panel) ──
        n_ticks = 8
        step = max(1, len(dates) // n_ticks)
        tick_pos = list(range(0, len(dates), step))
        tick_labels = [str(dates[i].date()) if hasattr(dates[i], 'date') else str(dates[i]) for i in tick_pos]
        ax8.set_xticks(tick_pos)
        ax8.set_xticklabels(tick_labels, rotation=45, ha='right', fontsize=7, color='#8b949e')

        plt.tight_layout()
        plt.savefig(filepath, dpi=150, bbox_inches='tight')
        plt.close(fig)
        log.info(f"Chart saved: {filepath}")


# ────────────────────────────────────────────────────────────
# MODULE 12: Report Builder
# ────────────────────────────────────────────────────────────

class ReportBuilder:
    """Build formatted Market Analysis Report."""

    def __init__(self, result: AnalysisResult, analysis: dict,
                 now: Optional[datetime] = None):
        self.r = result
        self.a = analysis
        self.lines = []
        self._now = now

    def _fmt(self, val, suffix=''):
        """Safely format a possibly-NaN/None/inf value for display.

        Returns 'N/A' for None/NaN/inf so "₹nan" can never appear in reports.
        """
        if val is None:
            return 'N/A'
        try:
            v = float(val)
            if math.isnan(v) or math.isinf(v):
                return 'N/A'
            return f'{v:.2f}{suffix}'
        except (TypeError, ValueError):
            return str(val)

    def _p(self, s=""):
        self.lines.append(s)

    def _sec_val(self, section: dict, key: str, year: str) -> str:
        """Safely read a year value from a section field that may be a dict or 'N/A' string."""
        v = section.get(key, 'N/A')
        if isinstance(v, dict):
            return v.get(year, 'N/A')
        return v

    def build(self) -> str:
        """Build the full report."""
        r = self.r
        a = self.a

        self._p("╔══════════════════════════════════════════════════════════════════╗")
        self._p(f"║           MARKET ANALYSIS REPORT                                ║")
        self._p(f"╠══════════════════════════════════════════════════════════════════╣")
        self._p(f"║ Instrument:  {r.ticker:<57s}║")
        self._p(f"║ Period:      {r.period:<57s}║")
        self._p(f"║ Date:        {(self._now or datetime.now()).strftime('%Y-%m-%d %H:%M'):<57s}║")
        self._p(f"║ Price:       ₹{self._fmt(r.df['Close'].iloc[-1]):<10s}{'':44s}║" if r.df is not None else "")
        self._p("╚══════════════════════════════════════════════════════════════════╝")
        self._p()

        # ── 1. Market Structure ──
        ms = a.get('structure', {})
        self._p("1. MARKET STRUCTURE")
        self._p(f"   Structure:       {ms.get('structure', 'N/A')}")
        self._p(f"   HH: {ms.get('hh')}  HL: {ms.get('hl')}  LH: {ms.get('lh')}  LL: {ms.get('ll')}")
        if ms.get('choch'): self._p(f"   ⚠ CHOCH: {ms['choch']}")
        if ms.get('bos_high') or ms.get('bos_low'):
            bos_str = ''
            if ms.get('bos_high'):
                bos_str += f"High @ {ms['bos_high']}"
            if ms.get('bos_high') and ms.get('bos_low'):
                bos_str += ' / '
            if ms.get('bos_low'):
                bos_str += f"Low @ {ms['bos_low']}"
            self._p(f"   BOS: {bos_str}")
        self._p()

        # ── 2. Trend ──
        trend = a.get('trend', {})
        self._p("2. TREND ANALYSIS")
        ma = a.get('ma', {})
        for name, val in [('SMA20', ma.get('sma20')), ('SMA50', ma.get('sma50')), ('SMA200', ma.get('sma200'))]:
            above = ma.get(f'above_{name[3:].lower()}', False)
            dist = ma.get(f'price_vs_{name[3:].lower()}', 0)
            symbol = '✅' if above else '❌'
            self._p(f"   Price vs {name}: ₹{self._fmt(val)} ({self._fmt(dist, '%')}) {symbol}")
        if ma.get('golden_cross'): self._p("   ⭐ Golden Cross (20×50 SMA)")
        if ma.get('death_cross'): self._p("   ⚠ Death Cross (20×50 SMA)")
        adx_data = a.get('adx', {})
        self._p(f"   ADX(14): {self._fmt(adx_data.get('adx'))} ({adx_data.get('strength', 'N/A')})")
        self._p(f"   +DI: {self._fmt(adx_data.get('plus_di'))}  -DI: {self._fmt(adx_data.get('minus_di'))} | Bias: {adx_data.get('di_bias', 'N/A')}")
        self._p()

        # ── 3. Key Levels ──
        self._p("3. KEY LEVELS")
        sr = a.get('sr_levels', {})
        for side, label, sym in [('resistance', 'Resistance', '🔴'), ('support', 'Support', '🟢')]:
            levels = sr.get(side, [])
            if levels:
                level_str = ' | '.join([f"₹{l['price']:.2f} ({l['strength']}, {l.get('touches', 1)}x)" for l in levels[-5:]])
                self._p(f"   {label}: {level_str}")

        fib = a.get('fib_retracement', {})
        if fib and 'levels' in fib:
            self._p(f"   Fibonacci (swing: ₹{self._fmt(fib.get('swing_high'))} → ₹{self._fmt(fib.get('swing_low'))}):")
            for lbl, info in fib['levels'].items():
                marker = ' ← CURRENT' if info.get('closest') else ''
                self._p(f"     {lbl:>6s}: ₹{self._fmt(info['level'])} ({self._fmt(info['distance_pct'], '%')}){marker}")

        pp = a.get('pivot_points', {})
        if pp:
            self._p(f"   Classic Pivots: PP={pp.get('PP')} R1={pp.get('R1')} R2={pp.get('R2')} R3={pp.get('R3')}")
            self._p(f"                    S1={pp.get('S1')} S2={pp.get('S2')} S3={pp.get('S3')}")
        self._p()

        # ── 4. Indicators ──
        self._p("4. INDICATOR CONFLUENCE")
        rsi_data = a.get('rsi', {})
        macd_data = a.get('macd', {})
        bb_data = a.get('bb', {})
        atr_data = a.get('atr', {})
        obv_data = a.get('obv_raw', {})
        vol_data = a.get('volume', {})

        self._p(f"   RSI(14):       {self._fmt(rsi_data.get('value'))} — {rsi_data.get('status', 'N/A')}")
        self._p(f"   MACD:          {self._fmt(macd_data.get('macd'))} / {self._fmt(macd_data.get('signal'))} — {macd_data.get('crossover', 'N/A')}")
        self._p(f"   Histogram:     {self._fmt(macd_data.get('histogram'))} {'↑' if macd_data.get('histogram_increasing') else '↓'}")
        self._p(f"   ADX(14):       {self._fmt(adx_data.get('adx'))} — {adx_data.get('strength', 'N/A')}")
        self._p(f"   ATR(14):       ₹{self._fmt(atr_data.get('atr'))} ({self._fmt(atr_data.get('percent_of_price'), '%')}) — {atr_data.get('regime', 'N/A')}")
        self._p(f"   BB(20,2):      %B={self._fmt(bb_data.get('percent_b'), '%')} BW={self._fmt(bb_data.get('bandwidth'), '%')} {'(Squeeze)' if bb_data.get('squeeze') else ''}")
        self._p(f"   OBV:           {obv_data.get('obv_trend', 'N/A')} {'⚠ ' + str(obv_data.get('divergence', '')) if obv_data.get('divergence') else ''}")
        self._p(f"   Volume:        {vol_data.get('status', 'N/A')} ({self._fmt(vol_data.get('volume_ratio_vs_20'), 'x')} vs 20MA)")
        self._p()

        # ── 5. Candlestick ──
        cs = a.get('candlestick', {})
        self._p("5. CANDLESTICK ANALYSIS")
        self._p(f"   Last Candle:    {cs.get('last_candle', 'N/A')}")
        self._p(f"   Pattern:        {cs.get('last_pattern', 'None')}")
        if cs.get('details'):
            last = cs['details'][-1]
            self._p(f"   Body: ₹{self._fmt(last.get('body'))}  UW: ₹{self._fmt(last.get('upper_wick'))}  LW: ₹{self._fmt(last.get('lower_wick'))}")
        self._p()

        # ── 6. Multi-Timeframe ──
        mtf = a.get('mtf', {})
        self._p("6. MULTI-TIMEFRAME ANALYSIS")
        for tf in ['daily', 'weekly', 'monthly']:
            data = mtf.get(tf, {})
            if data.get('rsi') is not None:
                self._p(f"   {tf.title():>7s}: RSI={data['rsi']} MACD={data.get('macd_crossover', 'N/A')}")
        self._p()

        # ── 7. Wyckoff / ICT ──
        w = a.get('wyckoff', {})
        self._p("7. WYCKOFF / ICT INSTITUTIONAL ANALYSIS")
        phase = w.get('wyckoff_phase', {})
        self._p(f"   Wyckoff Phase:  {phase.get('phase', 'N/A')} (confidence: {phase.get('confidence', 0)}%)")
        self._p(f"   Price Trend:    {phase.get('price_trend_pct', 0):+.1f}%  Vol Trend: {phase.get('vol_trend_pct', 0):+.1f}%")
        obs = w.get('order_blocks', [])
        self._p(f"   Order Blocks:   {len(obs)} found ({sum(1 for o in obs if 'Bullish' in o['type'])} bullish, {sum(1 for o in obs if 'Bearish' in o['type'])} bearish)")
        fvgs = w.get('fair_value_gaps', [])
        self._p(f"   Fair Value Gaps: {len(fvgs)} found")
        sweeps = w.get('liquidity_sweeps', [])
        self._p(f"   Liquidity Sweeps: {len(sweeps)} found")
        springs = w.get('springs_upthrusts', [])
        self._p(f"   Springs/Upthrusts: {len(springs)} found")
        self._p()

        # ── 8. Gann ──
        g = a.get('gann', {})
        self._p("8. GANN / CYCLE ANALYSIS")
        cycles = g.get('cycles', {})
        if cycles.get('cycles_detected'):
            self._p(f"   FFT Dominant Period: {cycles.get('fft_dominant_period', 'N/A')} days")
            self._p(f"   Autocorr Peak Lag: {cycles.get('autocorr_peak_lag', 'N/A')} days")
        else:
            self._p("   Cycles: Not detected (insufficient data)")
        fan_lines = g.get('gann_fan', [])
        if fan_lines:
            self._p(f"   Gann Fan: {len(fan_lines)} lines from pivot ₹{fan_lines[0].get('pivot_price', 0):.2f}")
        sq9 = g.get('square_of_9', {})
        if sq9:
            self._p(f"   Square of 9: {len(sq9)} levels computed")
        self._p()

        # ── 9. Options ──
        opts = a.get('options', {})
        self._p("9. OPTIONS STRATEGIES")
        if opts.get('status') == 'OK':
            self._p(f"   Expiry: {opts.get('expiry')} ({opts.get('dte')} DTE)")
            self._p(f"   IV: {opts.get('iv', 0):.1f}%  HV: {opts.get('hv', 0):.1f}%  Rank: {opts.get('iv_rank', 'N/A')}")
            if opts.get('atm_call'):
                cg = opts['atm_call']
                self._p(f"   ATM Call: ₹{cg.get('price', 0):.2f} Δ={cg.get('delta', 0):.2f} Γ={cg.get('gamma', 0):.4f} Θ={cg.get('theta', 0):.4f}")
            if opts.get('atm_put'):
                pg = opts['atm_put']
                self._p(f"   ATM Put:  ₹{pg.get('price', 0):.2f} Δ={pg.get('delta', 0):.2f} Γ={pg.get('gamma', 0):.4f} Θ={pg.get('theta', 0):.4f}")
            for strat in opts.get('strategies', []):
                self._p(f"   → {strat['name']}: {strat.get('description', '')}")
        else:
            self._p(f"   {opts.get('status', 'No options data')}")
        self._p()

        # ── 10. Fundamentals (22-Section Comprehensive) ──
        fund = a.get('fundamentals', {})
        self._p("10. FUNDAMENTALS (22-SECTION COMPREHENSIVE ANALYSIS)")
        if fund and 'metadata' in fund and not fund.get('error'):
            meta = fund.get('metadata', {})
            self._p(f"   Generated: {meta.get('generated_at', 'N/A')}")
            self._p(f"   Source: {meta.get('data_source', 'yfinance')}")
            manual_count = meta.get('manual_overrides_applied', 0)
            if manual_count:
                self._p(f"   ⚡ Manual Overrides: {manual_count} field(s) applied "
                        f"({', '.join(meta.get('manual_overrides_sections', {}).keys())})")

            # Quick ratings summary
            qr = fund.get('quick_ratings', {})
            if qr:
                self._p(f"   ═══════════════════════════════════════════")
                self._p(f"   Screening: {qr.get('screening_rating', 'N/A')}   |   Risk: {qr.get('risk_rating', 'N/A')}   |   Moat: {qr.get('moat_rating', 'N/A')}   |   Analyst: {qr.get('analyst_rating', 'N/A')}")
                self._p(f"   ═══════════════════════════════════════════")

            # Section 01 - Company Overview
            s01 = fund.get('section_01_company_overview', {})
            if s01:
                self._p("   ── 01 Company Overview ──")
                for key in ['company_name', 'sector', 'industry', 'country', 'city',
                            'website', 'full_time_employees', 'exchange', 'currency']:
                    if key in s01 and s01[key] != 'N/A':
                        self._p(f"      {key.replace('_', ' ').title():20s}: {s01[key]}")
                if s01.get('business_summary'):
                    bs = s01['business_summary'][:200] + '...' if len(s01.get('business_summary', '')) > 200 else s01.get('business_summary', '')
                    self._p(f"      Summary: {bs}")

            # Section 02 - Business Quality
            s02 = fund.get('section_02_business_quality', {})
            if s02:
                self._p("   ── 02 Business Quality & Moat ──")
                self._p(f"      Moat Rating:     {s02.get('moat_rating', 'N/A')}")
                for ind in s02.get('moat_indicators', [])[:3]:
                    self._p(f"      • {ind}")
                self._p(f"      Business Model:  {s02.get('business_model_type', 'N/A')}")

            # Section 03 - Management
            s03 = fund.get('section_03_management', {})
            if s03:
                self._p("   ── 03 Management & Governance ──")
                self._p(f"      Promoter Holding: {s03.get('promoter_holding_pct', 'N/A')}%")
                self._p(f"      Insider Holding:  {s03.get('insider_holding_pct', 'N/A')}%")
                self._p(f"      Board Members:    {s03.get('board_members_count', 'N/A')}")
                officers = s03.get('key_officers', [])
                for off in officers[:3]:
                    if isinstance(off, dict):
                        self._p(f"      • {off.get('name', '')} - {off.get('title', '')}")

            # Section 04 - Shareholding
            s04 = fund.get('section_04_shareholding', {})
            if s04:
                self._p("   ── 04 Shareholding Pattern ──")
                self._p(f"      Promoter:          {s04.get('promoter_group_pct', 'N/A')}%")
                self._p(f"      FII/FII:           {s04.get('fil_fii_pct', 'N/A')}%")
                self._p(f"      Institutions:      {s04.get('institution_count', 'N/A')}")
                self._p(f"      Note: {s04.get('source_note', '')[:100]}")

            # Section 05 - P&L
            s05 = fund.get('section_05_pl', {})
            if s05 and 'total_revenue' in s05:
                self._p("   ── 05 Profit & Loss (INR Cr, latest year) ──")
                if isinstance(s05.get('total_revenue'), dict):
                    years = list(s05['total_revenue'].keys())
                    if years:
                        latest_yr = years[0]
                        self._p(f"      Total Revenue:    ₹{s05['total_revenue'].get(latest_yr, 'N/A'):>12,.2f} Cr")
                        self._p(f"      Net Interest Inc: ₹{self._sec_val(s05, 'net_interest_income', latest_yr)} Cr")
                        self._p(f"      Pretax Income:    ₹{s05['pretax_income'].get(latest_yr, 'N/A')} Cr" if 'pretax_income' in s05 and isinstance(s05.get('pretax_income'), dict) else "")
                        self._p(f"      Net Income:       ₹{s05['net_income'].get(latest_yr, 'N/A')} Cr" if 'net_income' in s05 and isinstance(s05.get('net_income'), dict) else "")
                        self._p(f"      Diluted EPS:      ₹{s05['diluted_eps'].get(latest_yr, 'N/A')}" if 'diluted_eps' in s05 and isinstance(s05.get('diluted_eps'), dict) else "")
                        self._p(f"      Basic EPS:        ₹{s05['basic_eps'].get(latest_yr, 'N/A')}" if 'basic_eps' in s05 and isinstance(s05.get('basic_eps'), dict) else "")

            # Section 06 - Balance Sheet
            s06 = fund.get('section_06_balance_sheet', {})
            if s06 and 'total_assets' in s06:
                self._p("   ── 06 Balance Sheet (INR Cr) ──")
                if isinstance(s06.get('total_assets'), dict):
                    years = list(s06['total_assets'].keys())
                    if years:
                        ly = years[0]
                        self._p(f"      Total Assets:     ₹{s06['total_assets'].get(ly, 'N/A')} Cr")
                        self._p(f"      Total Liabilities: ₹{self._sec_val(s06, 'total_liabilities', ly)} Cr")
                        self._p(f"      Stockholders Eq:  ₹{self._sec_val(s06, 'stockholders_equity', ly)} Cr")
                        self._p(f"      Total Debt:       ₹{self._sec_val(s06, 'total_debt', ly)} Cr")
                        self._p(f"      Cash & Equiv:     ₹{self._sec_val(s06, 'cash_equivalents', ly)} Cr")
                        if s06.get('book_value_per_share') and isinstance(s06['book_value_per_share'], dict):
                            self._p(f"      Book Value/Share: ₹{s06['book_value_per_share'].get(ly, 'N/A')}")

            # Section 07 - Cash Flow
            s07 = fund.get('section_07_cashflow', {})
            if s07 and 'operating_cashflow' in s07:
                self._p("   ── 07 Cash Flow (INR Cr) ──")
                if isinstance(s07.get('operating_cashflow'), dict):
                    years = list(s07['operating_cashflow'].keys())
                    if years:
                        ly = years[0]
                        self._p(f"      Operating CF:     ₹{s07['operating_cashflow'].get(ly, 'N/A')} Cr")
                        self._p(f"      Free Cash Flow:   ₹{self._sec_val(s07, 'free_cashflow', ly)} Cr")
                        self._p(f"      Capex:            ₹{self._sec_val(s07, 'capital_expenditure', ly)} Cr")
                        self._p(f"      Dividends Paid:   ₹{self._sec_val(s07, 'dividends_paid', ly)} Cr")

            # Section 08 - Ratios
            s08 = fund.get('section_08_ratios', {})
            if s08:
                self._p("   ── 08 Financial Ratios ──")
                for key, label in [('return_on_equity', 'ROE'), ('return_on_assets', 'ROA'),
                                   ('profit_margin', 'Profit Margin'), ('operating_margin', 'Op Margin'),
                                   ('debt_to_equity', 'Debt/Equity'), ('current_ratio', 'Current Ratio'),
                                   ('pe_ttm', 'P/E (TTM)'), ('forward_pe', 'Forward P/E'),
                                   ('peg_ratio', 'PEG Ratio'), ('price_to_book', 'P/B'),
                                   ('dividend_yield', 'Div Yield'), ('payout_ratio', 'Payout Ratio')]:
                    if key in s08 and s08[key] != 'N/A':
                        self._p(f"      {label:<16s}: {s08[key]}")

            # Section 09 - Growth
            s09 = fund.get('section_09_growth', {})
            if s09:
                self._p("   ── 09 Growth Metrics ──")
                for key, label in [('revenue_growth_ttm', 'Rev Growth TTM'), ('earnings_growth_ttm', 'Earnings Growth TTM'),
                                   ('earnings_quarterly_growth', 'Earnings QoQ'), ('revenue_yoy_1yr', 'Revenue YoY'),
                                   ('net_income_yoy_1yr', 'Net Income YoY'), ('eps_yoy_1yr', 'EPS YoY')]:
                    if key in s09 and s09[key] != 'N/A':
                        self._p(f"      {label:<20s}: {s09[key]}")

            # Section 10 - Earnings
            s10 = fund.get('section_10_earnings', {})
            if s10:
                self._p("   ── 10 Earnings Analysis ──")
                self._p(f"      EPS Current Year: {s10.get('eps_current_year', 'N/A')}")
                self._p(f"      EPS Forward:       {s10.get('eps_forward', 'N/A')}")
                self._p(f"      EPS TTM:           {s10.get('eps_ttm', 'N/A')}")

            # Section 11 - Dividends
            s11 = fund.get('section_11_dividends', {})
            if s11:
                self._p("   ── 11 Dividend Analysis ──")
                self._p(f"      Dividend Rate:    {s11.get('dividend_rate', 'N/A')}")
                self._p(f"      Dividend Yield:   {s11.get('dividend_yield', 'N/A')}")
                self._p(f"      Payout Ratio:     {s11.get('payout_ratio', 'N/A')}")
                self._p(f"      5Y Avg Yield:    {s11.get('five_year_avg_div_yield', 'N/A')}")

            # Section 12 - Valuation
            s12 = fund.get('section_12_valuation', {})
            if s12:
                self._p("   ── 12 Valuation ──")
                self._p(f"      Current Price:    ₹{s12.get('current_price', 'N/A')}")
                self._p(f"      Market Cap:       {s12.get('market_cap', 'N/A')}")
                self._p(f"      Enterprise Value: {s12.get('enterprise_value', 'N/A')}")
                self._p(f"      P/E: {s12.get('pe_ttm', 'N/A')}  Fwd P/E: {s12.get('forward_pe', 'N/A')}  PEG: {s12.get('peg_ratio', 'N/A')}")
                self._p(f"      P/B: {s12.get('price_to_book', 'N/A')}  P/S: {s12.get('price_to_sales', 'N/A')}  EV/Rev: {s12.get('ev_to_revenue', 'N/A')}")
                self._p(f"      Analyst Target:   ₹{s12.get('analyst_target_mean', 'N/A')} (Range: ₹{s12.get('analyst_target_low', 'N/A')} - ₹{s12.get('analyst_target_high', 'N/A')})")
                self._p(f"      Upside:           {s12.get('analyst_upside', 'N/A')}")
                self._p(f"      Rating:           {s12.get('analyst_rating', 'N/A')} ({s12.get('analyst_count', 'N/A')} analysts)")

            # Section 13 - Industry
            s13 = fund.get('section_13_industry', {})
            if s13:
                self._p("   ── 13 Industry & Peer Context ──")
                self._p(f"      Sector: {s13.get('sector', 'N/A')}   Industry: {s13.get('industry', 'N/A')}")
                peers = s13.get('peers_mentioned', [])
                if peers and isinstance(peers, list) and peers[0] != 'Requires manual research':
                    self._p(f"      Peers: {', '.join(peers[:5])}")

            # Section 14 - Economic Sensitivity
            s14 = fund.get('section_14_economic_sensitivity', {})
            if s14:
                self._p("   ── 14 Economic Sensitivity ──")
                self._p(f"      Beta: {s14.get('beta', 'N/A')} ({s14.get('beta_category', 'N/A')})")
                self._p(f"      Interest Rate:    {s14.get('interest_rate_sensitivity', 'N/A')}")
                self._p(f"      Regulatory:      {s14.get('regulatory_sensitivity', 'N/A')}")

            # Section 15 - Risk
            s15 = fund.get('section_15_risk', {})
            if s15:
                self._p("   ── 15 Risk Assessment ──")
                self._p(f"      Risk Rating:      {s15.get('risk_rating', 'N/A')}")
                for flag in s15.get('risk_flags', [])[:4]:
                    self._p(f"      • {flag}")

            # Section 16 - Corporate Actions
            s16 = fund.get('section_16_corporate_actions', {})
            if s16:
                self._p("   ── 16 Corporate Actions ──")
                splits = s16.get('stock_splits', {})
                if isinstance(splits, dict) and splits:
                    self._p(f"      Last Split: {s16.get('last_split_date', 'N/A')} ({s16.get('last_split_factor', 'N/A')})")
                self._p(f"      Dividend Count (5Y): {s16.get('dividend_count_5yr', 'N/A')}")
                self._p(f"      Dividend Trend:      {s16.get('dividend_growth', 'N/A')}")

            # Section 17 - Quarterly Detail
            s17 = fund.get('section_17_quarterly_detail', {})
            if s17 and 'Total Revenue' in s17:
                self._p("   ── 17 Quarterly Results Detail ──")
                if isinstance(s17.get('Total Revenue'), dict):
                    q_years = list(s17['Total Revenue'].keys())
                    if q_years:
                        self._p(f"      Latest Q Rev:    ₹{s17['Total Revenue'].get(q_years[0], 'N/A')} Cr")
                        self._p(f"      Latest Q Net Inc: ₹{s17['Net Income Common Stockholders'].get(q_years[0], 'N/A')} Cr" if 'Net Income Common Stockholders' in s17 and isinstance(s17.get('Net Income Common Stockholders'), dict) else "")
                        self._p(f"      QoQ Rev Growth:  {s17.get('revenue_qoq_growth', 'N/A')} (YoY: {s17.get('revenue_yoy_growth', 'N/A')})")
                        self._p(f"      QoQ NI Growth:   {s17.get('net_income_qoq_growth', 'N/A')} (YoY: {s17.get('net_income_yoy_growth', 'N/A')})")
                        # Seasonal note: negative QoQ but positive YoY often
                        # reflects a seasonally weak quarter (e.g. defense Q1).
                        try:
                            qoq = float(str(s17.get('revenue_qoq_growth', 'N/A')).rstrip('%'))
                            yoy = float(str(s17.get('revenue_yoy_growth', 'N/A')).rstrip('%'))
                            if qoq < 0 and yoy > 0:
                                self._p(f"      Note: QoQ decline with positive YoY — seasonal (Q1 is typically the weakest quarter)")
                        except (TypeError, ValueError):
                            pass

            # Section 18 - Annual Report
            s18 = fund.get('section_18_annual_report', {})
            if s18:
                self._p("   ── 18 Annual Report Summary ──")
                self._p(f"      FY End: {s18.get('fiscal_year_end', 'N/A')}   MRQ: {s18.get('most_recent_quarter', 'N/A')}")
                segments = s18.get('key_business_segments', [])
                if segments and isinstance(segments, list):
                    self._p(f"      Segments: {', '.join(segments)}")

            # Section 19 - Conference Call
            s19 = fund.get('section_19_conference_call', {})
            if s19:
                self._p("   ── 19 Conference Call / MD&A ──")
                self._p(f"      Last Call: {s19.get('last_earnings_call', 'N/A')}")
                self._p(f"      Note: {s19.get('notes', 'Requires manual review')}")

            # Section 20 - News
            s20 = fund.get('section_20_news', {})
            if s20:
                self._p("   ── 20 News & Sentiment ──")
                articles = s20.get('articles', [])
                if articles and isinstance(articles, list) and 'No recent news' not in str(articles[0]):
                    for art in articles[:3]:
                        if isinstance(art, dict):
                            self._p(f"      • {art.get('title', 'N/A')[:80]} - {art.get('publisher', 'N/A')}")
                else:
                    self._p(f"      {s20.get('source_note', 'No news available')[:120]}")

            # Section 21 - Screening Score
            s21 = fund.get('section_21_screening', {})
            if s21:
                self._p("   ── 21 Screening Score ──")
                self._p(f"      Score: {s21.get('total_score', 0)}/{s21.get('max_score', 100)} ({s21.get('score_percentage', 'N/A')}%)")
                self._p(f"      Rating: {s21.get('rating', 'N/A')}")
                factors = s21.get('factor_breakdown', {})
                if factors:
                    self._p(f"      Factors: Value={factors.get('value_pe_pb', 0)} Growth={factors.get('growth', 0)} "
                            f"Prof={factors.get('profitability_roe_margins', 0)} Mom={factors.get('momentum', 0)} "
                            f"Analyst={factors.get('analyst_sentiment', 0)} Risk={factors.get('risk_beta_debt', 0)}")

            # Section 22 - Investment Suitability
            s22 = fund.get('section_22_suitability', {})
            if s22:
                self._p("   ── 22 Investment Suitability ──")
                self._p(f"       Overall: {s22.get('overall_rating', 'N/A')} | {s22.get('market_cap_category', 'N/A')}")
                self._p(f"       Horizon: {s22.get('suggested_investment_horizon', 'N/A')} | Allocation: {s22.get('suggested_allocation', 'N/A')}")
                self._p(f"       Detail:  {s22.get('detail', 'N/A')}")
                strengths = s22.get('key_strengths', [])
                for s in strengths[:3]:
                    self._p(f"       ✓ {s}")
                concerns = s22.get('key_concerns', [])
                for c in concerns[:3]:
                    self._p(f"       ⚠ {c}")

            self._p(f"   Note: {meta.get('manual_fields', '')[:150]}")

        elif fund and fund.get('error'):
            self._p(f"   Error: {fund['error']}")
        else:
            self._p(f"   No fundamental data available")
        self._p()

        # ── 11. Divergence ──
        divs = a.get('divergence', [])
        self._p("11. DIVERGENCE DETECTION")
        if divs:
            for d in divs:
                self._p(f"   ⚠ {d['type']} — {d['source']} at price ₹{d.get('price_level', 0):.2f}")
        else:
            self._p("   No significant divergences detected")
        self._p()

        # ── 12. Signal ──
        self._p("12. SIGNAL")
        self._p(f"   ACTION: {r.signal}")
        if r.entry_zone[0] and r.entry_zone[1]:
            self._p(f"   Entry Zone: ₹{self._fmt(r.entry_zone[0])} - ₹{self._fmt(r.entry_zone[1])}")
        if r.targets:
            targets_str = ' / '.join([f"₹{self._fmt(t)}" for t in r.targets])
            self._p(f"   Targets: {targets_str}")
        if r.invalidation:
            self._p(f"   Invalidation: Close below ₹{self._fmt(r.invalidation)}")
        if getattr(r, 'quality_gates', None):
            self._p("   Quality Gates:")
            for g in r.quality_gates:
                self._p(f"     ⚠ {g}")
        self._p()

        # ── 13. Confidence ──
        self._p("13. CONFIDENCE ASSESSMENT")
        self._p(f"   Confidence: {self._fmt(r.confidence, '%')}")
        evidence = []
        ms_str = ms.get('structure', '')
        if 'Uptrend' in ms_str: evidence.append("Uptrending market structure")
        if 'Downtrend' in ms_str: evidence.append("Downtrending market structure")
        if ma.get('above_50'): evidence.append("Price above SMA50")
        if ma.get('above_200'): evidence.append("Price above SMA200")
        if macd_data.get('crossover') == 'Bullish': evidence.append("MACD bullish crossover")
        if rsi_data.get('value', 50) > 50: evidence.append(f"RSI bullish at {rsi_data['value']:.1f}")
        if adx_data.get('adx', 0) > 25: evidence.append(f"Strong trend (ADX {adx_data['adx']:.1f})")
        if vol_data.get('status') == 'Above Avg': evidence.append("Above-average volume confirmation")
        if obv_data.get('obv_trend') == 'Bullish': evidence.append("OBV bullish")
        if phase.get('phase') in ('Markup', 'Accumulation'): evidence.append(f"Wyckoff {phase['phase']}")
        if divs: evidence.append(f"{len(divs)} divergence(s) detected")

        for e in evidence[:8]:
            self._p(f"   ✓ {e}")

        self._p()
        self._p("   Alternative Scenarios:")
        self._p("   Bullish: Break above nearest resistance with volume → continuation")
        self._p("   Bearish: Rejection at resistance / RSI exhaustion → pullback to support")
        self._p("   Neutral: Consolidation in current range waiting for catalyst")

        # ── 14. Quantamental Fusion ──
        qm = r.quantamental
        if qm and qm.get('blended_rating'):
            self._p()
            self._p("14. QUANTAMENTAL FUSION")
            br = qm['blended_rating']
            bs = qm['blended_score']
            tech_s = qm['technical_signal']
            tech_c = qm['technical_confidence']
            fund_r = qm['fundamental_rating']
            fund_s = qm['fundamental_score']
            tw = qm['weights']['technical'] * 100
            fw = qm['weights']['fundamental'] * 100
            cap_cat = qm['market_cap_category']

            self._p(f"   ════════════════════════════════════════════")
            self._p(f"   QUANTAMENTAL RATING: {br} ({bs:.1f}/100)")
            self._p(f"   ════════════════════════════════════════════")
            self._p(f"   Market Cap Category: {cap_cat.capitalize()} Cap")
            self._p(f"   Weighting:           {tw:.0f}% Technical / {fw:.0f}% Fundamental")
            if qm.get('weight_adjustments'):
                for adj in qm['weight_adjustments'][:3]:
                    self._p(f"   Adjustment:          {adj}")
            self._p()
            self._p(f"   ── Component Breakdown ──")
            tech_score_val = qm.get('technical_score', 0)
            self._p(f"   Technical:   {tech_s} (confidence: {tech_c}%, score: {tech_score_val:.1f})")
            self._p(f"   Fundamental: {fund_r} (screening score: {fund_s:.1f})")
            sent_label = qm.get('sentiment_label', '')
            sent_score = qm.get('sentiment_score', 0)
            if sent_label:
                sent_articles = qm.get('sentiment_article_count', 0)
                self._p(f"   Sentiment:   {sent_label} ({sent_score:+.3f}) — {sent_articles} articles")
            self._p()
            self._p(f"   ── Evidence ──")
            tech_ev = qm.get('evidence', {}).get('technical', [])
            for e in tech_ev[:4]:
                self._p(f"   [T] {e}")
            fund_ev = qm.get('evidence', {}).get('fundamental', [])
            for e in fund_ev[:4]:
                self._p(f"   [F] {e}")
            if abs(tech_score_val - fund_s) > 30:
                self._p(f"   [!] Note: Significant divergence between technical ({tech_score_val:.0f}) and "
                        f"fundamental ({fund_s:.0f}) signals. Use caution.")
            self._p()

        return '\n'.join(self.lines)


# ────────────────────────────────────────────────────────────
# MAIN ORCHESTRATOR
# ────────────────────────────────────────────────────────────

class TechnicalAnalysisPipeline:
    """Orchestrate the full analysis pipeline."""

    def __init__(self, ticker: str, period: str = "1y", do_options: bool = False,
                 do_wyckoff: bool = True, do_gann: bool = True,
                 do_sentiment: bool = False, do_db: bool = False,
                 manual_overrides: Optional[dict] = None,
                 df_override: Optional[pd.DataFrame] = None,
                 do_fundamentals: bool = True,
                 now: Optional[datetime] = None,
                 fundamental_analyzer_cls: Optional[type] = None):
        self.ticker = ticker.upper()
        self.period = period
        self.do_options = do_options
        self.do_wyckoff = do_wyckoff
        self.do_gann = do_gann
        self.do_sentiment = do_sentiment
        self.do_db = do_db
        self.manual_overrides = manual_overrides or {}
        # Backtest mode: inject point-in-time OHLCV (no yfinance download).
        # MUST be a clean single-index DataFrame with Open/High/Low/Close/Volume
        # ending at the as-of date — prevents lookahead bias in backtests.
        self.df_override = df_override
        # Backtest purity: yfinance fundamentals are CURRENT-day only — using
        # them for historical signals leaks future info. Disable in backtests.
        self.do_fundamentals = do_fundamentals
        # Determinism seams (default None => live behaviour, unchanged):
        #   now — frozen clock threaded into timestamp-emitting components.
        #   fundamental_analyzer_cls — inject a pinned/offline analyzer.
        self._now = now
        self._fundamental_analyzer_cls = fundamental_analyzer_cls
        self.result = AnalysisResult(ticker=self.ticker, period=period)
        self._db = None

    def run(self) -> AnalysisResult:
        """Execute the full pipeline."""
        log.info(f"Running analysis for {self.ticker}...")

        # ── Data ──
        if self.df_override is not None:
            log.info(f"Using injected point-in-time data ({len(self.df_override)} rows)...")
            df = self.df_override.copy()
            if df.empty:
                log.error(f"Empty df_override for {self.ticker}")
                return self.result
        else:
            log.info("Fetching data...")
            df = yf.download(self.ticker, period=self.period, progress=False, auto_adjust=True)
            if df.empty:
                log.error(f"No data for {self.ticker}")
                return self.result

            # Flatten multi-index columns if needed
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = ['_'.join(col).strip() for col in df.columns.values]
                # Rename to standard
                rename_map = {}
                for col in df.columns:
                    for base in ['Open', 'High', 'Low', 'Close', 'Volume']:
                        if col.lower().startswith(base.lower()):
                            rename_map[col] = base
                            break
                df = df.rename(columns=rename_map)
                # Keep only OHLCV
                df = df[[c for c in ['Open', 'High', 'Low', 'Close', 'Volume'] if c in df.columns]]

        # ── Data cleaning: drop rows with NaN OHLCV ──
        # yfinance can return a FINAL ROW with NaN Close when the latest session
        # is incomplete (e.g. BEL.NS on 28-Aug-2026). If left in, the NaN
        # propagates into price, SMA/ADX/ATR and renders as "₹nan".
        if not df.empty:
            before = len(df)
            df = df.dropna(subset=['Open', 'High', 'Low', 'Close'])
            if len(df) < before:
                log.info(f"Dropped {before - len(df)} row(s) with NaN OHLCV for {self.ticker}")
        if df.empty:
            log.error(f"No valid OHLCV data for {self.ticker} after NaN cleanup")
            self.result.error = f"No valid OHLCV data for {self.ticker}"
            return self.result

        self.result.df = df
        # Defensive guard: never let the last close be NaN. Fall back to the
        # last valid close if it somehow still is.
        last_close = df['Close'].iloc[-1]
        if pd.isna(last_close):
            valid = df['Close'].dropna()
            last_close = valid.iloc[-1] if not valid.empty else float('nan')
        p = float(last_close)

        # ── Metrics Engine ──
        log.info("Computing indicators...")
        me = MetricsEngine(df)
        metrics, raw = me.run_all()
        self.result.__dict__.update(metrics)
        self.result._sma20 = raw['sma20']
        self.result._sma50 = raw['sma50']
        self.result._sma200 = raw['sma200']
        self.result._bb_upper = raw['bb_upper']
        self.result._bb_lower = raw['bb_lower']
        self.result._rsi_full = raw['rsi_full']
        self.result._macd_line = raw['macd_line']
        self.result._signal_line = raw['signal_line']
        self.result._hist = raw['hist']
        self.result._obv_line = raw['obv_line']

        # Build analysis dict
        analysis = {
            'ma': metrics['ma'],
            'rsi': metrics['rsi'],
            'macd': metrics['macd'],
            'bb': metrics['bb'],
            'adx': metrics['adx'],
            'atr': metrics['atr'],
            'obv_raw': metrics['obv_raw'],
            'volume': metrics['volume'],
            'raw': raw,
        }

        # ── Structure ──
        log.info("Analyzing market structure...")
        sa = StructureAnalyzer(df)
        struct, tlines, piv_high, piv_low = sa.analyze()
        analysis['structure'] = struct
        analysis['trendlines'] = tlines
        self.result._pivot_highs = piv_high
        self.result._pivot_lows = piv_low
        self.result.market_structure = struct
        self.result.trend = {'adx': metrics['adx'], 'ma': metrics['ma']}

        # ── Levels ──
        log.info("Finding key levels...")
        lf = LevelFinder(df)
        fib_ret, fib_ext, pivots, sr = lf.analyze(piv_high, piv_low)
        analysis['fib_retracement'] = fib_ret
        analysis['fib_extension'] = fib_ext
        analysis['pivot_points'] = pivots
        analysis['sr_levels'] = sr
        self.result.fibonacci = fib_ret
        self.result.pivot_points = pivots
        self.result.support_resistance = sr

        # ── Candlesticks ──
        log.info("Detecting candlestick patterns...")
        cd = CandlestickDetector(df)
        cs = cd.analyze_last()
        analysis['candlestick'] = cs

        # ── Divergence ──
        log.info("Checking divergences...")
        dfinder = DivergenceFinder(df, raw['rsi_full'], raw['macd_line'], raw['hist'], raw['obv_line'])
        divs = dfinder.analyze()
        analysis['divergence'] = divs
        self.result.divergence = divs

        # ── MTF ──
        log.info("Multi-timeframe analysis...")
        mtfa = MTFAnalyzer(df)
        mtf_data, weekly, monthly = mtfa.analyze()
        analysis['mtf'] = mtf_data
        self.result.weekly = weekly
        self.result.monthly = monthly
        self.result.mtf = mtf_data

        # ── Wyckoff ──
        if self.do_wyckoff:
            log.info("Wyckoff/ICT analysis...")
            sr_levels_prices = [l['price'] for l in sr.get('support', [])]
            rs_levels_prices = [l['price'] for l in sr.get('resistance', [])]
            wya = WyckoffICTAnalyzer(df)
            wyckoff_data, obs, fvgs, sweeps = wya.analyze(
                support_levels=sr_levels_prices, resistance_levels=rs_levels_prices)
            analysis['wyckoff'] = wyckoff_data
            analysis['obs'] = obs
            analysis['fvgs'] = fvgs
            analysis['sweeps'] = sweeps
            self.result.wyckoff = wyckoff_data
            self.result._order_blocks = obs
            self.result._fvgs = fvgs
            self.result._liquidity_sweeps = sweeps

        # ── Gann ──
        if self.do_gann:
            log.info("Gann/Cycle analysis...")
            gc = GannCycler(df)
            gann_data, fan_lines = gc.analyze()
            analysis['gann'] = gann_data
            analysis['gann_fan_lines'] = fan_lines
            self.result.gann = gann_data
            self.result._gann_fan_lines = fan_lines

        # ── Fundamentals (22-section comprehensive) ──
        if self.do_fundamentals:
            log.info("Running comprehensive fundamental analysis (22 sections)...")
            fa_cls = self._fundamental_analyzer_cls or FundamentalAnalyzer
            try:
                fa = fa_cls(self.ticker, manual_overrides=self.manual_overrides,
                            now=self._now)
            except TypeError:
                # Injected analyzer without a `now` parameter.
                fa = fa_cls(self.ticker, manual_overrides=self.manual_overrides)
            fund_data = fa.collect()
            analysis['fundamentals'] = fund_data
            self.result.fundamentals = fund_data

            # Store raw yfinance info for quantamental fusion
            self._yf_info = getattr(fa, 'info', {})
        else:
            log.info("Skipping fundamentals (backtest mode — no point-in-time data)")
            analysis['fundamentals'] = {}
            self.result.fundamentals = {}
            self._yf_info = {}

        # ── Sentiment Analysis (3rd pillar) ──
        sentiment_data = {}
        if self.do_sentiment and SentimentAnalyzer is not None:
            log.info("Analysing news sentiment...")
            try:
                sa = SentimentAnalyzer(self.ticker)
                sentiment_result = sa.analyze()
                sentiment_data = {
                    'score': sentiment_result.score,
                    'label': sentiment_result.label,
                    'article_count': sentiment_result.article_count,
                    'source': sentiment_result.source,
                    'confidence': sentiment_result.confidence,
                    'top_articles': sentiment_result.top_articles,
                }
                log.info(f"  Sentiment: {sentiment_result.label} ({sentiment_result.score:+.3f}) "
                         f"from {sentiment_result.article_count} articles")
            except Exception as e:
                log.warning(f"  Sentiment analysis error: {e}")
        analysis['sentiment'] = sentiment_data
        self.result.sentiment = sentiment_data

        # ── Options ──
        if self.do_options:
            log.info("Options analysis...")
            os_obj = OptionsStrategist(self.ticker, df)
            opts_data = os_obj.fetch_and_analyze()
            analysis['options'] = opts_data
            self.result.options = opts_data

        # ── Signal Classification ──
        log.info("Generating signal...")
        signal, confidence, entry_zone, targets, invalidation = self._classify_signal(analysis, p)
        self.result.signal = signal
        self.result.confidence = confidence
        self.result.entry_zone = entry_zone
        self.result.targets = targets
        self.result.invalidation = invalidation

        # ── Weighted convolution (2026-09-05) — computed BEFORE the blend so
        # the 50/50 technical/fundamental blend uses the convolution scores ──
        conv_tech = self._technical_convolution(analysis, p)
        conv_fund = self._fundamental_convolution(analysis.get('fundamentals', {}) or {})
        self.result.conv_technical = conv_tech
        self.result.conv_fundamental = conv_fund
        analysis['convolution'] = {'technical': conv_tech, 'fundamental': conv_fund}

        # ── Quantamental Fusion (with sentiment if available) ──
        qm = self._compute_quantamental(analysis, self.result, sentiment=sentiment_data or None)
        self.result.quantamental = qm
        analysis['quantamental'] = qm
        analysis['sentiment'] = sentiment_data

        # ── Rule-engine decision trace (observability; single source of truth) ──
        if HAS_RULES:
            try:
                _trace = _DecisionTrace()
                if getattr(self, '_rule_classify_outcome', None) is not None:
                    _trace.record(self._rule_classify_outcome)
                if getattr(self, '_rule_conv_outcome', None) is not None:
                    _trace.record(self._rule_conv_outcome)
                analysis['rule_trace'] = _trace.as_dict()
            except Exception as _e:
                log.warning(f"  rule_trace error: {_e}")

        # ── Final signal from quantamental blend ──
        # The technical signal is the primary driver, but the blended score
        # (tech + fundamentals + sentiment) is the decision signal so that
        # valuation/quality can veto a purely technical BUY.
        blended = qm.get('blended_score')
        if blended is not None:
            tech_signal = signal
            fund_score = qm.get('fundamental_score', 50) or 50
            fund_rating = str(qm.get('fundamental_rating', 'Hold') or 'Hold').strip().lower()
            if blended >= 65:
                # BUY requires fundamental confirmation. A strong technical
                # blend with only a neutral 'Hold' fundamental rating must not
                # produce a BUY — cap to HOLD (strong hold, not a buy).
                if fund_rating in ('buy', 'strong buy'):
                    signal = 'BUY'
                    confidence = int(round(blended))
                else:
                    signal = 'HOLD'
                    confidence = min(int(round(blended)), 60)
            elif blended <= 35:
                # Fundamentally broken names → AVOID (don't touch), not SELL
                # (SELL implies "exit a position"; AVOID means "never enter").
                if fund_score < 25:
                    signal = 'AVOID'
                else:
                    signal = 'SELL'
                confidence = int(round(blended))
            else:
                signal = 'HOLD'
                confidence = int(round(blended))
            self.result.technical_signal = tech_signal
            log.info(f"  Quantamental blend: {qm.get('blended_rating')} ({blended:.1f}) "
                     f"from technical {tech_signal}")

        # ── Confluence Confirmation Gate (multi-signal convolution) ──
        # Root cause of low accuracy: a single weak pattern fired a BUY with
        # no independent confirmation. Require >= MIN_CONFIRM of 4 independent
        # signals (trend, momentum, pattern, volume) before a BUY is
        # actionable; chop (ADX < 20, no trend) stands aside entirely.
        self.result.pre_gate_signal = signal
        # ── Convolution gate (uses conv_tech/conv_fund computed before the blend) ──
        # Chop guard (kept from the old gate — separate safety layer).
        ms = str(analysis.get('structure', {}).get('structure', ''))
        adx_v = analysis.get('adx', {}).get('adx', 0) or 0
        chop = (adx_v < 20) and ('Uptrend' not in ms) and ('Downtrend' not in ms)

        if signal in ('BUY', 'CAUTIOUS BUY'):
            if chop:
                signal = 'HOLD'
                confidence = min(confidence, 50)
                log.info(f"  Convolution gate: chop (ADX {adx_v:.0f} < 20, "
                         f"no trend) → HOLD")
            elif conv_tech['score'] < self.TECH_BUY_MIN:
                signal = 'HOLD'
                confidence = min(confidence, 55)
                log.info(f"  Convolution gate: BUY rejected "
                         f"(tech_conv {conv_tech['score']:.0f} < {self.TECH_BUY_MIN})")
            else:
                # Pattern-majority veto was REMOVED (2026-09-05): the 10y
                # backtest showed the 50 bearish-majority signals it rejected
                # had 59.2% WR / +1.45% avg — better than ungated. The score
                # threshold already enforces broad agreement (a single pattern
                # can't reach TECH_BUY_MIN). Vote stays visible for the UI.
                log.info(f"  Convolution gate: BUY confirmed "
                         f"(tech_conv {conv_tech['score']:.0f}, pattern vote "
                         f"bull {conv_tech['pattern_votes']['bull_weight']} vs "
                         f"bear {conv_tech['pattern_votes']['bear_weight']})")
        elif signal == 'SELL' and chop:
            signal = 'HOLD'
            confidence = min(confidence, 50)
            log.info(f"  Convolution gate: chop (ADX {adx_v:.0f} < 20, "
                     f"no trend) → HOLD")

        # ── Quality Gates (institutional filters) ──
        signal, confidence, gate_reasons = self._apply_quality_gates(signal, confidence, analysis, p)
        if gate_reasons:
            log.info(f"  Quality gates: {'; '.join(gate_reasons)}")
        self.result.signal = signal
        self.result.confidence = confidence
        self.result.quality_gates = gate_reasons
        analysis['quality_gates'] = gate_reasons

        # ── Persist to database ──
        if self.do_db and HAS_DB and AnalysisDatabase is not None:
            try:
                if self._db is None:
                    self._db = AnalysisDatabase()
                self._db.save_run(self.ticker, self.result, qm,
                                   period=self.period,
                                   sentiment_score=sentiment_data.get('score') if sentiment_data else None)
                log.info(f"  Saved to database")
            except Exception as e:
                log.warning(f"  DB save error: {e}")

        # Store analysis for charting
        self.analysis = analysis
        return self.result

    def _classify_signal(self, a: dict, price: float):
        """Classify BUY/SELL/HOLD based on evidence scoring (rule engine).

        Delegates to ``rules.technical.classify_signal`` — see
        ``engine/rules/technical.py`` for the rule definitions.
        """
        feats = _MarketFeatures(
            analysis=a, price=price, pattern_votes={},
            ticker=self.ticker, yf_info=getattr(self, '_yf_info', {}) or {},
        )
        if HAS_RULES:
            self._rule_classify_outcome = _rules_technical.classify_outcome(feats)
        return _rules_technical.classify_signal(feats)

    # ────────────────────────────────────────────────────────────
    # CONFLUENCE CONFIRMATION GATE — multi-signal convolution
    # ────────────────────────────────────────────────────────────

    # of 4 independent confirmations required for BUY.
    # 2026-09-05: tuned from 3 → 2 after a 10y out-of-sample backtest showed
    # confirm>=3 only helps in the 2023-26 bull regime (5y result was
    # regime-dependent) while confirm>=2 has a small consistent edge and the
    # best tail-risk protection (P(close<-10%) 2.8% vs 4.2% ungated).
    MIN_CONFIRM = 2  # legacy flat-count threshold (kept for back-compat; convolution replaces it)

    # Weighted-convolution constants (2026-09-05)
    # TECH_BUY_MIN tuned 65 → 60 from the 10y backtest (12 tickers, 1344
    # signals): 60 beats 65 on win rate (+2.2pp vs +0.6pp), avg return and
    # tail risk while keeping 2.3× more signals. 70 over-filters (47.9% WR).
    TECH_BUY_MIN = 60
    FUND_FACTOR_FLOOR = 50   # any fundamental factor below this triggers the cap
    FUND_CAP = 65            # fund_conv cap when the AND-floor fires (cap, not veto)

    def _pattern_votes(self, a: dict) -> dict:
        """Run pattern_engine.detect_patterns and return weighted votes.

        Each detected pattern contributes its calibrated weight (bullish adds,
        bearish subtracts). Weights reflect the measured edge from the
        pattern-engine calibration (AUDIT_TRACKING.md §12-13). Returns dict
        with bull_weight, bear_weight, patterns, majority, veto, available.
        """
        try:
            import sys as _sys
            pe_dir = self._pattern_engine_dir()
            if pe_dir and pe_dir not in _sys.path:
                _sys.path.insert(0, pe_dir)
            import pattern_engine as pe
        except Exception:
            return {'bull_weight': 0.0, 'bear_weight': 0.0, 'patterns': [],
                    'majority': True, 'veto': False, 'available': False}

        try:
            df = getattr(self.result, 'df', None)
            if df is None or len(df) < 60:
                return {'bull_weight': 0.0, 'bear_weight': 0.0, 'patterns': [],
                        'majority': True, 'veto': False, 'available': False}
            candles = [
                pe.Candle(
                    time=str(idx.date()),
                    open=float(row['Open']),
                    high=float(row['High']),
                    low=float(row['Low']),
                    close=float(row['Close']),
                    volume=float(row.get('Volume', 0) or 0),
                )
                for idx, row in df.tail(120).iterrows()
            ]
            swing_highs, swing_lows = pe.find_swing_points(candles)
            pats = pe.detect_patterns(candles, swing_highs, swing_lows)
        except Exception:
            return {'bull_weight': 0.0, 'bear_weight': 0.0, 'patterns': [],
                    'majority': True, 'veto': False, 'available': False}

        # Calibrated votes are computed by the rule engine (single source of
        # truth). Falls back to an "unavailable" vote if the package is absent.
        if HAS_RULES:
            return _rules_patterns.pattern_votes(
                pats, a.get('atr', {}).get('percent_of_price'))
        return {'bull_weight': 0.0, 'bear_weight': 0.0, 'patterns': [],
                'majority': True, 'veto': False, 'available': False, 'geometry': []}

    def _technical_convolution(self, a: dict, price: float) -> dict:
        """Weighted convolution of every pattern, candlestick, and indicator.

        Components (total weight 100): pattern 30, trend 15, momentum 15,
        volume 15, candlestick 10, oscillator/divergence 10, Wyckoff 5.
        Each contributes a sub-score in [-weight, +weight]; the raw total
        [-100, +100] maps to a 0-100 score via 50 + total/2.

        Returns dict with score, raw_total, components, pattern_votes,
        pattern_majority.

        Delegates to ``rules.technical.technical_convolution``.
        """
        feats = _MarketFeatures(
            analysis=a, price=price, pattern_votes=self._pattern_votes(a),
            ticker=self.ticker, yf_info=getattr(self, '_yf_info', {}) or {},
        )
        if HAS_RULES:
            self._rule_conv_outcome = _rules_technical.convolution_outcome(feats)
        return _rules_technical.technical_convolution(feats)

    def _fundamental_convolution(self, fund: dict) -> dict:
        """Weighted factor scoring with an AND-floor cap.

        Factors (total 100): value 20, growth 20, profitability 20, risk 15,
        momentum 10, analyst 10, dividend 5. Each factor scores 0-100.

        AND-floor: if any factor with data scores < FUND_FACTOR_FLOOR (50),
        fund_conv is capped at FUND_CAP (65) — a cap, not a veto. Factors with
        no data are excluded from the floor check.

        Delegates to ``rules.fundamental.fundamental_convolution``.
        """
        return _rules_fundamental.fundamental_convolution(fund)


    def _pattern_engine_dir(self) -> Optional[str]:
        """Locate backend/engine/pattern_engine.py relative to this module.

        The engine file ships in two locations (share root for the live
        backend, vijaymaruthi/engine for the git repo); pattern_engine.py
        always sits at <repo>/backend/engine/. Returns None if not found so
        the gate degrades gracefully (pattern signal simply not counted).
        """
        import os
        base = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(base, '..', 'backend', 'engine'),            # vijaymaruthi/engine → vijaymaruthi/backend/engine
            os.path.join(base, 'vijaymaruthi', 'backend', 'engine'),  # share root → share/vijaymaruthi/backend/engine
        ]
        for c in candidates:
            if os.path.exists(os.path.join(c, 'pattern_engine.py')):
                return os.path.abspath(c)
        return None


    def _apply_quality_gates(self, signal: str, confidence: int, analysis: dict,
                             price: float) -> tuple:
        """Post-classification quality gates: data quality, liquidity, fundamental sanity.

        The raw technical classifier can emit BUY on micro-caps with strong momentum
        but broken fundamentals or thin liquidity. These gates downgrade/cap such
        signals so the engine behaves like an institutional desk:

          1. Data-quality gate   — insufficient history / no price → N/A or capped
          2. Liquidity gate      — market cap + average volume thresholds
          3. Fundamental gate    — extreme leverage → AVOID; loss-making + declining → cap
          4. Confidence calibration — missing fundamentals reduce confidence

        Returns (signal, confidence, gate_reasons).

        Delegates to ``rules.gates.apply_quality_gates``.
        """
        df = getattr(self.result, 'df', None)
        n_rows = len(df) if df is not None else 0
        return _rules_gates.apply_quality_gates(
            signal, confidence, analysis, price,
            ticker=self.ticker, yf_info=getattr(self, '_yf_info', {}) or {},
            n_rows=n_rows,
        )

    # ────────────────────────────────────────────────────────────
    # QUANTAMENTAL FUSION — Blend Technical + Fundamental Scores
    # ────────────────────────────────────────────────────────────

    @staticmethod
    def _cap_weight(ticker: str, market_cap: Optional[float]) -> tuple:
        """Determine dynamic technical/fundamental weights by market cap."""
        is_india = ticker.endswith('.NS') or ticker.endswith('.BO')
        if market_cap is None:
            return 0.50, 0.50  # default equal weight

        if is_india:
            # INR thresholds
            if market_cap > 500e9:          # > ₹50,000 Cr → Large Cap
                base_tech, base_fund = 0.40, 0.60
            elif market_cap > 50e9:         # > ₹5,000 Cr → Mid Cap
                base_tech, base_fund = 0.50, 0.50
            else:                            # Small Cap
                base_tech, base_fund = 0.60, 0.40
        else:
            # USD thresholds
            if market_cap > 10e9:           # > $10B → Large Cap
                base_tech, base_fund = 0.40, 0.60
            elif market_cap > 1e9:          # > $1B → Mid Cap
                base_tech, base_fund = 0.50, 0.50
            else:                            # Small Cap
                base_tech, base_fund = 0.60, 0.40
        return base_tech, base_fund

    @staticmethod
    def _map_fund_rating_to_score(rating: str) -> float:
        """Map fundamental screening rating to a 0-100 score."""
        mapping = {
            'strong_buy': 90, 'Strong Buy': 90,
            'buy': 75, 'Buy': 75,
            'hold': 50, 'Hold': 50,
            'sell': 25, 'Sell': 25,
            'strong_sell': 10, 'Strong Sell': 10,
        }
        return mapping.get(rating, 50)

    @staticmethod
    def _parse_pct(v) -> Optional[float]:
        """Parse a '12.34%' or '12.34' string into a float fraction (0.1234)."""
        if v is None:
            return None
        try:
            s = str(v).strip().replace('%', '')
            f = float(s)
            return f / 100.0 if abs(f) > 1 else f
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_num(v) -> Optional[float]:
        """Parse a numeric string like '15.20' or '2.5x' into a float."""
        if v is None:
            return None
        try:
            s = str(v).strip().replace('x', '').replace(',', '')
            return float(s)
        except (TypeError, ValueError):
            return None

    def _fallback_fund_score(self, fund: dict) -> Optional[float]:
        """Compute a real fundamental score from available sections when the
        screening score is missing (e.g. yfinance info was rate-limited).

        Mirrors the 7-factor screening logic using section_08_ratios,
        section_09_growth, section_12_valuation and section_15_risk so the
        fundamental pillar never silently degrades to a neutral 50.
        """
        s08 = fund.get('section_08_ratios', {}) or {}
        s09 = fund.get('section_09_growth', {}) or {}
        s12 = fund.get('section_12_valuation', {}) or {}
        s15 = fund.get('section_15_risk', {}) or {}

        score = 0
        max_score = 0

        # Value (max 20)
        pe = self._parse_num(s08.get('pe_ttm') or s12.get('pe_ratio'))
        if pe is not None and pe > 0:
            max_score += 20
            if pe < 15: score += 15
            elif pe < 20: score += 10
            elif pe < 25: score += 5
        pb = self._parse_num(s08.get('price_to_book') or s12.get('pb_ratio'))
        if pb is not None and pb > 0:
            max_score += 5
            if pb < 1.5: score += 5
            elif pb < 3: score += 3

        # Growth (max 20)
        eg = self._parse_pct(s09.get('earnings_growth_ttm') or s09.get('net_income_yoy_1yr'))
        if eg is not None:
            max_score += 15
            if eg > 0.15: score += 15
            elif eg > 0.05: score += 10
            elif eg > 0: score += 5
        rg = self._parse_pct(s09.get('revenue_growth_ttm') or s09.get('revenue_yoy_1yr'))
        if rg is not None:
            max_score += 5
            if rg > 0.10: score += 5
            elif rg > 0: score += 3

        # Profitability (max 20)
        roe = self._parse_pct(s08.get('return_on_equity'))
        if roe is not None:
            max_score += 15
            if roe > 0.15: score += 15
            elif roe > 0.10: score += 10
            elif roe > 0.05: score += 5
        pm = self._parse_pct(s08.get('profit_margin'))
        if pm is not None:
            max_score += 5
            if pm > 0.20: score += 5
            elif pm > 0.10: score += 3

        # Momentum (max 10) — from valuation section 52w range position
        price = self._parse_num(s12.get('current_price'))
        high52 = self._parse_num(s12.get('high_52w'))
        low52 = self._parse_num(s12.get('low_52w'))
        if price is not None and high52 and low52 and high52 > low52:
            max_score += 10
            pos = (price - low52) / (high52 - low52)
            if pos > 0.8: score += 10
            elif pos > 0.5: score += 5

        # Risk (max 10)
        de = self._parse_num(s08.get('debt_to_equity'))
        if de is not None:
            max_score += 5
            if de < 0.5: score += 5
            elif de < 1: score += 3
        risk_rating = s15.get('risk_rating', '')
        if risk_rating:
            max_score += 5
            if risk_rating == 'Low': score += 5
            elif risk_rating == 'Moderate': score += 3

        # Dividend (max 5)
        dy = self._parse_pct(s08.get('dividend_yield'))
        if dy is not None:
            max_score += 5
            if dy > 0.02: score += 5
            elif dy > 0.01: score += 3

        if max_score == 0:
            return None
        return round(score / max_score * 100, 1)

    def _compute_quantamental(self, analysis: dict, result: AnalysisResult,
                                sentiment: Optional[dict] = None) -> dict:
        """Fuse technical, fundamental, and optional sentiment signals.

        Delegates to ``rules.quantamental.compute_quantamental``.
        """
        return _rules_quant.compute_quantamental(
            analysis,
            tech_conf=result.confidence,
            tech_signal=result.signal,
            conv_tech=getattr(result, 'conv_technical', {}) or {},
            conv_fund=getattr(result, 'conv_fundamental', {}) or {},
            ticker=self.ticker,
            yf_info=getattr(self, '_yf_info', {}) or {},
            sentiment=sentiment,
        )


# ────────────────────────────────────────────────────────────
# CLI ENTRY POINT
# ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Institutional Quantamental Analysis Report')
    parser.add_argument('ticker', type=str, nargs='?', default=None,
                        help='Ticker symbol (e.g., HDFCBANK.NS, AAPL). '
                             'Omit for --batch/--backtest modes.')
    parser.add_argument('--period', type=str, default='1y', help='Data period (default: 1y)')
    parser.add_argument('--options', action='store_true', help='Include options analysis')
    parser.add_argument('--no-wyckoff', action='store_true', help='Skip Wyckoff/ICT analysis')
    parser.add_argument('--no-gann', action='store_true', help='Skip Gann/Cycle analysis')
    parser.add_argument('--save-json', action='store_true', help='Save output as JSON')
    parser.add_argument('--output-dir', type=str, default='reports', help='Output directory')
    parser.add_argument('--manual-data', type=str, default=None,
                        help='JSON file with manual fundamental overrides')
    parser.add_argument('--sentiment', action='store_true', default=False,
                        help='Enable news NLP sentiment analysis (3rd pillar)')
    parser.add_argument('--db', action='store_true', default=False,
                        help='Persist results to SQLite database (reports/analysis_history.db)')
    parser.add_argument('--db-path', type=str, default=None,
                        help='Custom SQLite database path')

    # Batch / Watchlist
    parser.add_argument('--batch', type=str, nargs='*', default=None,
                        help='Analyse multiple tickers: --batch AAPL MSFT GOOGL')
    parser.add_argument('--watchlist', type=str, default=None,
                        help='CSV/text file with tickers (one per line or first column)')
    parser.add_argument('--heatmap', action='store_true', default=False,
                        help='Generate HTML portfolio heatmap (batch mode)')
    parser.add_argument('--export-csv', type=str, default=None,
                        help='Export batch results to CSV file')

    # Backtest
    parser.add_argument('--backtest', action='store_true', default=False,
                        help='Run historical backtest of quantamental signals')
    parser.add_argument('--backtest-years', type=int, default=3,
                        help='Years of history for backtest (default: 3)')
    parser.add_argument('--backtest-rebalance', type=int, default=63,
                        help='Rebalance interval in trading days (default: 63 ≈ quarterly)')

    args = parser.parse_args()

    out_dir = args.output_dir
    os.makedirs(out_dir, exist_ok=True)

    # ── Load manual overrides ──
    manual_overrides = {}
    if args.manual_data:
        manual_overrides = FundamentalAnalyzer.load_manual_file(args.manual_data)
        if manual_overrides:
            log.info(f"Loaded {len(manual_overrides)} section(s) of manual fundamental data")

    # ════════════════════════════════════════════════════════
    # MODE 1: Backtest
    # ════════════════════════════════════════════════════════
    if args.backtest:
        if not HAS_BACKTESTER:
            log.error("Backtester module not available. Check quantamental_backtester.py")
            sys.exit(1)
        ticker = args.ticker
        if not ticker:
            log.error("Specify a ticker for backtest mode")
            sys.exit(1)
        log.info(f"Running backtest for {ticker}...")
        bt = QuantamentalBacktester(
            ticker, years=args.backtest_years,
            rebalance_days=args.backtest_rebalance)
        signals = bt.run_fast()
        if signals:
            bt.compute_forward_returns()
            bt.print_report()
        else:
            log.warning("No backtest signals generated")
        return

    # ════════════════════════════════════════════════════════
    # MODE 2: Batch / Watchlist
    # ════════════════════════════════════════════════════════
    if args.batch or args.watchlist:
        if not HAS_HEATMAP:
            log.error("PortfolioHeatmap module not available. Check portfolio_heatmap.py")
            sys.exit(1)
        tickers = []
        if args.batch:
            tickers.extend(args.batch)
        if args.watchlist:
            from portfolio_heatmap import PortfolioHeatmap as PHM
            tickers.extend(PHM.load_watchlist(args.watchlist))
        if not tickers:
            log.error("No tickers provided for batch mode")
            sys.exit(1)

        log.info(f"Batch analysing {len(tickers)} tickers...")
        hm = PortfolioHeatmap(tickers, period=args.period,
                               manual_data_file=args.manual_data)
        hm.run()
        hm.print_table()

        # HTML heatmap
        if args.heatmap:
            html_path = os.path.join(out_dir, 'quantamental_heatmap.html')
            hm.to_html(html_path)
            log.info(f"HTML heatmap saved to {html_path}")

        # CSV export
        if args.export_csv:
            hm.to_csv(args.export_csv)

        # Save individual reports
        for row in hm.rows:
            log.info(f"  {row.ticker}: {row.qm_rating} ({row.qm_score:.1f}) — "
                     f"Tech={row.tech_signal}({row.tech_conf:.0f}%) "
                     f"Fund={row.fund_rating}({row.fund_score:.0f})")

        # Summary line
        buys = sum(1 for r in hm.rows if r.qm_rating in ('Strong Buy', 'Buy'))
        holds = sum(1 for r in hm.rows if r.qm_rating == 'Hold')
        sells = sum(1 for r in hm.rows if r.qm_rating in ('Sell', 'Strong Sell'))
        print(f"\n  Summary: {buys} Buy / {holds} Hold / {sells} Sell "
              f"(of {len(hm.rows)} total)")
        return

    # ════════════════════════════════════════════════════════
    # MODE 3: Single Ticker Analysis
    # ════════════════════════════════════════════════════════
    if not args.ticker:
        parser.print_help()
        sys.exit(1)

    # Run pipeline
    pipeline = TechnicalAnalysisPipeline(
        ticker=args.ticker,
        period=args.period,
        do_options=args.options,
        do_wyckoff=not args.no_wyckoff,
        do_gann=not args.no_gann,
        do_sentiment=args.sentiment,
        do_db=args.db,
        manual_overrides=manual_overrides,
    )
    result = pipeline.run()
    analysis = getattr(pipeline, 'analysis', {})

    if result.df is None or result.df.empty:
        log.error("Analysis failed — no data")
        sys.exit(1)

    # Generate chart
    log.info("Generating chart...")
    safe_ticker = args.ticker.replace('.', '_')
    chart_path = os.path.join(out_dir, f"{safe_ticker}_analysis.png")
    cg = ChartGenerator(result.df, result, analysis)
    cg.generate(chart_path)

    # Build report
    log.info("Building report...")
    rb = ReportBuilder(result, analysis)
    report = rb.build()

    # Print report
    print("\n" + report)

    # Save report
    report_path = os.path.join(out_dir, f"{safe_ticker}_report.txt")
    with open(report_path, 'w') as f:
        f.write(report)
    log.info(f"Report saved: {report_path}")

    # Save JSON if requested
    if args.save_json:
        json_path = os.path.join(out_dir, f"{safe_ticker}_data.json")
        serializable = {
            'ticker': args.ticker,
            'signal': result.signal,
            'confidence': result.confidence,
            'price': float(result.df['Close'].iloc[-1]) if result.df is not None else None,
            'market_structure': result.market_structure,
            'rsi': {k: v for k, v in result.rsi.items() if isinstance(v, (int, float, str, bool))},
            'macd': {k: v for k, v in result.macd.items() if isinstance(v, (int, float, str, bool))},
            'adx': result.adx,
            'atr': result.atr,
            'bollinger': result.bollinger,
            'volume': result.volume,
            'wyckoff_phase': result.wyckoff.get('wyckoff_phase', {}),
            'gann_cycles': result.gann.get('cycles', {}),
            'fundamentals': result.fundamentals,
            'quantamental': result.quantamental,
            'sentiment': result.sentiment,
        }
        def clean(obj):
            if isinstance(obj, dict):
                return {k: clean(v) for k, v in obj.items()}
            elif isinstance(obj, (np.floating,)):
                return float(obj)
            elif isinstance(obj, (np.integer,)):
                return int(obj)
            elif isinstance(obj, (np.bool_,)):
                return bool(obj)
            return obj
        serializable = clean(serializable)
        with open(json_path, 'w') as f:
            json.dump(serializable, f, indent=2, default=str)
        log.info(f"Data saved: {json_path}")


if __name__ == '__main__':
    main()
