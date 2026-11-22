"""Deterministic evening validation + confidence calibration.

Validation for day D uses the D close bar (``as_of = D 16:00 IST``). The
actual direction is close vs open; a prediction is a hit when the predicted
direction equals the actual direction.

``mode="agent"`` additionally asks the validator LLM to assess the prediction
logic and propose knowledge. Python still computes the hit — the agent only
adds qualitative assessment + knowledge proposals.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date
from typing import Any

from ..learning.knowledge import add_knowledge
from ..opencode.agent import build_validation_prompt
from ..opencode.parser import ParseError, parse_llm_json
from ..prediction.store import list_predictions, record_agent_run

EPSILON = 1e-9


def _actual_direction(open_: float, close: float) -> str:
    if close > open_ + EPSILON:
        return "up"
    if close < open_ - EPSILON:
        return "down"
    return "flat"


def confidence_bucket(confidence: float) -> str:
    """Map a confidence to a 0.1-wide bucket label, e.g. 0.55 -> '0.5-0.6'."""
    low = min(int(confidence * 10) / 10.0, 0.9)
    high = round(low + 0.1, 1)
    return f"{low:.1f}-{high:.1f}"


def update_calibration(conn: sqlite3.Connection, run_date: date | str) -> None:
    """Update per-symbol confidence-bucket calibration from validated predictions."""
    run_date_str = run_date.isoformat() if hasattr(run_date, "isoformat") else str(run_date)
    rows = conn.execute(
        """SELECT v.symbol, v.hit, p.confidence
           FROM validation v
           JOIN predictions p ON p.id = v.prediction_id
           WHERE v.run_date = ?""",
        (run_date_str,),
    ).fetchall()
    for r in rows:
        bucket = confidence_bucket(r["confidence"])
        conn.execute(
            """INSERT INTO calibration(symbol, bucket, n, hits, hit_rate, updated_at)
               VALUES (?, ?, 1, ?, ?, datetime('now'))
               ON CONFLICT(symbol, bucket) DO UPDATE SET
                 n = n + 1,
                 hits = hits + excluded.hits,
                 hit_rate = CAST(hits + excluded.hits AS REAL) / (n + 1),
                 updated_at = excluded.updated_at""",
            (r["symbol"], bucket, r["hit"], r["hit"]),
        )
    conn.commit()


def _agent_assess(
    conn: sqlite3.Connection,
    p: dict[str, Any],
    run_date_str: str,
    row: dict[str, Any],
    actual: str,
    hit: int,
    llm_client: Any,
    daily_run_id: int | None,
) -> bool:
    """Ask the validator LLM to assess one prediction; record + learn.

    Returns True when an assessment was recorded. Never raises: any LLM/parse
    failure degrades to deterministic-only validation.
    """
    try:
        prompt = build_validation_prompt(
            symbol=p["symbol"],
            run_date=date.fromisoformat(run_date_str),
            prediction=p,
            actual_open=float(row["open"]),
            actual_close=float(row["close"]),
            actual_direction=actual,
            hit=bool(hit),
            # Feature values are not persisted with the prediction; the
            # validator reasons from the prediction + actual outcome only.
            features_summary=None,
        )
        text = llm_client.complete(prompt, agent="aiops-validator")
        parsed = parse_llm_json(text)
    except Exception:
        return False
    args = parsed.get("args") if isinstance(parsed, dict) else None
    if not isinstance(args, dict) or parsed.get("tool") != "validate":
        return False

    record_agent_run(
        conn,
        daily_run_id,
        p["symbol"],
        "user",
        prompt,
        turn=1,
        model=getattr(llm_client, "model", None) or "opencode",
    )
    record_agent_run(
        conn,
        daily_run_id,
        p["symbol"],
        "assistant",
        json.dumps(parsed, ensure_ascii=False),
        turn=2,
        model=getattr(llm_client, "model", None) or "opencode",
    )

    kp = args.get("knowledge_proposal")
    if isinstance(kp, dict):
        kind = str(kp.get("kind", "none")).strip().lower()
        content = str(kp.get("content", "")).strip()
        if kind in ("positive", "negative") and content:
            add_knowledge(
                conn,
                kind,
                content,
                ref=f"validator:{p['symbol']}:{run_date_str}",
            )
    return True


def validate_predictions(
    conn: sqlite3.Connection,
    run_date: date | str,
    market_rows: dict[str, dict[str, Any]],
    *,
    mode: str = "deterministic",
    llm_client: Any = None,
    daily_run_id: int | None = None,
) -> dict[str, Any]:
    """Validate every prediction for ``run_date`` against D close bars.

    ``market_rows`` maps symbol → row dict with at least ``open``/``close``
    (and optionally ``data_version``). Inserts into ``validation``
    (UNIQUE prediction_id → INSERT OR IGNORE), then updates calibration.

    ``mode="deterministic"`` (default) is the classic behavior. ``mode="agent"``
    additionally calls the validator LLM per prediction (when ``llm_client`` is
    provided): the assessment is recorded in ``agent_runs`` and any
    positive/negative knowledge proposal is added (deduped by ref). Python
    still computes the hit — the agent never computes numbers.

    Returns ``{total, hits, hit_rate, per_symbol, agent_assessments}``.
    """
    run_date_str = run_date.isoformat() if hasattr(run_date, "isoformat") else str(run_date)
    preds = list_predictions(conn, run_date=run_date_str)

    total = 0
    hits = 0
    per_symbol: dict[str, dict[str, Any]] = {}
    agent_assessments = 0

    for p in preds:
        row = market_rows.get(p["symbol"])
        if row is None:
            continue  # no D close bar for this symbol — cannot validate
        actual = _actual_direction(float(row["open"]), float(row["close"]))
        hit = 1 if actual == p["direction"] else 0
        error_pct = (
            (float(row["close"]) - float(row["open"])) / float(row["open"]) * 100.0
            if float(row["open"])
            else 0.0
        )
        conn.execute(
            """INSERT OR IGNORE INTO validation
               (prediction_id, symbol, run_date, actual_open, actual_close,
                actual_direction, hit, error_pct, validated_at, data_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)""",
            (
                p["id"],
                p["symbol"],
                run_date_str,
                float(row["open"]),
                float(row["close"]),
                actual,
                hit,
                error_pct,
                row.get("data_version", "v1"),
            ),
        )
        total += 1
        hits += hit
        ps = per_symbol.setdefault(p["symbol"], {"total": 0, "hits": 0})
        ps["total"] += 1
        ps["hits"] += hit

        if mode == "agent" and llm_client is not None:
            if _agent_assess(
                conn, p, run_date_str, row, actual, hit, llm_client, daily_run_id
            ):
                agent_assessments += 1

    conn.commit()
    update_calibration(conn, run_date_str)

    for s, v in per_symbol.items():
        v["hit_rate"] = round(v["hits"] / v["total"], 4) if v["total"] else 0.0

    return {
        "total": total,
        "hits": hits,
        "hit_rate": round(hits / total, 4) if total else 0.0,
        "per_symbol": per_symbol,
        "agent_assessments": agent_assessments,
    }