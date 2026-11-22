"""Shared test fixtures — synthetic data generator and temp DB."""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import numpy as np
import pytest

from aiops.db.engine import connect, init_db
from aiops.market.fetch import available_at_iso, upsert_daily


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Fresh in-memory database with TEST.NS as the only symbol."""
    monkeypatch.setenv("AIOPS_SYMBOLS", "TEST.NS")
    conn = init_db(tmp_path / "test.db")
    yield conn
    conn.close()


def synthetic_ohlcv(
    n: int = 120,
    seed: int = 42,
    symbol: str = "TEST.NS",
    start: date | None = None,
    end: date | None = None,
    base: float = 100.0,
    drift: float = 0.0005,
    vol: float = 0.015,
) -> list[dict]:
    """Deterministic random-walk OHLCV generator (weekdays only).

    Either ``start`` or ``end`` may be specified (not both). When neither is
    given ``start = date(2025, 1, 1)``.
    """
    rng = np.random.default_rng(seed)

    if end is not None:
        dates: list[date] = []
        d = end
        while len(dates) < n:
            if d.weekday() < 5:
                dates.append(d)
            d -= timedelta(days=1)
        dates.reverse()
    else:
        start = start or date(2025, 1, 1)
        dates = []
        d = start
        while len(dates) < n:
            if d.weekday() < 5:
                dates.append(d)
            d += timedelta(days=1)

    closes = [base]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1 + rng.normal(drift, vol)))

    rows: list[dict] = []
    for i, d in enumerate(dates):
        c = closes[i]
        o = closes[i - 1] * (1 + rng.normal(0, vol * 0.3)) if i else c
        hi = max(o, c) * (1 + abs(rng.normal(0, vol * 0.4)))
        lo = min(o, c) * (1 - abs(rng.normal(0, vol * 0.4)))
        v = int(rng.integers(1_000_000, 5_000_000))
        rows.append(
            {
                "symbol": symbol,
                "date": d.isoformat(),
                "open": round(float(o), 2),
                "high": round(float(hi), 2),
                "low": round(float(lo), 2),
                "close": round(float(c), 2),
                "volume": v,
                "available_at": available_at_iso(d),
                "source": "synthetic",
            }
        )
    return rows


@pytest.fixture()
def seed_market(db, n=120, seed=42):
    """Seed the database with 120 synthetic bars for TEST.NS and return them."""
    rows = synthetic_ohlcv(n=n, seed=seed)
    upsert_daily(db, rows)
    return rows