"""Pure technical indicators on a DataFrame of daily bars.

Input contract: a pandas DataFrame with columns
``date/open/high/low/close/volume`` (the ``date`` column is not required by
these functions — they operate on the price columns only).

No lookahead: every indicator is rolling/EWM and uses only past+current bars.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(close: pd.Series, n: int) -> pd.Series:
    """Simple moving average (n-period, requires n observations)."""
    return close.rolling(n, min_periods=n).mean()


def ema(close: pd.Series, n: int) -> pd.Series:
    """Exponential moving average (span n, adjust=False)."""
    return close.ewm(span=n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder smoothing).

    Flat prices (no gains and no losses) map to 50; all-gains → 100;
    all-losses → 0.
    """
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / n, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / n, adjust=False).mean()
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = avg_gain / avg_loss
        out = 100.0 - 100.0 / (1.0 + rs)
    out = out.where(avg_loss != 0, 100.0)  # no losses → RSI 100
    out = out.where(~((avg_gain == 0) & (avg_loss == 0)), 50.0)  # flat → 50
    return out


def macd(close: pd.Series) -> pd.DataFrame:
    """MACD (12/26/9). Returns DataFrame with macd, signal, hist."""
    line = ema(close, 12) - ema(close, 26)
    signal = line.ewm(span=9, adjust=False).mean()
    hist = line - signal
    return pd.DataFrame({"macd": line, "signal": signal, "hist": hist})


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Average True Range (Wilder smoothing)."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / n, adjust=False).mean()


def bollinger(close: pd.Series, n: int = 20) -> pd.DataFrame:
    """Bollinger bands (2 population standard deviations)."""
    mid = sma(close, n)
    std = close.rolling(n, min_periods=n).std(ddof=0)
    return pd.DataFrame(
        {"mid": mid, "upper": mid + 2 * std, "lower": mid - 2 * std}
    )


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Average Directional Index (Wilder smoothing)."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_high = high.shift(1)
    prev_low = low.shift(1)
    prev_close = close.shift(1)
    up_move = high - prev_high
    down_move = prev_low - low
    plus_dm = pd.Series(
        np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index
    )
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0),
        index=df.index,
    )
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    atr_ = tr.ewm(alpha=1.0 / n, adjust=False).mean()
    plus_di = 100.0 * plus_dm.ewm(alpha=1.0 / n, adjust=False).mean() / atr_
    minus_di = 100.0 * minus_dm.ewm(alpha=1.0 / n, adjust=False).mean() / atr_
    with np.errstate(divide="ignore", invalid="ignore"):
        dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di)
    return dx.ewm(alpha=1.0 / n, adjust=False).mean().fillna(0.0)


def volume_sma(volume: pd.Series, n: int = 20) -> pd.Series:
    """Simple moving average of volume."""
    return volume.rolling(n, min_periods=n).mean()