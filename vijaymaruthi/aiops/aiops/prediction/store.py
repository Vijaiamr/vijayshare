"""Prediction storage and retrieval — immutable once locked."""

from __future__ import annotations

import sqlite3


def insert_prediction(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    run_date: str,
    direction: str,
    confidence: float,
    target_price: float | None,
    stop_price: float | None,
    rationale: str,
    as_of: str,
    prompt_version: str,
    prompt_hash: str,
    knowledge_version: int,
    knowledge_hash: str,
    model: str,
) -> int:
    """Persist a prediction (locked immediately — immutable once written).

    Idempotent: if a prediction already exists for (symbol, run_date), returns
    the existing id without modification.
    """
    existing = get_prediction(conn, symbol, run_date)
    if existing is not None:
        return existing["id"]
    cur = conn.execute(
        """INSERT OR IGNORE INTO predictions
           (symbol, run_date, direction, confidence, target_price, stop_price,
            rationale, as_of, prompt_version, prompt_hash, knowledge_version,
            knowledge_hash, model, locked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
        (
            symbol,
            run_date,
            direction,
            confidence,
            target_price,
            stop_price,
            rationale,
            as_of,
            prompt_version,
            prompt_hash,
            knowledge_version,
            knowledge_hash,
            model,
        ),
    )
    conn.commit()
    if cur.rowcount == 0:
        existing = get_prediction(conn, symbol, run_date)
        return existing["id"] if existing else cur.lastrowid  # type: ignore[return-value]
    return cur.lastrowid  # type: ignore[return-value]


def get_prediction(
    conn: sqlite3.Connection, symbol: str, run_date: str
) -> dict | None:
    """Return the prediction for a (symbol, run_date) pair, or ``None``."""
    row = conn.execute(
        "SELECT * FROM predictions WHERE symbol = ? AND run_date = ?",
        (symbol, run_date),
    ).fetchone()
    return dict(row) if row else None


def list_predictions(
    conn: sqlite3.Connection,
    run_date: str | None = None,
    symbol: str | None = None,
) -> list[dict]:
    """Return predictions, optionally filtered by run_date and/or symbol."""
    q = "SELECT * FROM predictions"
    conds: list[str] = []
    params: list[str | int] = []
    if run_date is not None:
        conds.append("run_date = ?")
        params.append(run_date)
    if symbol is not None:
        conds.append("symbol = ?")
        params.append(symbol)
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY run_date, symbol"
    return [dict(r) for r in conn.execute(q, params).fetchall()]


def record_agent_run(
    conn: sqlite3.Connection,
    daily_run_id: int | None,
    symbol: str,
    role: str,
    content: str,
    *,
    turn: int = 1,
    tool_calls: str | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    prompt_hash: str | None = None,
    knowledge_version: int | None = None,
    knowledge_hash: str | None = None,
) -> None:
    """Insert a row into ``agent_runs`` (full audit trail of every LLM interaction)."""
    conn.execute(
        """INSERT INTO agent_runs
           (daily_run_id, symbol, turn, role, content, tool_calls, model,
            prompt_version, prompt_hash, knowledge_version, knowledge_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            daily_run_id,
            symbol,
            turn,
            role,
            content,
            tool_calls,
            model,
            prompt_version,
            prompt_hash,
            knowledge_version,
            knowledge_hash,
        ),
    )
    conn.commit()