"""Date-range backtest tests — recursive replay, pattern gating, knowledge accumulation."""

from __future__ import annotations

from datetime import date

from conftest import synthetic_ohlcv
from aiops.market.fetch import upsert_daily
from aiops.workflows.backtest import run_backtest

RANGE_START = "2024-06-01"
RANGE_END = "2025-12-31"


def _seed_two_years(db):
    """Seed ~2 years of synthetic weekdays ending 2025-12-31 (offline)."""
    rows = synthetic_ohlcv(n=530, seed=42, end=date(2025, 12, 31))
    upsert_daily(db, rows)
    return rows


def _disable_gates(monkeypatch):
    """Isolate backtest mechanics from the v3 knowledge gates (fresh DBs have
    no positive knowledge, so the symbol gate would block everything)."""
    from aiops import config

    monkeypatch.setattr(config, "SYMBOL_GATE", False)
    monkeypatch.setattr(config, "SUPPRESS_PATTERNS", set())


def test_backtest_range(db, monkeypatch):
    _seed_two_years(db)
    _disable_gates(monkeypatch)
    res = run_backtest(
        db,
        start=RANGE_START,
        end=RANGE_END,
        years=None,
        mode="baseline",
        validate_mode="deterministic",
    )

    assert res["start"] == RANGE_START
    assert res["end"] == RANGE_END
    assert res["days"] > 100, f"expected a multi-year replay, got {res['days']} days"
    assert res["predictions"] > 0
    assert res["hit_rate"] >= 0.0

    # Predictions only on pattern days (no force-fit).
    for p in res["prediction_list"]:
        assert "pattern" in p, f"prediction {p['id']} has no pattern key"
        assert p["pattern"] != "none"

    # Validation rows exist for the replayed window.
    n_val = db.execute("SELECT COUNT(*) AS c FROM validation").fetchone()["c"]
    assert n_val >= res["predictions"], "every prediction must be validated"

    # Pattern stats populated.
    n_stats = db.execute("SELECT COUNT(*) AS c FROM pattern_stats").fetchone()["c"]
    assert n_stats > 0

    # Knowledge promotion ran and returned the expected structure.
    assert set(res["knowledge"]) == {"added_positive", "added_negative", "considered"}
    assert res["knowledge"]["considered"] >= 0

    # Per-symbol coverage reported.
    ps = res["per_symbol"]["TEST.NS"]
    assert ps["bars"] > 0
    assert ps["first_date"] is not None and ps["last_date"] is not None
    assert ps["predictions"] == res["predictions"]

    # Temporal boundary: no D bar is observable at a D prediction's as_of.
    for p in res["prediction_list"]:
        row = db.execute(
            """SELECT COUNT(*) AS c FROM market_daily
               WHERE symbol = ? AND date >= ? AND available_at <= ?""",
            (p["symbol"], p["run_date"], p["as_of"]),
        ).fetchone()
        assert row["c"] == 0, (
            f"future leakage: prediction {p['id']} ({p['symbol']} {p['run_date']}) "
            f"has {row['c']} bars with date >= run_date available at as_of"
        )


def test_backtest_range_pattern_stats_and_knowledge(db, monkeypatch):
    """Pattern outcomes accumulate and promote into knowledge when conclusive."""
    _seed_two_years(db)
    _disable_gates(monkeypatch)
    res = run_backtest(
        db,
        start=RANGE_START,
        end=RANGE_END,
        years=None,
        mode="baseline",
    )

    # Every validated pattern prediction contributed to pattern_stats.
    stats = {
        (r["symbol"], r["pattern"]): r
        for r in db.execute("SELECT * FROM pattern_stats").fetchall()
    }
    for p in res["prediction_list"]:
        key = (p["symbol"], p["pattern"])
        assert key in stats, f"pattern {p['pattern']} missing from pattern_stats"

    # Knowledge rows exist only for conclusive patterns (n >= 5, rate <= 0.4 or >= 0.6).
    for r in db.execute("SELECT kind, content FROM knowledge").fetchall():
        assert r["kind"] in {"positive", "negative"}
        assert "pattern" in r["content"]


def test_backtest_range_years_default(db, monkeypatch):
    """start given + years=5 → end = Dec 31 of start.year + 4."""
    _seed_two_years(db)
    _disable_gates(monkeypatch)
    res = run_backtest(db, start="2024-01-01", years=5, mode="baseline")
    assert res["start"] == "2024-01-01"
    assert res["end"] == "2028-12-31"
    # Data only covers through 2025-12-31; replay stops at the last available date.
    assert res["days"] > 0


def test_backtest_days_backward_compat(db):
    """days=... still replays the last N trading dates (old behavior)."""
    _seed_two_years(db)
    res = run_backtest(db, days=5, mode="baseline")
    assert res["days"] == 5
    assert res["predictions"] >= 0
    assert "prediction_list" in res


class _FakeLLM:
    """Deterministic fake opencode client: always predicts 'up'."""

    model = "fake-llm"

    def __init__(self):
        self.calls: list[tuple[str | None, str]] = []

    def complete(self, prompt: str, agent: str | None = None) -> str:
        self.calls.append((agent, prompt))
        if "You are the AIOps validator" in prompt:
            return (
                '{"tool":"validate","args":{"assessment":"ok",'
                '"pattern_quality":"medium",'
                '"knowledge_proposal":{"kind":"none","content":""}}}'
            )
        return (
            '{"tool":"predict","args":{"direction":"up","confidence":0.6,'
            '"target_pct":1.0,"stop_pct":-1.0,"rationale":"test"}}'
        )


def test_backtest_llm_mode_summary_counts_hits(db):
    """LLM-mode predictions (no pattern key) must be counted in summary hits.

    Regression: the summary aggregation previously skipped predictions without
    a ``pattern`` key, so LLM-mode runs always reported hits=0 even though
    validation rows existed.
    """
    _seed_two_years(db)
    fake = _FakeLLM()
    res = run_backtest(
        db,
        start="2025-11-01",
        end="2025-11-05",
        years=None,
        mode="llm",
        validate_mode="agent",
        llm_client=fake,
    )

    assert res["predictions"] > 0
    # Every prediction was validated.
    n_val = db.execute("SELECT COUNT(*) AS c FROM validation").fetchone()["c"]
    assert n_val == res["predictions"]
    # Summary hits must equal the actual validation hits in the DB.
    db_hits = db.execute("SELECT COALESCE(SUM(hit), 0) AS s FROM validation").fetchone()["s"]
    assert res["hits"] == db_hits
    # The validator agent was used for validation calls.
    assert any(agent == "aiops-validator" for agent, _ in fake.calls)
    # Prediction calls use the client's default agent (no override).
    assert any(agent is None for agent, _ in fake.calls)