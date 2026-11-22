"""Pattern-gate tests — deterministic patterns fire, no-pattern skips (no force-fit)."""

from __future__ import annotations

from aiops.learning.knowledge import add_knowledge, positive_symbols
from aiops.prediction.engine import _baseline, predict_symbol


def _feats(**overrides):
    """Base feature dict with neutral values (no pattern fires)."""
    base = {
        "ok": True,
        "symbol": "TEST.NS",
        "as_of": "2026-01-01T09:00:00+05:30",
        "bars": 120,
        "last_date": "2025-12-31",
        "last_close": 100.0,
        "sma20": 100.0,
        "sma50": 100.0,
        "rsi14": 50.0,
        "adx": 15.0,
        "bollinger_lower": 95.0,
        "bollinger_upper": 105.0,
        "volume_sma20": 1_000_000.0,
        "last_volume": 1_000_000,
        "high_20": 110.0,
        "low_20": 90.0,
        "regime": "range",
    }
    base.update(overrides)
    return base


def test_trend_up_pattern():
    feats = _feats(last_close=106.0, sma20=105.0, sma50=100.0, adx=25.0, rsi14=60.0)
    pred = _baseline(feats)
    assert pred["pattern"] == "trend_up"
    assert pred["direction"] == "up"
    assert pred["target_pct"] == 1.5
    assert pred["stop_pct"] == -1.0
    assert 0.5 <= pred["confidence"] <= 0.70
    assert "trend_up" in pred["rationale"]


def test_trend_down_pattern():
    feats = _feats(last_close=94.0, sma20=95.0, sma50=100.0, adx=25.0, rsi14=40.0)
    pred = _baseline(feats)
    assert pred["pattern"] == "trend_down"
    assert pred["direction"] == "down"
    assert pred["target_pct"] == -1.5
    assert pred["stop_pct"] == 1.0
    assert "trend_down" in pred["rationale"]


def test_trend_up_blocked_when_extended():
    """v2: close far above sma20 (extension, not pullback) → no trend_up."""
    feats = _feats(last_close=110.0, sma20=105.0, sma50=100.0, adx=25.0, rsi14=60.0)
    assert _baseline(feats) == {"pattern": "none"}


def test_trend_up_blocked_in_high_volatility():
    """v2 regime gate: momentum signals blocked in high_volatility."""
    feats = _feats(
        last_close=106.0, sma20=105.0, sma50=100.0, adx=25.0, rsi14=60.0,
        regime="high_volatility",
    )
    assert _baseline(feats) == {"pattern": "none"}


def test_trend_down_blocked_in_high_volatility():
    feats = _feats(
        last_close=94.0, sma20=95.0, sma50=100.0, adx=25.0, rsi14=40.0,
        regime="high_volatility",
    )
    assert _baseline(feats) == {"pattern": "none"}


def test_meanrev_fires_in_high_volatility():
    """v2: mean-reversion patterns still fire in high_volatility (their edge)."""
    feats = _feats(rsi14=25.0, last_close=90.0, bollinger_lower=91.0, regime="high_volatility")
    assert _baseline(feats)["pattern"] == "meanrev_up"


def test_confidence_capped_at_070():
    """v2: confidence never exceeds 0.70 (recalibrated, no extension reward)."""
    feats = _feats(last_close=106.0, sma20=105.0, sma50=100.0, adx=80.0, rsi14=55.0)
    pred = _baseline(feats)
    assert pred["pattern"] == "trend_up"
    assert pred["confidence"] <= 0.70


def test_meanrev_patterns():
    up = _baseline(_feats(rsi14=25.0, last_close=90.0, bollinger_lower=91.0))
    assert up["pattern"] == "meanrev_up"
    assert up["direction"] == "up"
    assert up["confidence"] == 0.6

    down = _baseline(_feats(rsi14=75.0, last_close=110.0, bollinger_upper=109.0))
    assert down["pattern"] == "meanrev_down"
    assert down["direction"] == "down"
    assert down["confidence"] == 0.6


def test_breakout_patterns():
    up = _baseline(
        _feats(last_close=120.0, high_20=119.0, last_volume=3_000_000, volume_sma20=1_000_000)
    )
    assert up["pattern"] == "breakout_up"
    assert up["direction"] == "up"
    assert up["confidence"] == 0.65
    assert up["target_pct"] == 2.0

    down = _baseline(
        _feats(last_close=80.0, low_20=81.0, last_volume=3_000_000, volume_sma20=1_000_000)
    )
    assert down["pattern"] == "breakout_down"
    assert down["direction"] == "down"
    assert down["confidence"] == 0.65


def test_no_pattern_returns_none_marker():
    pred = _baseline(_feats())
    assert pred == {"pattern": "none"}


def test_weak_trend_does_not_force_fit():
    """close > sma20 but ADX < 20 and RSI out of band → no pattern."""
    feats = _feats(last_close=102.0, sma20=100.0, sma50=99.0, adx=15.0, rsi14=80.0)
    assert _baseline(feats) == {"pattern": "none"}


def test_predict_symbol_allow_skip_returns_none(db):
    """allow_skip=True + no pattern → None and NO prediction row inserted."""
    feats = _feats()
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
    )
    assert result is None
    n = db.execute("SELECT COUNT(*) AS c FROM predictions").fetchone()["c"]
    assert n == 0, "no prediction row should be inserted when skipping"


def test_predict_symbol_allow_skip_false_inserts_flat(db):
    """allow_skip=False (live default) keeps old behavior: flat row persisted."""
    feats = _feats()
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=False,
    )
    assert result is not None
    assert result["direction"] == "flat"
    n = db.execute("SELECT COUNT(*) AS c FROM predictions").fetchone()["c"]
    assert n == 1


def test_predict_symbol_pattern_merged(db):
    """A pattern prediction returns the pattern key merged into the row."""
    feats = _feats(last_close=94.0, sma20=95.0, sma50=100.0, adx=25.0, rsi14=40.0)
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
    )
    assert result is not None
    assert result["pattern"] == "trend_down"
    assert result["direction"] == "down"


def test_negative_knowledge_suppresses_pattern(db):
    """Knowledge gate: a pattern flagged NEGATIVE for a symbol is suppressed."""
    add_knowledge(
        db,
        "negative",
        "pattern trend_up on TEST.NS: 0/20 hits (0%)",
        ref="pattern:TEST.NS:trend_up:negative",
    )
    feats = _feats(last_close=106.0, sma20=105.0, sma50=100.0, adx=25.0, rsi14=60.0)
    # The raw baseline still fires trend_up...
    assert _baseline(feats)["pattern"] == "trend_up"
    # ...but predict_symbol suppresses it (skip, no row inserted).
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
    )
    assert result is None
    n = db.execute("SELECT COUNT(*) AS c FROM predictions").fetchone()["c"]
    assert n == 0


def test_negative_knowledge_only_affects_flagged_symbol(db):
    """Knowledge gate is per-symbol: other symbols keep the pattern."""
    add_knowledge(
        db,
        "negative",
        "pattern trend_up on OTHER.NS: 0/20 hits (0%)",
        ref="pattern:OTHER.NS:trend_up:negative",
    )
    feats = _feats(last_close=106.0, sma20=105.0, sma50=100.0, adx=25.0, rsi14=60.0)
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
    )
    assert result is not None
    assert result["pattern"] == "trend_up"

def test_pattern_gate_suppresses_negative_expectancy_patterns(db):
    """Pattern gate: meanrev_up is suppressed globally (negative expectancy)."""
    feats = _feats(last_close=100.0, rsi14=25.0, bollinger_lower=101.0)
    # Raw baseline fires meanrev_up...
    assert _baseline(feats)["pattern"] == "meanrev_up"
    # ...but the pattern gate suppresses it.
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
        suppress_patterns={"meanrev_up", "breakout_up", "breakout_down"},
    )
    assert result is None


def test_symbol_gate_blocks_symbols_without_positive_knowledge(db):
    """Symbol gate: only symbols with positive knowledge are traded."""
    add_knowledge(
        db,
        "positive",
        "pattern trend_down on GOOD.NS: 18/25 hits (72%)",
        ref="pattern:GOOD.NS:trend_down:positive",
    )
    feats = _feats(last_close=94.0, sma20=95.0, sma50=100.0, adx=25.0, rsi14=42.0)
    # GOOD.NS has positive knowledge -> allowed.
    good = predict_symbol(
        db,
        "GOOD.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
        pos_symbols={"GOOD.NS"},
    )
    assert good is not None and good["pattern"] == "trend_down"
    # TEST.NS has no positive knowledge -> blocked.
    bad = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
        pos_symbols={"GOOD.NS"},
    )
    assert bad is None


def test_direction_gate_suppresses_up_predictions(db):
    """Direction gate: 'down' suppresses up predictions."""
    feats = _feats(last_close=106.0, sma20=105.0, sma50=100.0, adx=25.0, rsi14=60.0)
    assert _baseline(feats)["direction"] == "up"
    result = predict_symbol(
        db,
        "TEST.NS",
        "2026-01-05",
        feats,
        None,
        "v1",
        None,
        0,
        "",
        "baseline",
        mode="baseline",
        allow_skip=True,
        direction_gate="down",
    )
    assert result is None


def test_positive_symbols_returns_symbols_with_positive_knowledge(db):
    """positive_symbols() returns symbols with >=1 positive pattern entry."""
    add_knowledge(
        db,
        "positive",
        "pattern trend_down on GOOD.NS: 18/25 hits (72%)",
        ref="pattern:GOOD.NS:trend_down:positive",
    )
    add_knowledge(
        db,
        "negative",
        "pattern meanrev_up on BAD.NS: 2/20 hits (10%)",
        ref="pattern:BAD.NS:meanrev_up:negative",
    )
    assert positive_symbols(db) == {"GOOD.NS"}
