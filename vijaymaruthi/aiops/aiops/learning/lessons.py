"""Lesson lifecycle — propose → observe → promote/reject.

Knowledge growth is gated: lessons start ``proposed``, accumulate
observations via ``add_observation``, and are promoted to ``accepted`` (and
written into the versioned ``knowledge`` table) or ``rejected`` by
``promote_lessons`` once they reach ``MIN_LESSON_OBSERVATIONS``.
"""

from __future__ import annotations

import math
import re
import sqlite3

from .. import config
from .knowledge import bump_knowledge

SUPPORTING_OUTCOMES = {"hit", "support", "positive", "yes", "true", "1"}


def _normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def propose_lesson(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    title: str,
    body: str,
    source_run_id: int | None = None,
) -> int:
    """Insert a proposed lesson, deduplicated by normalized title.

    Returns the lesson id (existing id when a duplicate title exists).
    """
    norm = _normalize_title(title)
    for r in conn.execute("SELECT id, title FROM lessons").fetchall():
        if _normalize_title(r["title"]) == norm:
            return r["id"]
    cur = conn.execute(
        """INSERT INTO lessons(symbol, title, body, source_run_id, observations, status)
           VALUES (?, ?, ?, ?, 0, 'proposed')""",
        (symbol, title, body, source_run_id),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def add_observation(
    conn: sqlite3.Connection,
    lesson_id: int,
    run_date: str,
    outcome: str,
    notes: str | None = None,
) -> None:
    """Record a feedback observation and increment the lesson's observation count."""
    conn.execute(
        "INSERT INTO feedback(lesson_id, run_date, outcome, notes) VALUES (?, ?, ?, ?)",
        (lesson_id, run_date, outcome, notes),
    )
    conn.execute(
        "UPDATE lessons SET observations = observations + 1 WHERE id = ?",
        (lesson_id,),
    )
    conn.commit()


def promote_lessons(conn: sqlite3.Connection) -> dict[str, list[int]]:
    """Promote/reject lessons that have enough observations.

    A lesson is ``accepted`` when the majority of its feedback outcomes are
    supporting (hit/support/positive/yes/true/1); accepted lessons are written
    into the versioned ``knowledge`` table. Otherwise it is ``rejected``.
    Lessons without observations stay ``proposed``.
    """
    threshold = config.MIN_LESSON_OBSERVATIONS
    lessons = conn.execute(
        "SELECT * FROM lessons WHERE status = 'proposed' AND observations >= ?",
        (threshold,),
    ).fetchall()
    promoted: dict[str, list[int]] = {"accepted": [], "rejected": []}
    for lesson in lessons:
        fb = conn.execute(
            "SELECT outcome FROM feedback WHERE lesson_id = ?", (lesson["id"],)
        ).fetchall()
        outcomes = [f["outcome"] for f in fb if f["outcome"]]
        if not outcomes:
            continue
        supporting = sum(
            1 for o in outcomes if str(o).strip().lower() in SUPPORTING_OUTCOMES
        )
        if supporting >= math.ceil(len(outcomes) / 2.0):
            status = "accepted"
            bump_knowledge(
                conn,
                "lesson",
                f"{lesson['title']}\n{lesson['body']}",
            )
        else:
            status = "rejected"
        conn.execute(
            "UPDATE lessons SET status = ? WHERE id = ?", (status, lesson["id"])
        )
        promoted[status].append(lesson["id"])
    conn.commit()
    return promoted


def list_lessons(
    conn: sqlite3.Connection, status: str | None = None
) -> list[dict]:
    """List lessons, optionally filtered by status."""
    q = "SELECT * FROM lessons"
    params: tuple = ()
    if status is not None:
        q += " WHERE status = ?"
        params = (status,)
    q += " ORDER BY created_at DESC, id DESC"
    return [dict(r) for r in conn.execute(q, params).fetchall()]