"""Schema tests — table creation, immutability triggers, locked prediction protection."""

from __future__ import annotations

import sqlite3

import pytest

from conftest import synthetic_ohlcv
from aiops.market.fetch import upsert_daily
from aiops.prediction.store import insert_prediction


def test_init_db_creates_all_tables(db):
    """init_db must create every expected table."""
    tables = {
        r["name"]
        for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    expected = {
        "meta", "symbols", "market_daily", "daily_runs", "agent_runs",
        "predictions", "validation", "lessons", "recipes", "feedback",
        "calibration", "knowledge",
    }
    assert expected <= tables, f"missing: {expected - tables}"


def test_market_daily_update_rejected(db):
    """market_daily UPDATE must be rejected by the immutability trigger."""
    upsert_daily(db, synthetic_ohlcv(n=5, seed=1))
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE market_daily SET close = 999 WHERE symbol = 'TEST.NS'")
    db.rollback()


def test_locked_prediction_update_rejected(db):
    """Locked prediction UPDATE must be rejected by the immutability trigger."""
    pid = insert_prediction(
        db,
        symbol="TEST.NS",
        run_date="2026-09-01",
        direction="up",
        confidence=0.6,
        target_price=101.0,
        stop_price=99.0,
        rationale="test",
        as_of="2026-09-01T09:00:00+05:30",
        prompt_version="v1",
        prompt_hash="abc",
        knowledge_version=0,
        knowledge_hash="",
        model="test",
    )
    assert pid > 0
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "UPDATE predictions SET direction = 'down' WHERE id = ?", (pid,)
        )
    db.rollback()


def test_unlocked_prediction_update_allowed(db):
    """A prediction inserted WITHOUT locked_at must be updatable."""
    db.execute(
        """INSERT INTO predictions
           (symbol, run_date, direction, confidence, as_of)
           VALUES ('TEST.NS', '2026-09-01', 'up', 0.6, '2026-09-01T09:00:00+05:30')"""
    )
    db.commit()
    db.execute(
        "UPDATE predictions SET direction = 'down' WHERE symbol = 'TEST.NS'"
    )
    db.commit()
    row = db.execute(
        "SELECT direction FROM predictions WHERE symbol = 'TEST.NS'"
    ).fetchone()
    assert row["direction"] == "down"