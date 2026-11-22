"""Run lifecycle — idempotency via ``daily_runs`` + shared helpers.

``daily_runs`` has ``UNIQUE(run_type, run_date)``. Re-running a completed run
is a no-op unless ``force=True``; failed/running runs can be resumed.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime
from typing import Any

from ..learning.knowledge import current_knowledge


def _dstr(value: date | str) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _tstr(value: datetime | str) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def get_run(
    conn: sqlite3.Connection, run_type: str, run_date: date | str
) -> dict | None:
    """Return the daily_runs row for (run_type, run_date), or ``None``."""
    row = conn.execute(
        "SELECT * FROM daily_runs WHERE run_type = ? AND run_date = ?",
        (run_type, _dstr(run_date)),
    ).fetchone()
    return dict(row) if row else None


def begin_run(
    conn: sqlite3.Connection,
    run_type: str,
    run_date: date | str,
    as_of: datetime | str,
    *,
    force: bool = False,
) -> int | None:
    """Begin a run. Returns the run id, or ``None`` when it is a no-op.

    - completed run + not force → ``None`` (idempotent no-op);
    - completed run + force → reset to ``running`` and reuse the id;
    - running/failed run → reset to ``running`` and reuse the id.
    """
    existing = get_run(conn, run_type, run_date)
    if existing is not None:
        if existing["status"] == "completed" and not force:
            return None
        conn.execute(
            """UPDATE daily_runs
               SET status = 'running', finished_at = NULL, error = NULL, as_of = ?
               WHERE id = ?""",
            (_tstr(as_of), existing["id"]),
        )
        conn.commit()
        return existing["id"]
    cur = conn.execute(
        """INSERT INTO daily_runs(run_type, run_date, status, as_of)
           VALUES (?, ?, 'running', ?)""",
        (run_type, _dstr(run_date), _tstr(as_of)),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def finish_run(
    conn: sqlite3.Connection,
    run_id: int,
    *,
    status: str,
    error: str | None = None,
    prompt_version: str | None = None,
    prompt_hash: str | None = None,
    knowledge_version: int | None = None,
    knowledge_hash: str | None = None,
    model: str | None = None,
) -> None:
    """Mark a run finished (completed or failed) with version metadata."""
    conn.execute(
        """UPDATE daily_runs
           SET status = ?, finished_at = datetime('now'), error = ?,
               prompt_version = ?, prompt_hash = ?, knowledge_version = ?,
               knowledge_hash = ?, model = ?
           WHERE id = ?""",
        (
            status,
            error,
            prompt_version,
            prompt_hash,
            knowledge_version,
            knowledge_hash,
            model,
            run_id,
        ),
    )
    conn.commit()


def active_symbols(conn: sqlite3.Connection) -> list[str]:
    """Active symbols from the universe, ordered."""
    return [
        r["symbol"]
        for r in conn.execute(
            "SELECT symbol FROM symbols WHERE active = 1 ORDER BY symbol"
        ).fetchall()
    ]


def build_status(conn: sqlite3.Connection) -> dict[str, Any]:
    """Platform status snapshot (runs, predictions, validation, lessons, ...)."""
    runs = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM daily_runs ORDER BY id DESC LIMIT 20"
        ).fetchall()
    ]
    n_pred = conn.execute("SELECT COUNT(*) AS c FROM predictions").fetchone()["c"]
    val = conn.execute(
        "SELECT COUNT(*) AS c, COALESCE(SUM(hit), 0) AS hits FROM validation"
    ).fetchone()
    lessons = {
        r["status"]: r["c"]
        for r in conn.execute(
            "SELECT status, COUNT(*) AS c FROM lessons GROUP BY status"
        ).fetchall()
    }
    calibration = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM calibration ORDER BY symbol, bucket"
        ).fetchall()
    ]
    return {
        "runs": runs,
        "predictions": n_pred,
        "validation": {
            "total": val["c"],
            "hits": val["hits"],
            "hit_rate": round(val["hits"] / val["c"], 4) if val["c"] else 0.0,
        },
        "lessons": lessons,
        "calibration": calibration,
        "knowledge": current_knowledge(conn),
    }