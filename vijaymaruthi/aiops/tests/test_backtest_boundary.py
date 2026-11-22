"""Backtest temporal-boundary tests — no future leakage in replayed days."""

from __future__ import annotations

from datetime import date

from aiops.clock import morning_data_as_of, predict_at
from aiops.market.features import build_features
from aiops.workflows.backtest import run_backtest


def test_backtest_boundary(db, seed_market, monkeypatch):
    """Every replayed prediction uses D 09:00 as_of and never D bars."""
    # Isolate backtest mechanics from the v3 knowledge gates (fresh DB has
    # no positive knowledge, so the symbol gate would block everything).
    from aiops import config

    monkeypatch.setattr(config, "SYMBOL_GATE", False)
    monkeypatch.setattr(config, "SUPPRESS_PATTERNS", set())
    res = run_backtest(db, days=5, mode="baseline")

    assert res["days"] == 5
    assert res["predictions"] >= 1
    assert res["hit_rate"] >= 0.0

    preds = res["prediction_list"]
    assert len(preds) >= 1

    for p in preds:
        d = date.fromisoformat(p["run_date"])
        # Prediction as_of must be exactly D 09:00 IST.
        assert p["as_of"] == predict_at(d).isoformat(), (
            f"prediction as_of {p['as_of']} != D 09:00 for {p['run_date']}"
        )
        # Features for D must never include D bars (available_at <= D-1 16:00).
        feats = build_features(db, p["symbol"], morning_data_as_of(d))
        assert feats["ok"] is True
        assert feats["last_date"] < p["run_date"], (
            f"future leakage: features for {p['symbol']} on {p['run_date']} "
            f"include {feats['last_date']}"
        )

    # Every prediction in the window must have a validation row.
    vrows = {
        v["prediction_id"]
        for v in db.execute("SELECT prediction_id FROM validation").fetchall()
    }
    for p in preds:
        assert p["id"] in vrows, f"prediction {p['id']} was never validated"


def test_backtest_requires_enough_data(db):
    """Backtest raises when there are fewer than days+30 trading dates."""
    from conftest import synthetic_ohlcv
    from aiops.market.fetch import upsert_daily

    upsert_daily(db, synthetic_ohlcv(n=40, seed=9))
    try:
        run_backtest(db, days=15, mode="baseline")
    except ValueError as exc:
        assert "not enough trading dates" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError for insufficient data")