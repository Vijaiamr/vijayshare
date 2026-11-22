"""SQLite engine — WAL, migrations, house style (mirrors share/analysis_db.py)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from .. import config

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _ensure_column(
    conn: sqlite3.Connection, table: str, column: str, ddl: str
) -> None:
    """Add ``column`` to ``table`` when it is missing (idempotent migration).

    ``ddl`` is the full ``ALTER TABLE ... ADD COLUMN ...`` statement (minus the
    ``ALTER TABLE <table>`` prefix). Checks ``PRAGMA table_info`` first so the
    migration is safe on databases created before the column existed.
    """
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column in cols:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
    conn.commit()


def migrate(conn: sqlite3.Connection, schema_path: Path | None = None) -> None:
    """Apply schema idempotently (CREATE ... IF NOT EXISTS)."""
    path = schema_path or SCHEMA_PATH
    conn.executescript(path.read_text())
    # Column migrations for databases created before a column existed.
    _ensure_column(
        conn, "knowledge", "ref", "ref TEXT"
    )
    # Index on the migrated column (fresh DBs get it here too; schema.sql
    # intentionally omits it so pre-ref databases upgrade cleanly).
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knowledge_ref_kind ON knowledge(ref, kind)"
    )
    conn.commit()


def init_db(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Create the DB, apply schema, seed meta + symbols."""
    conn = connect(db_path)
    migrate(conn)
    seed_meta(conn)
    seed_symbols(conn)
    conn.commit()
    return conn


def seed_meta(conn: sqlite3.Connection) -> None:
    defaults = {
        "schema_version": "1",
        "prompt_version": config.PROMPT_VERSION,
        "prompt_hash": "",
        "knowledge_version": str(config.KNOWLEDGE_VERSION_INIT),
        "knowledge_hash": "",
    }
    for key, value in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", (key, value)
        )


def seed_symbols(conn: sqlite3.Connection) -> None:
    for sym in config.symbols():
        conn.execute(
            "INSERT OR IGNORE INTO symbols(symbol, name) VALUES (?, ?)",
            (sym, sym),
        )


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """INSERT INTO meta(key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (key, value),
    )