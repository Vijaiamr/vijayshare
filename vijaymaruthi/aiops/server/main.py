"""AIOps local HTTP API — FastAPI app.

Endpoints (all under /api/v1):
    GET  /health                 liveness
    GET  /status                 full status snapshot (used by the frontend proxy)
    GET  /runs                   recent daily_runs
    GET  /predictions            predictions (optional ?run_date= / ?symbol=)
    GET  /lessons                lessons (optional ?status=)
    GET  /calibration            calibration buckets
    POST /morning                trigger a morning run (baseline by default)
    POST /evening                trigger an evening run

The status payload includes `adk_ui_url` so the frontend never hard-codes
the ADK web UI port, plus an `adk` object with availability and error state.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Query

from aiops import config
from aiops.agents import ADK_ERROR, root_agent
from aiops.db.engine import connect
from aiops.learning.knowledge import current_knowledge
from aiops.learning.lessons import list_lessons
from aiops.workflows.evening import run_evening
from aiops.workflows.morning import run_morning
from aiops.workflows.runs import build_status


def _adk_status() -> dict:
    """ADK availability snapshot for the API (never raises)."""
    return {
        "available": root_agent is not None,
        "error": ADK_ERROR,
        "ui_url": config.ADK_UI_URL,
        "agent": root_agent.name if root_agent is not None else None,
    }


def _db():
    return connect()


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


def create_app() -> FastAPI:
    app = FastAPI(title="AIOPS API", version="0.1.0")

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/v1/status")
    def status():
        conn = _db()
        try:
            snap = build_status(conn)
            knowledge = current_knowledge(conn)
            return {
                "available": True,
                "db_path": str(config.DB_PATH),
                "prompt_version": config.PROMPT_VERSION,
                "knowledge_version": knowledge.get("knowledge_version"),
                "knowledge_hash": knowledge.get("knowledge_hash"),
                "adk_ui_url": config.ADK_UI_URL,
                "adk": _adk_status(),
                "next_scheduled": "Not configured",
                **snap,
            }
        finally:
            conn.close()

    @app.get("/api/v1/adk")
    def adk():
        """ADK root-agent availability (used by the frontend to gate the UI)."""
        return _adk_status()

    @app.get("/api/v1/runs")
    def runs(limit: int = Query(10, ge=1, le=100)):
        conn = _db()
        try:
            rows = conn.execute(
                "SELECT * FROM daily_runs ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            return {"runs": [_row_to_dict(r) for r in rows]}
        finally:
            conn.close()

    @app.get("/api/v1/predictions")
    def predictions(
        run_date: str | None = None,
        symbol: str | None = None,
        limit: int = Query(50, ge=1, le=500),
    ):
        conn = _db()
        try:
            sql = "SELECT * FROM predictions WHERE 1=1"
            params: list = []
            if run_date:
                sql += " AND run_date = ?"
                params.append(run_date)
            if symbol:
                sql += " AND symbol = ?"
                params.append(symbol)
            sql += " ORDER BY id DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(sql, params).fetchall()
            return {"predictions": [_row_to_dict(r) for r in rows]}
        finally:
            conn.close()

    @app.get("/api/v1/lessons")
    def lessons(status: str | None = None):
        conn = _db()
        try:
            items = list_lessons(conn, status=status)
            return {"lessons": items}
        finally:
            conn.close()

    @app.get("/api/v1/calibration")
    def calibration(symbol: str | None = None):
        conn = _db()
        try:
            sql = "SELECT * FROM calibration"
            params: list = []
            if symbol:
                sql += " WHERE symbol = ?"
                params.append(symbol)
            sql += " ORDER BY symbol, bucket"
            rows = conn.execute(sql, params).fetchall()
            return {"calibration": [_row_to_dict(r) for r in rows]}
        finally:
            conn.close()

    @app.post("/api/v1/morning")
    def morning(force: bool = False, mode: str = "baseline"):
        conn = _db()
        try:
            result = run_morning(conn, force=force, mode=mode)
            conn.close()
            return result
        except Exception as exc:  # noqa: BLE001 — surface as HTTP error
            conn.close()
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/v1/evening")
    def evening(force: bool = False):
        conn = _db()
        try:
            result = run_evening(conn, force=force)
            conn.close()
            return result
        except Exception as exc:  # noqa: BLE001
            conn.close()
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return app


app = create_app()