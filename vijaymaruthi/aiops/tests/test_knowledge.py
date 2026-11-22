"""Knowledge accumulation tests — pattern stats, promotion, dedupe by ref."""

from __future__ import annotations

from aiops.learning.knowledge import (
    add_knowledge,
    promote_pattern_knowledge,
    update_pattern_stats,
)


def _seed_pattern(db, symbol, pattern, hits, n):
    """Insert ``n`` observations with ``hits`` hits for (symbol, pattern)."""
    for i in range(n):
        update_pattern_stats(db, symbol, pattern, 1 if i < hits else 0)


def test_update_pattern_stats_upsert(db):
    _seed_pattern(db, "TEST.NS", "trend_up", hits=3, n=5)
    row = db.execute(
        "SELECT * FROM pattern_stats WHERE symbol = 'TEST.NS' AND pattern = 'trend_up'"
    ).fetchone()
    assert row["n"] == 5
    assert row["hits"] == 3
    assert row["hit_rate"] == 0.6


def test_promote_pattern_knowledge(db):
    _seed_pattern(db, "TEST.NS", "trend_up", hits=4, n=5)      # 0.8 → positive
    _seed_pattern(db, "TEST.NS", "trend_down", hits=1, n=5)    # 0.2 → negative
    _seed_pattern(db, "TEST.NS", "meanrev_up", hits=3, n=5)    # 0.6 → positive (boundary)
    _seed_pattern(db, "TEST.NS", "meanrev_down", hits=2, n=5)  # 0.4 → negative (boundary)
    _seed_pattern(db, "TEST.NS", "breakout_up", hits=5, n=10)  # 0.5 → leave

    res = promote_pattern_knowledge(db, min_obs=5)
    assert res["considered"] == 5
    assert res["added_positive"] == 2
    assert res["added_negative"] == 2

    kinds = {
        r["kind"]
        for r in db.execute("SELECT kind FROM knowledge").fetchall()
    }
    assert kinds == {"positive", "negative"}
    contents = [r["content"] for r in db.execute("SELECT content FROM knowledge").fetchall()]
    assert any("trend_up" in c and "4/5" in c for c in contents)
    assert any("trend_down" in c and "1/5" in c for c in contents)
    # The 0.5 pattern must NOT be promoted.
    assert not any("breakout_up" in c for c in contents)


def test_promote_pattern_knowledge_dedupe(db):
    _seed_pattern(db, "TEST.NS", "trend_up", hits=4, n=5)
    first = promote_pattern_knowledge(db, min_obs=5)
    assert first["added_positive"] == 1

    # Second promote: same ref+kind exists → nothing new added.
    second = promote_pattern_knowledge(db, min_obs=5)
    assert second["added_positive"] == 0
    assert second["added_negative"] == 0
    n = db.execute("SELECT COUNT(*) AS c FROM knowledge").fetchone()["c"]
    assert n == 1


def test_add_knowledge_dedupe_by_ref(db):
    id1 = add_knowledge(db, "positive", "pattern worked", ref="validator:TEST.NS:2026-01-05")
    assert id1 is not None
    id2 = add_knowledge(db, "positive", "pattern worked", ref="validator:TEST.NS:2026-01-05")
    assert id2 is None  # dedupe by ref+kind
    # Different kind with the same ref is allowed.
    id3 = add_knowledge(db, "negative", "pattern failed", ref="validator:TEST.NS:2026-01-05")
    assert id3 is not None
    # No ref → always inserts.
    id4 = add_knowledge(db, "positive", "another observation")
    assert id4 is not None


def test_add_knowledge_invalid_kind(db):
    import pytest

    with pytest.raises(ValueError):
        add_knowledge(db, "bogus", "content")