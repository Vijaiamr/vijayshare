"""Starter recipes — reusable playbooks seeded on ``aiops init``."""

from __future__ import annotations

import sqlite3

DEFAULT_RECIPES: list[dict[str, str]] = [
    {
        "name": "Trend-following with ADX filter",
        "description": (
            "Enter in the direction of a confirmed trend (ADX >= 20) with "
            "SMA20/SMA50 alignment."
        ),
        "body": (
            "When regime is trend_up and ADX >= 20, bias predictions up; when "
            "trend_down, bias down. Avoid counter-trend entries in confirmed trends."
        ),
    },
    {
        "name": "Range mean-reversion",
        "description": (
            "Fade extremes inside a range regime using Bollinger bands."
        ),
        "body": (
            "In a range regime, expect reversion when close touches the upper or "
            "lower Bollinger band; predict flat-to-mean moves rather than breakouts."
        ),
    },
    {
        "name": "Volatility breakout",
        "description": (
            "High ATR% regimes favor momentum continuation over mean reversion."
        ),
        "body": (
            "In a high_volatility regime, expect larger moves; prefer momentum "
            "direction with wider stops and lower confidence."
        ),
    },
]


def seed_default_recipes(conn: sqlite3.Connection) -> int:
    """Insert starter recipes if the recipes table is empty. Returns rows inserted."""
    count = conn.execute("SELECT COUNT(*) AS c FROM recipes").fetchone()["c"]
    if count:
        return 0
    n = 0
    for r in DEFAULT_RECIPES:
        conn.execute(
            """INSERT OR IGNORE INTO recipes(name, description, body, version, status)
               VALUES (?, ?, ?, 1, 'active')""",
            (r["name"], r["description"], r["body"]),
        )
        n += 1
    conn.commit()
    return n


def list_recipes(conn: sqlite3.Connection) -> list[dict]:
    """List all recipes ordered by name."""
    return [
        dict(r)
        for r in conn.execute("SELECT * FROM recipes ORDER BY name").fetchall()
    ]