"""Thin JSON-serializable tool functions for the web UI layer (P4).

Each function takes a SQLite connection as its first argument; the ADK wiring
(``agents/root``) injects a fresh connection per call.
"""

from __future__ import annotations

import sqlite3

from ..learning.lessons import list_lessons
from ..prediction.store import list_predictions
from ..workflows.evening import run_evening as run_evening_workflow
from ..workflows.morning import run_morning as run_morning_workflow
from ..workflows.runs import build_status


def get_status(conn: sqlite3.Connection) -> dict:
    """Platform status snapshot (JSON-serializable)."""
    return build_status(conn)


def get_predictions(
    conn: sqlite3.Connection, run_date: str | None = None
) -> dict:
    """List predictions, optionally filtered by run_date."""
    return {"predictions": list_predictions(conn, run_date=run_date)}


def get_lessons(conn: sqlite3.Connection, status: str | None = None) -> dict:
    """List lessons, optionally filtered by status."""
    return {"lessons": list_lessons(conn, status=status)}


def run_morning(conn: sqlite3.Connection) -> dict:
    """Run the morning workflow for today in baseline mode (no LLM needed)."""
    return run_morning_workflow(conn, mode="baseline")


def run_evening(conn: sqlite3.Connection) -> dict:
    """Run the evening validation workflow for today."""
    return run_evening_workflow(conn)