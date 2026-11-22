"""Feature-building tests — as_of filtering and INSUFFICIENT_DATA."""

from __future__ import annotations

from datetime import date, timedelta

from conftest import synthetic_ohlcv
from aiops.clock import morning_data_as_of
from aiops.market.fetch import available_at_iso, upsert_daily
from aiops.market.features import MIN_BARS, build_features


def test_build_features_ok(db, seed_market):
    """120 bars produce a complete feature dict."""
    last_date = date.fromisoformat(seed_market[-1]["date"])
    as_of = morning_data_as_of(last_date + timedelta(days=1))
    feats = build_features(db, "TEST.NS", as_of)
    assert feats["ok"] is True
    assert feats["bars"] == 120
    assert feats["last_date"] == seed_market[-1]["date"]
    assert feats["last_close"] > 0
    assert feats["regime"] in {"trend_up", "trend_down", "range", "high_volatility"}
    assert len(feats["recent_closes"]) == 10
    for key in ("sma20", "sma50", "rsi14", "adx", "atr_pct"):
        assert key in feats


def test_as_of_filters_future_bars(db, seed_market):
    """Bars with available_at > as_of must never appear in features."""
    last_date = date.fromisoformat(seed_market[-1]["date"])
    D = last_date + timedelta(days=1)
    as_of = morning_data_as_of(D)  # = last_date 16:00 IST

    feats = build_features(db, "TEST.NS", as_of)
    assert feats["ok"] is True
    assert feats["last_date"] == seed_market[-1]["date"]

    # Insert a "future" bar (date = D, available_at = D 16:00 > as_of).
    future = {
        "symbol": "TEST.NS",
        "date": D.isoformat(),
        "open": 200.0,
        "high": 210.0,
        "low": 190.0,
        "close": 205.0,
        "volume": 1_000_000,
        "available_at": available_at_iso(D),
        "source": "synthetic",
    }
    upsert_daily(db, [future])

    feats2 = build_features(db, "TEST.NS", as_of)
    assert feats2["ok"] is True
    assert feats2["last_date"] == seed_market[-1]["date"], (
        "future bar leaked into features"
    )
    assert feats2["last_close"] == feats["last_close"]


def test_insufficient_data(db):
    """Fewer than MIN_BARS bars → INSUFFICIENT_DATA, never fabricated features."""
    rows = synthetic_ohlcv(n=MIN_BARS - 1, seed=3)
    upsert_daily(db, rows)
    last_date = date.fromisoformat(rows[-1]["date"])
    as_of = morning_data_as_of(last_date + timedelta(days=1))
    feats = build_features(db, "TEST.NS", as_of)
    assert feats["ok"] is False
    assert feats["reason"] == "INSUFFICIENT_DATA"
    assert feats["bars"] == MIN_BARS - 1