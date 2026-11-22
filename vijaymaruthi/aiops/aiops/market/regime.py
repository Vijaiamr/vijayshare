"""Deterministic market-regime classification.

Rules (priority order, fully deterministic):

1. ``high_volatility`` — ATR14 / close > 3.0% (volatility dominates any trend
   signal; momentum signals are unreliable).
2. ``trend_up`` — SMA20 > SMA50, SMA20 rising over the last 5 bars, ADX14 >= 20.
3. ``trend_down`` — SMA20 < SMA50, SMA20 falling over the last 5 bars,
   ADX14 >= 20.
4. ``range`` — everything else.

Fallbacks when SMA50/ADX are unavailable (< 50 bars of history):
- ``trend_up`` if close > SMA20 and SMA20 rising;
- ``trend_down`` if close < SMA20 and SMA20 falling;
- otherwise ``range``.
"""

from __future__ import annotations

import pandas as pd

from .indicators import adx, atr, sma

HIGH_VOL_ATR_PCT = 3.0
ADX_TREND_THRESHOLD = 20.0


def classify_regime(df: pd.DataFrame) -> str:
    """Classify the current regime of a daily-bar DataFrame.

    Returns one of ``"trend_up"``, ``"trend_down"``, ``"range"``,
    ``"high_volatility"``.
    """
    close = df["close"]
    n = len(df)

    atr14 = atr(df, 14)
    last_atr = atr14.iloc[-1]
    last_close = float(close.iloc[-1])
    atr_pct = (
        float(last_atr / last_close * 100.0)
        if n >= 15 and pd.notna(last_atr) and last_close
        else 0.0
    )
    if atr_pct > HIGH_VOL_ATR_PCT:
        return "high_volatility"

    sma20 = sma(close, 20)
    sma50 = sma(close, 50)
    adx14 = adx(df, 14)

    s20 = sma20.iloc[-1]
    s50 = sma50.iloc[-1]
    a = adx14.iloc[-1]

    slope20 = 0.0
    if n >= 25 and pd.notna(sma20.iloc[-6]):
        slope20 = (sma20.iloc[-1] - sma20.iloc[-6]) / sma20.iloc[-6] * 100.0

    if pd.notna(s20) and pd.notna(s50) and pd.notna(a):
        if s20 > s50 and slope20 > 0.0 and a >= ADX_TREND_THRESHOLD:
            return "trend_up"
        if s20 < s50 and slope20 < 0.0 and a >= ADX_TREND_THRESHOLD:
            return "trend_down"

    # Fallback when SMA50/ADX are unavailable (< 50 bars).
    if pd.notna(s20):
        if last_close > s20 and slope20 > 0.0:
            return "trend_up"
        if last_close < s20 and slope20 < 0.0:
            return "trend_down"

    return "range"