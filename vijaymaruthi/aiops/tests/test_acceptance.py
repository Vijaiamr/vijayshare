"""Full offline acceptance chain on synthetic data via the CLI.

init → seed synthetic market_daily → backtest (baseline) → status →
morning (baseline, explicit date) → evening (explicit date) → status → validate.
"""

from __future__ import annotations

from datetime import date

from conftest import synthetic_ohlcv
from aiops import config
from aiops.db.engine import connect
from aiops.market.fetch import upsert_daily

# Synthetic data ends on this Friday; morning/evening replay that day offline.
SYNTHETIC_END = date(2026, 9, 11)


def test_acceptance_chain(monkeypatch, tmp_path):
    from aiops.cli.main import main

    monkeypatch.setenv("AIOPS_SYMBOLS", "TEST.NS")
    db_path = tmp_path / "acceptance.db"
    monkeypatch.setattr(config, "DB_PATH", db_path)

    # init
    assert main(["init"]) == 0

    # seed synthetic market data (offline)
    conn = connect(db_path)
    upsert_daily(conn, synthetic_ohlcv(n=120, seed=42, end=SYNTHETIC_END))
    conn.close()

    # backtest (baseline, no LLM)
    assert main(["backtest", "--days", "5", "--mode", "baseline"]) == 0

    # status
    assert main(["status"]) == 0

    # morning for the last synthetic day (baseline, no LLM, offline)
    assert main(["morning", "--date", SYNTHETIC_END.isoformat(), "--mode", "baseline"]) == 0

    # evening for the same day (validates with the D close bar already in DB)
    assert main(["evening", "--date", SYNTHETIC_END.isoformat()]) == 0

    # status + validate
    assert main(["status"]) == 0
    assert main(["validate"]) == 0

    # sane counts
    conn = connect(db_path)
    try:
        n_pred = conn.execute("SELECT COUNT(*) AS c FROM predictions").fetchone()["c"]
        n_val = conn.execute("SELECT COUNT(*) AS c FROM validation").fetchone()["c"]
        n_runs = conn.execute("SELECT COUNT(*) AS c FROM daily_runs").fetchone()["c"]
        n_lessons = conn.execute("SELECT COUNT(*) AS c FROM lessons").fetchone()["c"]
        n_recipes = conn.execute("SELECT COUNT(*) AS c FROM recipes").fetchone()["c"]
    finally:
        conn.close()

    assert n_pred >= 1, f"expected >= 1 prediction, got {n_pred}"
    assert n_val >= 1, f"expected >= 1 validation row, got {n_val}"
    assert n_runs >= 7, f"expected >= 7 runs (5 backtest + morning + evening), got {n_runs}"
    assert n_lessons == 0, "no LLM client → no lessons should be proposed"
    assert n_recipes == 3, f"expected 3 seeded recipes, got {n_recipes}"


def test_acceptance_idempotency(monkeypatch, tmp_path):
    """Re-running a completed morning/evening is a no-op without --force."""
    from aiops.cli.main import main

    monkeypatch.setenv("AIOPS_SYMBOLS", "TEST.NS")
    db_path = tmp_path / "acceptance2.db"
    monkeypatch.setattr(config, "DB_PATH", db_path)

    assert main(["init"]) == 0
    conn = connect(db_path)
    upsert_daily(conn, synthetic_ohlcv(n=120, seed=7, end=SYNTHETIC_END))
    conn.close()

    assert main(["morning", "--date", SYNTHETIC_END.isoformat(), "--mode", "baseline"]) == 0
    assert main(["morning", "--date", SYNTHETIC_END.isoformat(), "--mode", "baseline"]) == 0

    conn = connect(db_path)
    try:
        n_pred = conn.execute("SELECT COUNT(*) AS c FROM predictions").fetchone()["c"]
        n_morning_runs = conn.execute(
            "SELECT COUNT(*) AS c FROM daily_runs WHERE run_type = 'morning'"
        ).fetchone()["c"]
    finally:
        conn.close()

    assert n_pred == 1, f"idempotency broken: {n_pred} predictions"
    assert n_morning_runs == 1, f"idempotency broken: {n_morning_runs} morning runs"