"""Deterministic OHLCV + fundamental fixtures for the golden-master harness.

Design goals:
  * fully offline (no yfinance / network),
  * byte-reproducible on every run and every CPython 3.x (``random.Random``
    is the documented Mersenne Twister — stable output for a fixed seed),
  * broad rule-path coverage: uptrend / downtrend / chop / whipsaw price
    shapes crossed with strong / weak / broken / absent fundamentals and
    large / mid / small / unknown market caps (exercises the liquidity and
    confidence-calibration gates).

The fixtures are intentionally *synthetic*: the golden master tests that the
rule-engine refactor reproduces the pre-refactor arithmetic exactly, not that
the numbers match any real security.
"""
from __future__ import annotations

import random
from pathlib import Path
from typing import Dict, List

import pandas as pd

# Fixed end date so the DatetimeIndex (weekly/monthly resample in MTFAnalyzer)
# is identical on every run.
_END_DATE = "2026-09-30"
_N_BARS = 320  # > SMA200 warm-up and ~15 monthly buckets

_OHLCV_DIR = Path(__file__).resolve().parent / "ohlcv"


def load_csv(stem: str) -> pd.DataFrame:
    """Load a cached real-OHLCV fixture (committed under fixtures/ohlcv/)."""
    df = pd.read_csv(_OHLCV_DIR / f"{stem}.csv", index_col=0, parse_dates=True)
    df.index.name = "Date"
    return df[["Open", "High", "Low", "Close", "Volume"]]


def build_ohlcv(kind: str, n: int = _N_BARS, seed: int = 1234) -> pd.DataFrame:
    """Return a deterministic OHLCV DataFrame with a DatetimeIndex.

    ``kind`` selects the price path:
      * ``uptrend``   — persistent positive drift, low noise
      * ``downtrend`` — persistent negative drift
      * ``sideways``  — near-zero drift, moderate noise (ADX-chop candidate)
      * ``whipsaw``   — alternating large up/down bars (oscillator stress)
    """
    rng = random.Random(seed)
    drift, noise = {
        "uptrend": (0.0015, 0.006),
        "downtrend": (-0.0015, 0.006),
        "sideways": (0.0, 0.010),
        "whipsaw": (0.0, 0.025),
    }[kind]

    idx = pd.bdate_range(end=_END_DATE, periods=n)
    close = 100.0
    rows: List[Dict[str, float]] = []
    prev_close = close
    for i in range(n):
        # whipsaw alternates the sign of the move to force frequent reversals.
        step = (noise if (i % 2 == 0) else -noise) if kind == "whipsaw" else rng.uniform(-noise, noise)
        ret = drift + step
        close = max(1.0, prev_close * (1.0 + ret))
        o = prev_close * (1.0 + rng.uniform(-noise / 2.0, noise / 2.0))
        hi = max(o, close) * (1.0 + abs(rng.uniform(0.0, noise / 2.0)))
        lo = min(o, close) * (1.0 - abs(rng.uniform(0.0, noise / 2.0)))
        vol = 1_000_000.0 * (1.0 + 2.0 * abs(ret)) * (1.0 + rng.uniform(-0.2, 0.2))
        rows.append({"Open": o, "High": hi, "Low": lo, "Close": close, "Volume": round(vol)})
        prev_close = close

    df = pd.DataFrame(rows, index=idx)
    df.index.name = "Date"
    return df


def build_fundamentals(kind: str) -> dict:
    """Return a hand-built fundamentals dict mirroring the shipped sections.

    Only the sections read by ``_fundamental_convolution`` and
    ``_apply_quality_gates``/``_compute_quantamental`` are populated.
    """
    if kind == "empty":
        return {}

    if kind == "good":
        return {
            "section_08_ratios": {
                "pe_ttm": 18.0, "pb": 2.5, "roe": 22.0, "profit_margin": 24.0,
                "debt_to_equity": 0.3, "dividend_yield": 1.5,
            },
            "section_09_growth": {"revenue_cagr_2yr": 18.0, "net_income_cagr_2yr": 20.0},
            "section_12_valuation": {
                "pe_ttm": 18.0, "pb": 2.5, "peg_ratio": 0.9,
                "current_price": 1500.0, "high_52w": 1600.0, "low_52w": 1100.0,
                "pe_ratio": 18.0,
            },
            "section_15_risk": {"risk_rating": "Low", "risk_flags": []},
            "section_17_quarterly_detail": {"revenue_yoy_growth": 12.0, "earnings_yoy_growth": 15.0},
            "quick_ratings": {
                "screening_rating": "Buy", "moat_rating": "Wide Moat",
                "risk_rating": "Low", "analyst_rating": "strong_buy",
            },
        }

    if kind == "weak":
        return {
            "section_08_ratios": {
                "pe_ttm": 45.0, "pb": 4.5, "roe": 6.0, "profit_margin": 3.0,
                "debt_to_equity": 6.0, "dividend_yield": 0.2,
            },
            "section_09_growth": {"revenue_cagr_2yr": 2.0, "net_income_cagr_2yr": -5.0},
            "section_12_valuation": {
                "pe_ttm": 45.0, "pb": 4.5, "peg_ratio": 3.5,
                "current_price": 90.0, "high_52w": 200.0, "low_52w": 80.0,
                "pe_ratio": 45.0,
            },
            "section_15_risk": {
                "risk_rating": "High",
                "risk_flags": ["\u26a0 leverage", "\u26a0 governance", "\u26a0 pledge"],
            },
            "section_17_quarterly_detail": {"revenue_yoy_growth": -8.0, "earnings_yoy_growth": -20.0},
            "quick_ratings": {
                "screening_rating": "Sell", "moat_rating": "Narrow Moat",
                "risk_rating": "High", "analyst_rating": "hold",
            },
        }

    if kind == "broken":
        return {
            "section_08_ratios": {
                "pe_ttm": 150.0, "pb": 9.0, "roe": -4.0, "profit_margin": -10.0,
                "debt_to_equity": 12.0, "dividend_yield": 0.0,
            },
            "section_09_growth": {"revenue_cagr_2yr": -12.0, "net_income_cagr_2yr": -30.0},
            "section_12_valuation": {
                "pe_ttm": 150.0, "pb": 9.0, "peg_ratio": 5.0,
                "current_price": 40.0, "high_52w": 120.0, "low_52w": 35.0,
                "pe_ratio": 150.0,
            },
            "section_15_risk": {
                "risk_rating": "High",
                "risk_flags": ["\u26a0 leverage", "\u26a0 losses", "\u26a0 going concern"],
            },
            "section_17_quarterly_detail": {"revenue_yoy_growth": -15.0, "earnings_yoy_growth": -40.0},
            "quick_ratings": {
                "screening_rating": "Strong Sell", "moat_rating": "None",
                "risk_rating": "High", "analyst_rating": "sell",
            },
        }

    raise ValueError(f"unknown fundamentals kind: {kind}")


# name, ohlcv kind, fundamentals kind, yf_info (marketCap drives cap category +
# liquidity gate)
SYNTHETIC_CASES: List[dict] = [
    {"name": "uptrend_good_large", "ticker": "TEST1.NS", "ohlcv": "uptrend",
     "fund": "good", "info": {"marketCap": 3.5e12}},
    {"name": "uptrend_nofund_large", "ticker": "TEST2.NS", "ohlcv": "uptrend",
     "fund": "empty", "info": {"marketCap": 3.5e12}},
    {"name": "downtrend_weak_large", "ticker": "TEST3.NS", "ohlcv": "downtrend",
     "fund": "weak", "info": {"marketCap": 3.5e12}},
    {"name": "sideways_good_mid", "ticker": "TEST4.NS", "ohlcv": "sideways",
     "fund": "good", "info": {"marketCap": 8.0e10}},
    {"name": "whipsaw_broken_small", "ticker": "TEST5.NS", "ohlcv": "whipsaw",
     "fund": "broken", "info": {"marketCap": 4.0e9}},
    {"name": "uptrend_weak_unknowncap", "ticker": "TEST6.NS", "ohlcv": "uptrend",
     "fund": "weak", "info": {}},
]

# Real cached OHLCV (fixtures/ohlcv/<stem>.csv). These exercise the geometric
# pattern detectors (head_and_shoulders, falling_wedge, triple_bottom,
# symmetrical_triangle) that synthetic walks never trigger.
# (stem, ticker, fund kind, marketCap)
_REAL = [
    ("RELIANCE_NS", "RELIANCE.NS", "good", 1.9e13),
    ("HDFCBANK_NS", "HDFCBANK.NS", "good", 1.3e13),
    ("TCS_NS", "TCS.NS", "good", 1.2e13),
    ("AAPL", "AAPL", "good", 3.5e12),
    ("AXISBANK_NS", "AXISBANK.NS", "weak", 3.7e12),
    ("BHARTIARTL_NS", "BHARTIARTL.NS", "good", 1.0e13),
    ("LT_NS", "LT.NS", "good", 5.0e12),
    ("MARUTI_NS", "MARUTI.NS", "good", 3.9e12),
    ("MSFT", "MSFT", "good", 3.0e12),
    ("NVDA", "NVDA", "good", 2.5e12),
    ("TSLA", "TSLA", "weak", 8.0e11),
    ("AMZN", "AMZN", "good", 2.0e12),
]

REAL_CASES: List[dict] = [
    {"name": f"real_{stem.lower()}", "ticker": ticker, "csv": stem,
     "fund": fund, "info": {"marketCap": cap}}
    for (stem, ticker, fund, cap) in _REAL
]

CASES: List[dict] = SYNTHETIC_CASES + REAL_CASES

