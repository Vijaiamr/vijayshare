"""Versioned knowledge — identity + integrity + BM25 retrieval context.

``knowledge_version``/``knowledge_hash`` live in ``meta`` (human-readable
identity + sha256 content hash). ``bump_knowledge`` appends a versioned entry
and updates both. ``add_knowledge`` is the dedupe-aware entry point used by
validators and pattern promotion. ``knowledge_context`` retrieves the top-k
entries for an LLM prompt via BM25.
"""

from __future__ import annotations

import hashlib
import sqlite3

from ..db.engine import get_meta, set_meta
from .bm25 import BM25Index

VALID_KINDS = {"positive", "negative", "recipe", "lesson", "rule"}

# Cache of negative (symbol, pattern) pairs, keyed by knowledge_hash.
# Knowledge is versioned; the set only changes when knowledge changes.
_NEGATIVE_PATTERN_CACHE: dict[str, set[tuple[str, str]]] = {}

# Cache of symbols with >=1 positive knowledge entry, keyed by knowledge_hash.
_POSITIVE_SYMBOL_CACHE: dict[str, set[str]] = {}


def negative_patterns(
    conn: sqlite3.Connection, knowledge_hash: str | None = None
) -> set[tuple[str, str]]:
    """(symbol, pattern) pairs the knowledge base flags as NEGATIVE.

    Used by the baseline engine to suppress patterns that have been measured
    as anti-predictive for a specific symbol (e.g. ``meanrev_up`` on TCS.NS at
    11% over 26 years). Cached ONLY by a non-empty ``knowledge_hash`` — an
    empty hash (fresh DB, tests) always queries fresh so different databases
    never share a stale set. Long backtests should compute this once and pass
    it to ``predict_symbol`` explicitly.
    """
    if not knowledge_hash:
        return _query_negative_patterns(conn)
    key = knowledge_hash
    cached = _NEGATIVE_PATTERN_CACHE.get(key)
    if cached is not None:
        return cached
    out = _query_negative_patterns(conn)
    _NEGATIVE_PATTERN_CACHE[key] = out
    return out


def _query_negative_patterns(conn: sqlite3.Connection) -> set[tuple[str, str]]:
    rows = conn.execute(
        "SELECT ref FROM knowledge WHERE kind = 'negative' AND ref LIKE 'pattern:%'"
    ).fetchall()
    out: set[tuple[str, str]] = set()
    for r in rows:
        parts = (r["ref"] or "").split(":")
        # ref format: pattern:{symbol}:{pattern}:negative
        if len(parts) == 4 and parts[0] == "pattern" and parts[3] == "negative":
            out.add((parts[1], parts[2]))
    return out


def positive_symbols(
    conn: sqlite3.Connection, knowledge_hash: str | None = None
) -> set[str]:
    """Symbols with >=1 POSITIVE knowledge entry (reliable, measured edge).

    Used by the symbol gate: only trade symbols the knowledge base has
    measured as having a real edge. Cached ONLY by a non-empty
    ``knowledge_hash`` (same discipline as ``negative_patterns``).
    """
    if not knowledge_hash:
        return _query_positive_symbols(conn)
    key = knowledge_hash
    cached = _POSITIVE_SYMBOL_CACHE.get(key)
    if cached is not None:
        return cached
    out = _query_positive_symbols(conn)
    _POSITIVE_SYMBOL_CACHE[key] = out
    return out


def _query_positive_symbols(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT ref FROM knowledge WHERE kind = 'positive' AND ref LIKE 'pattern:%'"
    ).fetchall()
    out: set[str] = set()
    for r in rows:
        parts = (r["ref"] or "").split(":")
        # ref format: pattern:{symbol}:{pattern}:positive
        if len(parts) == 4 and parts[0] == "pattern" and parts[3] == "positive":
            out.add(parts[1])
    return out


def current_knowledge(conn: sqlite3.Connection) -> dict:
    """Return ``{knowledge_version, knowledge_hash}`` from meta."""
    return {
        "knowledge_version": int(get_meta(conn, "knowledge_version") or 0),
        "knowledge_hash": get_meta(conn, "knowledge_hash") or "",
    }


def bump_knowledge(
    conn: sqlite3.Connection, kind: str, content: str, ref: str | None = None
) -> dict:
    """Increment knowledge_version, hash the content, insert + update meta.

    Returns ``{knowledge_version, knowledge_hash, id}`` (``id`` is the new
    knowledge row id).
    """
    cur = current_knowledge(conn)
    version = cur["knowledge_version"] + 1
    h = hashlib.sha256(content.encode("utf-8")).hexdigest()
    cur2 = conn.execute(
        "INSERT INTO knowledge(kind, content, version, hash, ref) VALUES (?, ?, ?, ?, ?)",
        (kind, content, version, h, ref),
    )
    set_meta(conn, "knowledge_version", str(version))
    set_meta(conn, "knowledge_hash", h)
    conn.commit()
    return {
        "knowledge_version": version,
        "knowledge_hash": h,
        "id": cur2.lastrowid,  # type: ignore[return-value]
    }


def add_knowledge(
    conn: sqlite3.Connection,
    kind: str,
    content: str,
    ref: str | None = None,
) -> int | None:
    """Add a versioned knowledge entry, deduplicated by ``ref`` + ``kind``.

    ``kind`` must be one of ``{'positive','negative','recipe','lesson','rule'}``.
    When ``ref`` is given and a knowledge row with the same ``ref`` + ``kind``
    already exists, nothing is inserted and ``None`` is returned. Otherwise the
    entry is appended (bumping knowledge_version + hash) and its id returned.
    """
    if kind not in VALID_KINDS:
        raise ValueError(f"unknown knowledge kind: {kind!r}")
    if ref is not None:
        existing = conn.execute(
            "SELECT id FROM knowledge WHERE ref = ? AND kind = ?", (ref, kind)
        ).fetchone()
        if existing is not None:
            return None
    result = bump_knowledge(conn, kind, content, ref=ref)
    return result.get("id")


def update_pattern_stats(
    conn: sqlite3.Connection, symbol: str, pattern: str, hit: int | bool
) -> None:
    """Upsert ``pattern_stats`` for (symbol, pattern): n+1, hits+hit, hit_rate."""
    hit_i = 1 if hit else 0
    conn.execute(
        """INSERT INTO pattern_stats(symbol, pattern, n, hits, hit_rate, updated_at)
           VALUES (?, ?, 1, ?, ?, datetime('now'))
           ON CONFLICT(symbol, pattern) DO UPDATE SET
             n = n + 1,
             hits = hits + excluded.hits,
             hit_rate = CAST(hits + excluded.hits AS REAL) / (n + 1),
             updated_at = excluded.updated_at""",
        (symbol, pattern, hit_i, hit_i),
    )
    conn.commit()


def promote_pattern_knowledge(
    conn: sqlite3.Connection, min_obs: int = 50
) -> dict:
    """Promote accumulated pattern stats into versioned knowledge.

    For every ``pattern_stats`` row with ``n >= min_obs``:
    - ``hit_rate >= 0.6`` → ``add_knowledge('positive', ...)``
    - ``hit_rate <= 0.4`` → ``add_knowledge('negative', ...)``
    - otherwise the pattern is left alone (inconclusive).

    ``min_obs`` defaults to 50 (statistically meaningful sample). The old
    default of 5 promoted noise — 86% of promoted entries came from samples
    smaller than 20 and did not generalize. Dedupe is by ``ref``
    (``pattern:{symbol}:{pattern}:positive|negative``), so repeated promotion
    adds nothing new. Returns ``{added_positive, added_negative, considered}``.
    """
    rows = conn.execute(
        "SELECT symbol, pattern, n, hits, hit_rate FROM pattern_stats WHERE n >= ?",
        (min_obs,),
    ).fetchall()
    added_positive = 0
    added_negative = 0
    for r in rows:
        hit_rate = r["hit_rate"]
        if hit_rate is None:
            continue
        content = (
            f"pattern {r['pattern']} on {r['symbol']}: "
            f"{r['hits']}/{r['n']} hits ({hit_rate:.0%})"
        )
        if hit_rate >= 0.6:
            ref = f"pattern:{r['symbol']}:{r['pattern']}:positive"
            if add_knowledge(conn, "positive", content, ref=ref) is not None:
                added_positive += 1
        elif hit_rate <= 0.4:
            ref = f"pattern:{r['symbol']}:{r['pattern']}:negative"
            if add_knowledge(conn, "negative", content, ref=ref) is not None:
                added_negative += 1
    return {
        "added_positive": added_positive,
        "added_negative": added_negative,
        "considered": len(rows),
    }


def knowledge_context(
    conn: sqlite3.Connection, query: str, k: int = 5
) -> list[dict]:
    """Top-k knowledge entries (BM25) for LLM context, best first."""
    rows = conn.execute(
        "SELECT kind, content, version, hash FROM knowledge ORDER BY id"
    ).fetchall()
    if not rows:
        return []
    idx = BM25Index([r["content"] for r in rows])
    top = idx.top(query, k=k)
    return [
        {
            "kind": rows[i]["kind"],
            "content": rows[i]["content"],
            "version": rows[i]["version"],
            "hash": rows[i]["hash"],
            "score": round(s, 4),
        }
        for i, s in top
    ]