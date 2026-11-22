"""Self-contained, deterministic technical indicators for the state machine.

Kept independent of the main engine so the state machine has no heavy import
graph and stays trivially testable. All functions are pure and vectorised;
identical inputs always yield identical outputs.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, n: int) -> pd.Series:
    return series.rolling(window=n, min_periods=n).mean()


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder's Average True Range."""
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat([
        (high - low),
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return _wilder(tr, n)


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder's Average Directional Index."""
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    prev_high = high.shift(1)
    prev_low = low.shift(1)

    up_move = high - prev_high
    down_move = prev_low - low

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    plus_dm = pd.Series(plus_dm, index=df.index)
    minus_dm = pd.Series(minus_dm, index=df.index)

    atr_n = atr(df, n)
    plus_di = 100.0 * _wilder(plus_dm, n) / atr_n.replace(0, np.nan)
    minus_di = 100.0 * _wilder(minus_dm, n) / atr_n.replace(0, np.nan)
    denom = (plus_di + minus_di).replace(0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / denom
    return _wilder(dx, n)


def _wilder(series: pd.Series, n: int) -> pd.Series:
    """Wilder smoothing: first value = SMA of first n, then recursive."""
    arr = series.to_numpy(dtype=float)
    out = np.full(len(arr), np.nan)
    if len(arr) < n:
        return pd.Series(out, index=series.index)
    window = arr[:n]
    if np.all(np.isnan(window)):
        return pd.Series(out, index=series.index)
    first = np.nanmean(window)
    out[n - 1] = first
    prev = first
    for i in range(n, len(arr)):
        val = arr[i]
        if np.isnan(val):
            out[i] = prev
            continue
        prev = (prev * (n - 1) + val) / n
        out[i] = prev
    return pd.Series(out, index=series.index)
