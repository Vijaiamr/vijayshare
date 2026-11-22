"""Feature building — the deterministic context for predictions.

`build_features` loads bars with ``available_at <= as_of`` (ORDER BY date),
computes indicators + regime + returns, and returns a plain dict suitable for
both the LLM context and the deterministic baseline predictor.

Temporal contract: the caller passes ``as_of`` (e.g. ``morning_data_as_of(D)``
= D-1 16:00 IST). Only bars observable at or before ``as_of`` are used — this
is the single enforcement point for "no future leakage" in feature space.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

import pandas as pd

from .indicators import adx, atr, bollinger, ema, macd, rsi, sma, volume_sma
from .regime import classify_regime

MIN_BARS = 30


def _f(series: pd.Series) -> float | None:
    """Last value of a Series, or None when NaN (e.g. warm-up window)."""
    v = series.iloc[-1]
    return None if pd.isna(v) else float(v)


def build_features(
    conn: sqlite3.Connection, symbol: str, as_of: datetime | str
) -> dict[str, Any]:
    """Build the feature dict for ``symbol`` using bars with ``available_at <= as_of``.

    Returns ``{"ok": False, "reason": "INSUFFICIENT_DATA", ...}`` when fewer
    than ``MIN_BARS`` (30) bars are available — never fabricates features.
    """
    as_of_iso = as_of.isoformat() if hasattr(as_of, "isoformat") else str(as_of)
    rows = conn.execute(
        """SELECT date, open, high, low, close, volume, available_at
           FROM market_daily
           WHERE symbol = ? AND available_at <= ?
           ORDER BY date""",
        (symbol, as_of_iso),
    ).fetchall()
    if len(rows) < MIN_BARS:
        return {
            "ok": False,
            "reason": "INSUFFICIENT_DATA",
            "symbol": symbol,
            "as_of": as_of_iso,
            "bars": len(rows),
        }

    df = pd.DataFrame([dict(r) for r in rows])
    close = df["close"]

    sma20 = sma(close, 20)
    sma50 = sma(close, 50)
    ema12 = ema(close, 12)
    ema26 = ema(close, 26)
    rsi14 = rsi(close, 14)
    macd_df = macd(close)
    atr14 = atr(df, 14)
    boll = bollinger(close, 20)
    adx14 = adx(df, 14)
    vsma20 = volume_sma(df["volume"], 20)

    last_close = float(close.iloc[-1])
    atr_val = _f(atr14)

    def ret(n: int) -> float | None:
        if len(close) > n:
            return float((close.iloc[-1] / close.iloc[-1 - n] - 1.0) * 100.0)
        return None

    return {
        "ok": True,
        "symbol": symbol,
        "as_of": as_of_iso,
        "bars": len(rows),
        "last_date": str(df["date"].iloc[-1]),
        "last_close": last_close,
        "prev_close": float(close.iloc[-2]) if len(close) > 1 else last_close,
        "return_1d": ret(1),
        "return_5d": ret(5),
        "return_10d": ret(10),
        "return_20d": ret(20),
        "sma20": _f(sma20),
        "sma50": _f(sma50),
        "ema12": _f(ema12),
        "ema26": _f(ema26),
        "rsi14": _f(rsi14),
        "macd": _f(macd_df["macd"]),
        "macd_signal": _f(macd_df["signal"]),
        "macd_hist": _f(macd_df["hist"]),
        "atr": atr_val,
        "atr_pct": float(atr_val / last_close * 100.0) if atr_val else None,
        "adx": _f(adx14),
        "bollinger_upper": _f(boll["upper"]),
        "bollinger_mid": _f(boll["mid"]),
        "bollinger_lower": _f(boll["lower"]),
        "volume_sma20": _f(vsma20),
        "last_volume": int(df["volume"].iloc[-1]),
        "high_20": float(df["high"].iloc[-20:].max()) if len(df) >= 20 else None,
        "low_20": float(df["low"].iloc[-20:].min()) if len(df) >= 20 else None,
        "regime": classify_regime(df),
        "recent_closes": [float(c) for c in close.iloc[-10:].tolist()],
    }