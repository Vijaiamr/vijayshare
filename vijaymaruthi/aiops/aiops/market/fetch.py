"""Market data fetching (yfinance) and immutable persistence.

Temporal contract
-----------------
Every `market_daily` row carries `available_at` — the moment the bar became
observable. For daily bars that is the trading date at 16:00 IST
(``available_at_iso``). All feature queries filter ``available_at <= as_of``;
the backtester replays this exact boundary per day.

Immutability
------------
`market_daily` is protected by a SQLite trigger: UPDATE is rejected.
Corrected data is a *new* row with a new ``data_version`` — never an UPDATE.
`upsert_daily` therefore uses INSERT OR IGNORE only.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, time, timedelta
from typing import Any

import pandas as pd

from ..clock import IST

SOURCE = "yfinance"
AVAILABLE_AT_TIME = time(16, 0)  # daily bars are observable at 16:00 IST


def available_at_iso(d: date) -> str:
    """ISO timestamp for a daily bar's availability (``d`` 16:00 IST)."""
    return datetime.combine(d, AVAILABLE_AT_TIME, IST).isoformat()


def fetch_daily(
    symbol: str, start: str | None = None, end: str | None = None
) -> list[dict[str, Any]]:
    """Fetch daily OHLCV bars from yfinance.

    ``end`` is exclusive (yfinance semantics): pass ``end=YYYY-MM-DD`` to get
    bars strictly *before* that date. Returns a list of row dicts:

        {symbol, date (YYYY-MM-DD), open, high, low, close, volume,
         available_at (date 16:00 IST), source="yfinance"}

    Any network/parse failure returns ``[]`` — the caller decides what to do.
    """
    try:
        import yfinance as yf
    except ImportError:  # pragma: no cover - declared dependency
        return []
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start, end=end, auto_adjust=False)
        if df is None or df.empty:
            return []
        rows: list[dict[str, Any]] = []
        for idx, row in df.iterrows():
            d = idx.date() if hasattr(idx, "date") else idx
            volume = row["Volume"]
            rows.append(
                {
                    "symbol": symbol,
                    "date": d.isoformat(),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": int(volume) if pd.notna(volume) else 0,
                    "available_at": available_at_iso(d),
                    "source": SOURCE,
                }
            )
        return rows
    except Exception:
        return []


def upsert_daily(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    """Persist daily bars immutably (INSERT OR IGNORE). Returns rows inserted.

    Never UPDATEs: corrected data is a new ``data_version`` row.
    """
    n = 0
    for r in rows:
        cur = conn.execute(
            """INSERT OR IGNORE INTO market_daily
               (symbol, date, open, high, low, close, volume, data_version,
                available_at, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?)""",
            (
                r["symbol"],
                r["date"],
                float(r["open"]),
                float(r["high"]),
                float(r["low"]),
                float(r["close"]),
                int(r.get("volume") or 0),
                r.get("available_at")
                or available_at_iso(date.fromisoformat(r["date"])),
                r.get("source", SOURCE),
            ),
        )
        n += cur.rowcount
    conn.commit()
    return n


def ensure_daily(
    conn: sqlite3.Connection,
    symbol: str,
    as_of: datetime | str,
    min_bars: int = 60,
    end: date | None = None,
) -> int:
    """Fetch + persist daily bars if fewer than ``min_bars`` are available.

    ``as_of`` is the temporal boundary (only bars with
    ``available_at <= as_of`` count). ``end`` is the exclusive fetch end date;
    when omitted it defaults to ``as_of`` date + 1 day. Returns rows inserted
    (0 when the data was already sufficient).
    """
    as_of_iso = as_of.isoformat() if hasattr(as_of, "isoformat") else str(as_of)
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM market_daily WHERE symbol = ? AND available_at <= ?",
        (symbol, as_of_iso),
    ).fetchone()["c"]
    if count >= min_bars:
        return 0
    as_of_date = (
        as_of.date() if hasattr(as_of, "date") else date.fromisoformat(str(as_of)[:10])
    )
    end_date = end or (as_of_date + timedelta(days=1))
    start_date = end_date - timedelta(days=250)
    rows = fetch_daily(symbol, start=start_date.isoformat(), end=end_date.isoformat())
    return upsert_daily(conn, rows)


def fetch_daily_range(
    symbol: str, start: str | date, end: str | date
) -> list[dict[str, Any]]:
    """Fetch daily OHLCV bars from yfinance for ``[start, end]`` inclusive.

    Same row shape as ``fetch_daily`` (symbol/date/open/high/low/close/volume/
    available_at=date 16:00 IST/source). ``end`` is inclusive here — the
    underlying yfinance call uses ``end + 1 day`` (yfinance ``end`` is
    exclusive). Any network/parse failure returns ``[]``.
    """
    start_d = date.fromisoformat(str(start))
    end_d = date.fromisoformat(str(end))
    return fetch_daily(
        symbol,
        start=start_d.isoformat(),
        end=(end_d + timedelta(days=1)).isoformat(),
    )


def ensure_daily_range(
    conn: sqlite3.Connection,
    symbol: str,
    start: str | date,
    end: str | date,
) -> int:
    """Fetch + persist daily bars for ``[start, end]`` if not already covered.

    Skips the network call when the DB already covers the full range (first
    bar <= start and last bar >= end within the range) — re-runs are fast.
    Returns rows inserted (0 when already covered or fetch failed).
    """
    start_d = date.fromisoformat(str(start))
    end_d = date.fromisoformat(str(end))
    row = conn.execute(
        """SELECT MIN(date) AS first_date, MAX(date) AS last_date, COUNT(*) AS c
           FROM market_daily
           WHERE symbol = ? AND date >= ? AND date <= ?""",
        (symbol, start_d.isoformat(), end_d.isoformat()),
    ).fetchone()
    if (
        row
        and row["c"]
        and row["first_date"] <= start_d.isoformat()
        and row["last_date"] >= end_d.isoformat()
    ):
        return 0
    rows = fetch_daily_range(symbol, start_d, end_d)
    return upsert_daily(conn, rows)


def fetch_fundamentals(symbol: str) -> dict[str, Any]:
    """Fetch current fundamentals from yfinance. Returns ``{}`` on failure.

    yfinance only exposes *current* fundamentals; the snapshot is labeled with
    ``as_of`` = today (IST) so consumers never mistake it for point-in-time
    history. Never crashes: any network/parse failure returns ``{}``.
    """
    try:
        import yfinance as yf
    except ImportError:  # pragma: no cover - declared dependency
        return {}
    try:
        info = yf.Ticker(symbol).info
        if not info:
            return {}
        return {
            "symbol": symbol,
            "as_of": datetime.now(IST).date().isoformat(),
            "pe": info.get("trailingPE"),
            "pb": info.get("priceToBook"),
            "roe": info.get("returnOnEquity"),
            "market_cap": info.get("marketCap"),
            "dividend_yield": info.get("dividendYield"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "source": SOURCE,
        }
    except Exception:
        return {}


def store_fundamentals(conn: sqlite3.Connection, row: dict[str, Any]) -> int:
    """Persist a fundamentals snapshot (INSERT OR IGNORE). Returns rows inserted."""
    if not row:
        return 0
    cur = conn.execute(
        """INSERT OR IGNORE INTO fundamentals
           (symbol, as_of, pe, pb, roe, market_cap, dividend_yield,
            sector, industry, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            row["symbol"],
            row["as_of"],
            row.get("pe"),
            row.get("pb"),
            row.get("roe"),
            row.get("market_cap"),
            row.get("dividend_yield"),
            row.get("sector"),
            row.get("industry"),
            row.get("source", SOURCE),
        ),
    )
    conn.commit()
    return cur.rowcount