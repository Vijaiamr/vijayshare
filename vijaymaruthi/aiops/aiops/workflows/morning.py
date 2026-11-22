"""Morning workflow — fetch data, build features, predict for day D.

Temporal contract: prediction ``as_of = D 09:00 IST``; features may only use
bars with ``available_at <= morning_data_as_of(D)`` = D-1 16:00 IST.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any

from .. import config
from ..clock import ist_now, morning_data_as_of
from ..learning.knowledge import current_knowledge
from ..market.features import build_features
from ..market.fetch import ensure_daily
from ..prediction.engine import predict_symbol
from .runs import active_symbols, begin_run, finish_run


def _model_for(mode: str, llm_client: Any) -> str:
    if mode == "llm":
        return (llm_client.model if llm_client and llm_client.model else "opencode")
    return "baseline"


def run_morning(
    conn: sqlite3.Connection,
    run_date: date | str | None = None,
    *,
    force: bool = False,
    mode: str = "llm",
    llm_client: Any = None,
) -> dict[str, Any]:
    """Run the morning prediction workflow for ``run_date`` (default: today IST).

    Idempotent: re-running a completed morning for the same date is a no-op
    unless ``force=True``. Returns a summary dict.
    """
    run_date = run_date or ist_now().date()
    if isinstance(run_date, str):
        run_date = date.fromisoformat(run_date)
    as_of = morning_data_as_of(run_date)

    run_id = begin_run(conn, "morning", run_date, as_of, force=force)
    if run_id is None:
        return {
            "run_id": None,
            "date": run_date.isoformat(),
            "skipped": True,
            "reason": "already completed",
        }

    try:
        symbols = active_symbols(conn)
        kv = current_knowledge(conn)
        prompt_version = config.PROMPT_VERSION
        knowledge_version = kv["knowledge_version"]
        knowledge_hash = kv["knowledge_hash"]
        model = _model_for(mode, llm_client)

        predictions: list[dict] = []
        insufficient: list[str] = []
        for symbol in symbols:
            # Ensure recent data exists (fetch only when missing/empty).
            ensure_daily(conn, symbol, as_of, min_bars=60, end=run_date)
            features = build_features(conn, symbol, as_of)
            if not features.get("ok"):
                insufficient.append(symbol)
            pred = predict_symbol(
                conn,
                symbol,
                run_date,
                features,
                llm_client,
                prompt_version,
                None,  # prompt_hash computed from the actual prompt
                knowledge_version,
                knowledge_hash,
                model,
                mode=mode,
                daily_run_id=run_id,
            )
            predictions.append(pred)

        prompt_hash = predictions[0]["prompt_hash"] if predictions else ""
        finish_run(
            conn,
            run_id,
            status="completed",
            prompt_version=prompt_version,
            prompt_hash=prompt_hash,
            knowledge_version=knowledge_version,
            knowledge_hash=knowledge_hash,
            model=model,
        )
        return {
            "run_id": run_id,
            "date": run_date.isoformat(),
            "symbols": len(symbols),
            "predictions": predictions,
            "insufficient": insufficient,
        }
    except Exception as exc:
        finish_run(conn, run_id, status="failed", error=str(exc))
        raise