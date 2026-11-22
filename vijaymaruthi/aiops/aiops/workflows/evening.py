"""Evening workflow — fetch D close, validate, calibrate, propose lessons.

Temporal contract: validation ``as_of = D 16:00 IST`` uses the D close bar.
Lesson proposals are deterministic in *selection* (miss > 1% or high-confidence
hit, at most one per symbol) and use the LLM only when ``llm_client`` is
provided — otherwise no lessons are proposed.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any

from .. import config
from ..clock import ist_now, validate_at
from ..learning.knowledge import current_knowledge
from ..learning.lessons import propose_lesson
from ..opencode.agent import build_lesson_prompt
from ..opencode.parser import ParseError, parse_llm_json
from ..prediction.store import list_predictions, record_agent_run
from ..market.fetch import fetch_daily, upsert_daily
from ..validation.engine import validate_predictions
from .runs import active_symbols, begin_run, finish_run

MISS_ERROR_PCT = 1.0
HIGH_CONFIDENCE_HIT = 0.7


def _maybe_propose_lessons(
    conn: sqlite3.Connection,
    run_date: date,
    llm_client: Any,
    run_id: int,
) -> list[int]:
    """Deterministically select lessons worth learning from; LLM writes them.

    Selection: at most one lesson per symbol when a prediction missed by
    > 1% or hit with confidence >= 0.7. Without ``llm_client`` → no lessons.
    """
    if llm_client is None:
        return []

    preds = list_predictions(conn, run_date=run_date.isoformat())
    validated = conn.execute(
        "SELECT * FROM validation WHERE run_date = ?", (run_date.isoformat(),)
    ).fetchall()
    vmap = {v["symbol"]: dict(v) for v in validated}

    proposed: list[int] = []
    seen: set[str] = set()
    for p in preds:
        v = vmap.get(p["symbol"])
        if v is None or p["symbol"] in seen:
            continue
        missed = (not v["hit"]) and abs(v["error_pct"] or 0.0) > MISS_ERROR_PCT
        high_conf_hit = bool(v["hit"]) and (p["confidence"] or 0.0) >= HIGH_CONFIDENCE_HIT
        if not (missed or high_conf_hit):
            continue
        seen.add(p["symbol"])

        prompt = build_lesson_prompt(p["symbol"], run_date, p, v)
        try:
            text = llm_client.complete(prompt)
            parsed = parse_llm_json(text)
        except Exception:
            continue
        args = parsed.get("args") if isinstance(parsed, dict) else None
        if not isinstance(args, dict) or parsed.get("tool") != "propose_lesson":
            continue
        title = str(args.get("title", "")).strip()
        body = str(args.get("body", "")).strip()
        if not title or not body:
            continue

        record_agent_run(
            conn,
            run_id,
            p["symbol"],
            "user",
            prompt,
            turn=1,
            model="opencode",
            prompt_version=config.PROMPT_VERSION,
        )
        record_agent_run(
            conn,
            run_id,
            p["symbol"],
            "assistant",
            text,
            turn=2,
            model="opencode",
            prompt_version=config.PROMPT_VERSION,
        )
        proposed.append(
            propose_lesson(
                conn,
                symbol=p["symbol"],
                title=title,
                body=body,
                source_run_id=run_id,
            )
        )
    return proposed


def run_evening(
    conn: sqlite3.Connection,
    run_date: date | str | None = None,
    *,
    force: bool = False,
    llm_client: Any = None,
) -> dict[str, Any]:
    """Run the evening validation workflow for ``run_date`` (default: today IST).

    Fetches the D close bar (falls back to the DB when the network is
    unavailable), validates predictions, updates calibration, and optionally
    proposes lessons. Idempotent via ``daily_runs``.
    """
    run_date = run_date or ist_now().date()
    if isinstance(run_date, str):
        run_date = date.fromisoformat(run_date)
    as_of = validate_at(run_date)

    run_id = begin_run(conn, "evening", run_date, as_of, force=force)
    if run_id is None:
        return {
            "run_id": None,
            "date": run_date.isoformat(),
            "skipped": True,
            "reason": "already completed",
        }

    try:
        symbols = active_symbols(conn)
        market_rows: dict[str, dict[str, Any]] = {}
        for symbol in symbols:
            rows = fetch_daily(
                symbol, start=run_date.isoformat(), end=run_date.isoformat()
            )
            if rows:
                upsert_daily(conn, rows)
                market_rows[symbol] = rows[0]
            else:
                row = conn.execute(
                    """SELECT * FROM market_daily
                       WHERE symbol = ? AND date = ?
                       ORDER BY data_version DESC LIMIT 1""",
                    (symbol, run_date.isoformat()),
                ).fetchone()
                if row:
                    market_rows[symbol] = dict(row)

        summary = validate_predictions(conn, run_date, market_rows)
        lessons = _maybe_propose_lessons(conn, run_date, llm_client, run_id)

        kv = current_knowledge(conn)
        finish_run(
            conn,
            run_id,
            status="completed",
            prompt_version=config.PROMPT_VERSION,
            prompt_hash="",
            knowledge_version=kv["knowledge_version"],
            knowledge_hash=kv["knowledge_hash"],
            model="opencode" if llm_client else "deterministic",
        )
        return {
            "run_id": run_id,
            "date": run_date.isoformat(),
            "validation": summary,
            "lessons_proposed": lessons,
        }
    except Exception as exc:
        finish_run(conn, run_id, status="failed", error=str(exc))
        raise