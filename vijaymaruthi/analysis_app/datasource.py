"""Pinned snapshot: the deterministic data layer.

The analyzer reads *only* from a pinned snapshot (a single SQLite file plus a
committed ``universe.json`` and ``manifest.json``). Building/refreshing the
snapshot is the one operation that may touch the network; it is invoked
explicitly via ``python -m analysis_app freeze``.

Snapshot layout (``analysis_app/snapshot/``)::

    universe.json   # frozen symbol list + its sha256
    snapshot.db     # tables: snapshot_meta, universe, ohlcv, fundamentals
    manifest.json   # logical + file hashes, counts, snapshot date

Determinism: ``snapshot_sha`` is the sha256 of the *logical* content (all rows
canonically serialised, sorted), so it is stable regardless of SQLite page
layout. The raw file hash is stored separately for integrity checks.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .determinism import BUILDER_VERSION, canonical_json, sha256_file, sha256_text

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshot_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS universe (
    ticker  TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ohlcv (
    ticker TEXT NOT NULL,
    date   TEXT NOT NULL,
    open   REAL, high REAL, low REAL, close REAL, volume REAL,
    PRIMARY KEY (ticker, date)
);
CREATE TABLE IF NOT EXISTS fundamentals (
    ticker      TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    info        TEXT NOT NULL,
    payload_sha TEXT NOT NULL
);
"""

OHLCV_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]


# ──────────────────────────────────────────────────────────────
# Reader
# ──────────────────────────────────────────────────────────────
class PinnedDataSource:
    """Read-only accessor over a pinned snapshot."""

    def __init__(self, snapshot_dir: str | Path):
        self.dir = Path(snapshot_dir)
        self.db_path = self.dir / "snapshot.db"
        self.universe_path = self.dir / "universe.json"
        self.manifest_path = self.dir / "manifest.json"
        if not self.db_path.exists():
            raise FileNotFoundError(
                f"pinned snapshot missing: {self.db_path}. Run `python -m "
                f"analysis_app freeze` first.")
        self._conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        self._conn.row_factory = sqlite3.Row

    # ── universe ──
    def universe(self) -> List[str]:
        rows = self._conn.execute(
            "SELECT ticker FROM universe ORDER BY ordinal").fetchall()
        return [r["ticker"] for r in rows]

    def universe_sha(self) -> str:
        return sha256_text(canonical_json(self.universe()))

    # ── OHLCV ──
    def ohlcv(self, ticker: str):
        """Return a clean single-index OHLCV DataFrame (or None if absent)."""
        import pandas as pd

        rows = self._conn.execute(
            "SELECT date, open, high, low, close, volume FROM ohlcv "
            "WHERE ticker = ? ORDER BY date", (ticker,)).fetchall()
        if not rows:
            return None
        df = pd.DataFrame(
            [(r["date"], r["open"], r["high"], r["low"], r["close"], r["volume"])
             for r in rows],
            columns=["Date"] + OHLCV_COLUMNS,
        )
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.set_index("Date").sort_index()
        return df[OHLCV_COLUMNS].astype(float)

    # ── fundamentals ──
    def fundamentals(self, ticker: str) -> Dict[str, Any]:
        row = self._conn.execute(
            "SELECT payload FROM fundamentals WHERE ticker = ?", (ticker,)).fetchone()
        return json.loads(row["payload"]) if row else {}

    def info(self, ticker: str) -> Dict[str, Any]:
        row = self._conn.execute(
            "SELECT info FROM fundamentals WHERE ticker = ?", (ticker,)).fetchone()
        return json.loads(row["info"]) if row else {}

    # ── meta ──
    def meta(self) -> Dict[str, str]:
        rows = self._conn.execute("SELECT key, value FROM snapshot_meta").fetchall()
        return {r["key"]: r["value"] for r in rows}

    def manifest(self) -> Dict[str, Any]:
        if self.manifest_path.exists():
            return json.loads(self.manifest_path.read_text())
        return {}

    def snapshot_sha(self) -> str:
        return self.meta().get("snapshot_sha", "")

    def close(self) -> None:
        self._conn.close()


# ──────────────────────────────────────────────────────────────
# Builder
# ──────────────────────────────────────────────────────────────
OhlcvProvider = Callable[[str], Optional["object"]]
FundamentalsProvider = Callable[[str], Optional[Tuple[dict, dict]]]


def _logical_sha(conn: sqlite3.Connection) -> str:
    """Hash of all logical rows (order-independent, layout-independent)."""
    parts: List[str] = []
    for ticker, ordinal in conn.execute(
            "SELECT ticker, ordinal FROM universe ORDER BY ordinal"):
        parts.append(f"U|{ticker}|{ordinal}")
    for row in conn.execute(
            "SELECT ticker, date, open, high, low, close, volume FROM ohlcv "
            "ORDER BY ticker, date"):
        parts.append("O|" + "|".join(str(x) for x in row))
    for ticker, payload, info, psha in conn.execute(
            "SELECT ticker, payload, info, payload_sha FROM fundamentals "
            "ORDER BY ticker"):
        parts.append(f"F|{ticker}|{psha}")
    return sha256_text("\n".join(parts))


def build_snapshot(
    universe: Iterable[str],
    ohlcv_provider: OhlcvProvider,
    fundamentals_provider: FundamentalsProvider,
    out_dir: str | Path,
    snapshot_date: str,
    created_from: str = "unknown",
    builder_version: str = BUILDER_VERSION,
    log: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Build a pinned snapshot. Returns the manifest dict."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    db_path = out / "snapshot.db"
    if db_path.exists():
        db_path.unlink()

    tickers = list(dict.fromkeys(universe))  # de-dup, preserve order
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA)
        ohlcv_rows = 0
        fund_count = 0
        for i, ticker in enumerate(tickers):
            conn.execute("INSERT INTO universe (ticker, ordinal) VALUES (?, ?)",
                         (ticker, i))
            df = ohlcv_provider(ticker)
            if df is not None and len(df):
                for ts, r in df.iterrows():
                    conn.execute(
                        "INSERT OR REPLACE INTO ohlcv "
                        "(ticker, date, open, high, low, close, volume) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (ticker, str(ts)[:10], float(r["Open"]), float(r["High"]),
                         float(r["Low"]), float(r["Close"]), float(r["Volume"])))
                    ohlcv_rows += 1
            fdata = fundamentals_provider(ticker)
            if fdata is not None:
                payload, info = fdata
                psha = sha256_text(canonical_json(payload))
                conn.execute(
                    "INSERT OR REPLACE INTO fundamentals "
                    "(ticker, payload, info, payload_sha) VALUES (?,?,?,?)",
                    (ticker, canonical_json(payload), canonical_json(info), psha))
                fund_count += 1
            if log and (i + 1) % 50 == 0:
                log(f"  ...{i + 1}/{len(tickers)} tickers")
        conn.commit()

        snapshot_sha = _logical_sha(conn)
        meta = {
            "snapshot_date": snapshot_date,
            "builder_version": builder_version,
            "created_from": created_from,
            "snapshot_sha": snapshot_sha,
            "tickers_count": str(len(tickers)),
            "ohlcv_rows": str(ohlcv_rows),
            "fundamentals_count": str(fund_count),
        }
        for k, v in meta.items():
            conn.execute("INSERT OR REPLACE INTO snapshot_meta (key, value) "
                         "VALUES (?, ?)", (k, v))
        conn.commit()
    finally:
        conn.close()

    universe_sha = sha256_text(canonical_json(tickers))
    (out / "universe.json").write_text(canonical_json({
        "snapshot_date": snapshot_date,
        "count": len(tickers),
        "universe_sha": universe_sha,
        "tickers": tickers,
    }))

    manifest = {
        "builder_version": builder_version,
        "snapshot_date": snapshot_date,
        "created_from": created_from,
        "universe_sha": universe_sha,
        "snapshot_sha": snapshot_sha,
        "tickers_count": len(tickers),
        "ohlcv_rows": ohlcv_rows,
        "fundamentals_count": fund_count,
        "db_file_sha": sha256_file(db_path),
    }
    (out / "manifest.json").write_text(canonical_json(manifest))
    return manifest


# ──────────────────────────────────────────────────────────────
# Providers
# ──────────────────────────────────────────────────────────────
def yfinance_ohlcv(period: str = "3y", as_of: Optional[str] = None):
    """OHLCV provider backed by yfinance (network). Trims to ``as_of``."""
    def _provider(ticker: str):
        import yfinance as yf

        try:
            df = yf.download(ticker, period=period, progress=False,
                             auto_adjust=True)
        except Exception:
            return None
        if df is None or df.empty:
            return None
        if getattr(df.columns, "nlevels", 1) > 1:
            df.columns = ["_".join(str(c) for c in col).strip()
                          for col in df.columns.values]
            rename = {}
            for col in df.columns:
                for base in OHLCV_COLUMNS:
                    if str(col).lower().startswith(base.lower()):
                        rename[col] = base
                        break
            df = df.rename(columns=rename)
        df = df[[c for c in OHLCV_COLUMNS if c in df.columns]]
        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        if as_of:
            df = df[df.index <= as_of]
        return df if len(df) else None
    return _provider


def csv_dir_ohlcv(csv_dir: str | Path):
    """OHLCV provider reading ``<csv_dir>/<ticker>.csv`` (offline)."""
    base = Path(csv_dir)

    def _provider(ticker: str):
        import pandas as pd

        for name in (f"{ticker}.csv", f"{ticker.replace('.', '_')}.csv"):
            p = base / name
            if p.exists():
                df = pd.read_csv(p)
                date_col = next((c for c in df.columns
                                 if c.lower() in ("date", "datetime", "time")), None)
                if date_col:
                    df[date_col] = pd.to_datetime(df[date_col])
                    df = df.set_index(date_col).sort_index()
                df = df[[c for c in OHLCV_COLUMNS if c in df.columns]]
                return df.astype(float) if len(df) else None
        return None
    return _provider


def reports_fundamentals(reports_dir: str | Path):
    """Fundamentals provider reading ``reports/<TICKER_SAFE>_data.json`` (offline).

    Returns ``(fundamentals_dict, info_dict)`` where ``info`` carries a derived
    ``marketCap`` (parsed from the valuation section) so the quantamental
    market-cap weighting stays deterministic and offline.
    """
    base = Path(reports_dir)

    def _provider(ticker: str):
        safe = ticker.replace(".", "_")
        p = base / f"{safe}_data.json"
        if not p.exists():
            return None
        try:
            data = json.loads(p.read_text())
        except Exception:
            return None
        fund = data.get("fundamentals") or {}
        if not fund:
            return None
        return fund, derive_info(fund)
    return _provider


def derive_info(fund: dict) -> dict:
    """Derive a minimal yfinance-``info``-shaped dict from fundamentals."""
    info: Dict[str, Any] = {}
    s12 = fund.get("section_12_valuation", {}) or {}
    cap = _parse_market_cap(s12.get("market_cap"))
    if cap is not None:
        info["marketCap"] = cap
    s01 = fund.get("section_01_company_overview", {}) or {}
    if s01.get("sector"):
        info["sector"] = s01["sector"]
    return info


def _parse_market_cap(value: Any) -> Optional[float]:
    """Parse '₹1,688,853 Cr' -> 1.688853e13 (crore = 1e7)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    import re

    s = str(value)
    m = re.search(r"([\d,]+(?:\.\d+)?)", s)
    if not m:
        return None
    num = float(m.group(1).replace(",", ""))
    low = s.lower()
    if "cr" in low:
        return num * 1e7
    if "b" in low and "bn" in low:
        return num * 1e9
    if "m" in low and "mn" in low:
        return num * 1e6
    return num
