#!/usr/bin/env python3
"""
sync_to_supabase.py — Option B pipeline: push dashboard snapshot to Supabase.

Architecture
------------
    Mac (launchd daily job)
        └─ reads local SQLite (analysis_history.db) built by the analysis engine
        └─ pushes one row per ticker  → Supabase `portfolio_snapshot` (free Postgres)
        └─ pushes sync metadata       → Supabase `sync_meta`
    Vercel (frontend)
        └─ server proxy route /api/dashboard reads Supabase with the service key
        └─ the browser never sees database credentials

This script is the ONLY thing that needs your Mac's Python + pandas stack.
It runs for a few minutes each day; the cloud stays free and always-on.

Usage
-----
    python3 sync_to_supabase.py                  # full sync (snapshot + charts)
    python3 sync_to_supabase.py --dry-run       # show what would sync, push nothing
    python3 sync_to_supabase.py --db /path/to/analysis_history.db
    python3 sync_to_supabase.py --log logs/supabase_sync.log
    # Chart backfill (needs tables from chart_schema.sql):
    python3 sync_to_supabase.py --ohlcv-only --ohlcv-limit 500
    python3 sync_to_supabase.py --ohlcv-only --ohlcv-limit 500 --dry-run
    # Intraday backfill (needs ohlcv_intraday from chart_schema_v3.sql):
    python3 sync_to_supabase.py --intraday-only --intraday-limit 100
    python3 sync_to_supabase.py --intraday-only --intraday-limit 100 --dry-run

Config (environment variables or .env file in this directory)
-------------------------------------------------------------
    SUPABASE_URL                https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY   eyJ...  (secret — full DB access, never expose)

Dependencies: requests (already installed in your Python 3.13 environment).
"""

from __future__ import annotations

import argparse
import glob
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

# ── Paths (script lives in <share>/vijaymaruthi/sync/) ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VIJAYMARUTHI_DIR = os.path.dirname(SCRIPT_DIR)
SHARE_DIR = os.path.dirname(VIJAYMARUTHI_DIR)
if SHARE_DIR not in sys.path:
    sys.path.insert(0, SHARE_DIR)

DEFAULT_DB_PATH = os.path.join(SHARE_DIR, "reports", "analysis_history.db")
DEFAULT_LOG_PATH = os.path.join(VIJAYMARUTHI_DIR, "logs", "supabase_sync.log")
DEFAULT_REPORTS_DIR = os.path.join(SHARE_DIR, "reports")  # *_data.json fundamentals snapshots
ENV_FILE = os.path.join(SCRIPT_DIR, ".env")

log = logging.getLogger("supabase_sync")

BATCH_SIZE = 500          # rows per upsert request (small rows: snapshot/meta)
OHLCV_BATCH_SIZE = 8      # ohlcv rows are ~5MB each with 2500 candles — keep batches tiny
FUND_BATCH_SIZE = 100     # fundamentals rows are ~3KB each
DELETE_CHUNK = 100        # tickers per DELETE request
RETRIES = 3               # attempts per request
RETRY_BACKOFF = [1, 3, 6] # seconds between retries
REQUEST_TIMEOUT = 30      # seconds

# ── Chart-data backfill (Option B) ──
# 10y of daily candles is downloaded ONCE per ticker; the proxy routes slice
# it into 1mo/3mo/6mo/1y/2y/5y/10y on request (same cap as backend /api/v1/ohlcv).
OHLCV_PERIOD = "10y"
OHLCV_MAX_CANDLES = 2500
OHLCV_YF_SLEEP = 0.15         # seconds between downloads (Yahoo rate-limit guard)

# ── Intraday chart-data backfill (Phase E1: ohlcv_intraday table) ──
# Mirrors backend /api/v1/ohlcv interval support. yfinance intraday limits:
#   1m ≈ 7d, 5m/15m/30m/1h ≈ 60d, 4h ≈ 730d.
INTRADAY_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h"]
INTRADAY_PERIOD = {
    "1m": "7d",
    "5m": "60d",
    "15m": "60d",
    "30m": "60d",
    "1h": "730d",
    "4h": "730d",
}
INTRADAY_MAX_CANDLES = {
    "1m": 2250,   # 7d × ~330 bars/day
    "5m": 3000,
    "15m": 3000,
    "30m": 3000,
    "1h": 3000,
    "4h": 3000,
}
INTRADAY_YF_SLEEP = 0.15
INTRADAY_BATCH_SIZE = 4       # intraday rows are ~0.5MB each — keep batches tiny


# ── Minimal .env loader (no python-dotenv dependency) ──

def load_dotenv(path: str) -> Dict[str, str]:
    """Parse a simple KEY=VALUE .env file into a dict. Returns {} if absent."""
    if not os.path.isfile(path):
        return {}
    env: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key:
                    env[key] = value
    except OSError as exc:
        log.warning("Could not read %s: %s", path, exc)
    return env


# ── Config ──

def get_config() -> Dict[str, str]:
    """Resolve config from .env first, then environment. Validates required keys."""
    cfg: Dict[str, str] = {**load_dotenv(ENV_FILE), **dict(os.environ)}
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not cfg.get(k)]
    if missing:
        log.error(
            "Missing required config: %s\n"
            "  Copy sync/.env.example to sync/.env and fill in your Supabase project URL "
            "and service_role key (Supabase Dashboard → Settings → API).",
            ", ".join(missing),
        )
        raise SystemExit(2)
    return cfg


# ── Supabase REST helpers ──

def _headers(cfg: Dict[str, str], prefer: str = "return=minimal") -> Dict[str, str]:
    key = cfg["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _request(method: str, url: str, cfg: Dict[str, str], **kwargs: Any) -> requests.Response:
    """Request with retries and backoff for transient failures.

    Statement timeouts (Postgres 57014) are NOT retried — they fail because the
    payload is too large for one statement, so a retry can only fail again.
    """
    last_exc: Optional[Exception] = None
    for attempt in range(RETRIES):
        try:
            resp = requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
            if resp.status_code < 500:
                return resp
            if "57014" in resp.text:
                log.warning("Statement timeout (attempt %d/%d) — payload too large: %s",
                            attempt + 1, RETRIES, resp.text[:200])
                return resp
            log.warning("HTTP %s (attempt %d/%d): %s", resp.status_code, attempt + 1, RETRIES, resp.text[:200])
        except requests.RequestException as exc:
            last_exc = exc
            log.warning("Network error (attempt %d/%d): %s", attempt + 1, RETRIES, exc)
        if attempt + 1 < RETRIES:
            time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
    if last_exc:
        raise RuntimeError(f"Request failed after {RETRIES} attempts: {last_exc}")
    raise RuntimeError(f"Request failed after {RETRIES} attempts (HTTP 5xx)")


def _upsert_rows(cfg: Dict[str, str], table: str, rows: List[Dict[str, Any]],
                 conflict_col: str, batch_size: int = BATCH_SIZE) -> Tuple[int, int]:
    """Batch-insert-or-merge rows. Returns (ok_rows, failed_batches)."""
    base = f"{cfg['SUPABASE_URL']}/rest/v1/{table}"
    ok = 0
    failed = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        resp = _request(
            "POST",
            base,
            cfg,
            params={"on_conflict": conflict_col},
            headers=_headers(cfg, prefer="resolution=merge-duplicates,return=minimal"),
            data=json.dumps(chunk, default=str),
        )
        if resp.status_code in (200, 201, 204):
            ok += len(chunk)
        else:
            failed += 1
            log.error("Upsert %s failed (HTTP %s): %s", table, resp.status_code, resp.text[:300])
    return ok, failed


def _fetch_cloud_tickers(cfg: Dict[str, str], table: str) -> List[str]:
    """Fetch every ticker currently in the cloud table (paginated)."""
    base = f"{cfg['SUPABASE_URL']}/rest/v1/{table}"
    tickers: List[str] = []
    offset = 0
    step = 1000
    while True:
        resp = _request(
            "GET",
            base,
            cfg,
            params={"select": "ticker", "limit": step, "offset": offset},
            headers=_headers(cfg),
        )
        if resp.status_code != 200:
            log.error("Fetch cloud tickers failed (HTTP %s): %s", resp.status_code, resp.text[:200])
            return tickers
        rows = resp.json()
        tickers.extend(r["ticker"] for r in rows)
        if len(rows) < step:
            break
        offset += step
    return tickers


def _delete_stale(cfg: Dict[str, str], table: str, keep_tickers: List[str]) -> None:
    """
    Delete cloud rows whose ticker no longer exists in the local DB.

    Two-phase, diff-safe implementation:
      1. Fetch the tickers currently in the cloud table.
      2. Compute the stale set = cloud − keep, then delete only those.

    NOTE: never use chunked `not.in.(...)` filters against the FULL keep list —
    each chunk would treat the other chunks' rows as stale and wipe the table.
    The IN-based delete below targets disjoint chunks of the *stale* set, so
    every request only ever removes rows that genuinely must go.
    """
    keep = set(keep_tickers)
    cloud = _fetch_cloud_tickers(cfg, table)
    stale = [t for t in cloud if t not in keep]
    if not stale:
        log.info("No stale tickers to remove (%d in cloud)", len(cloud))
        return
    log.info("Removing %d stale ticker(s) from cloud", len(stale))
    base = f"{cfg['SUPABASE_URL']}/rest/v1/{table}"
    for i in range(0, len(stale), DELETE_CHUNK):
        chunk = stale[i:i + DELETE_CHUNK]
        in_list = ",".join(chunk)
        resp = _request(
            "DELETE",
            base,
            cfg,
            params={"ticker": f"in.({in_list})"},
            headers=_headers(cfg, prefer="return=minimal"),
        )
        if resp.status_code not in (200, 204):
            log.error("Stale delete failed (HTTP %s): %s", resp.status_code, resp.text[:300])
            return


def _update_meta(cfg: Dict[str, str], meta: Dict[str, str]) -> None:
    """Upsert sync metadata rows."""
    rows = [{"key": k, "value": str(v), "updated_at": datetime.now(timezone.utc).isoformat()}
            for k, v in meta.items()]
    ok, failed = _upsert_rows(cfg, "sync_meta", rows, "key")
    log.info("Meta updated: %d keys, %d failed", ok, failed)


# ── Build rows from local SQLite ──

def build_rows(db_path: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Read latest analysis per ticker + trend info → dashboard-ready rows."""
    from analysis_db import AnalysisDatabase

    adb = AnalysisDatabase(db_path)
    try:
        latest = adb.get_all_latest()
        if not latest:
            log.warning("No analysis rows in %s — nothing to sync", db_path)
            return [], {}
        log.info("Local DB: %d distinct tickers in %s", len(latest), db_path)

        rows: List[Dict[str, Any]] = []
        for row in latest:
            trend = adb.get_trend(row["ticker"], window=5)
            rows.append({
                "ticker": row["ticker"],
                "price": row.get("price"),
                "qm_rating": row.get("qm_rating"),
                "qm_score": row.get("qm_score"),
                "tech_signal": row.get("tech_signal"),
                "tech_confidence": row.get("tech_confidence"),
                "tech_score": row.get("tech_score"),
                "fund_rating": row.get("fund_rating"),
                "fund_score": row.get("fund_score"),
                "cap_category": row.get("cap_category") or "mid",
                "trend": trend["trend"],
                "score_change": trend["score_change"],
                "last_analyzed": row["run_timestamp"][:10] if row.get("run_timestamp") else None,
                "history_runs": trend["runs"],
                "health_pass": row.get("health_pass"),
                "cached": True,
                # Real-engine trade levels (from _classify_signal) — the Auto
                # Pilot reads these so it trades on the same analysis engine.
                "entry_low": row.get("entry_low"),
                "entry_high": row.get("entry_high"),
                "target1": row.get("target1"),
                "target2": row.get("target2"),
                "target3": row.get("target3"),
                "stop_loss": row.get("stop_loss"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

        # Rank: 1 = highest qm_score (None scores go last)
        rows.sort(key=lambda r: (r["qm_score"] is None, -(r["qm_score"] or 0)))
        for i, r in enumerate(rows, 1):
            r["rank"] = i

        total_runs = adb.count_runs()
        meta = {
            "last_sync_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "total_tickers": len(rows),
            "total_runs": total_runs,
            "total_nse": _estimate_nse_count(),
            "source": "mac-cron",
            "schema_version": "1",
        }
        return rows, meta
    finally:
        adb.close()


def _estimate_nse_count() -> int:
    """Best-effort total NSE symbol count (mirrors dashboard context)."""
    try:
        from nsetools import Nse
        codes = Nse().get_stock_codes()
        count = len(codes) if isinstance(codes, list) else len(codes or {})
        if count:
            return int(count)
    except Exception as exc:  # noqa: BLE001 — nsetools is optional
        log.debug("nsetools unavailable (%s); using DB ticker count", exc)
    return 0


# ── Chart-data backfill builders (Option B: ohlcv + fundamentals tables) ──

def _top_tickers(db_path: str, limit: int) -> List[str]:
    """Tickers ranked by qm_score desc (None last). limit=0 → all."""
    from analysis_db import AnalysisDatabase

    adb = AnalysisDatabase(db_path)
    try:
        latest = adb.get_all_latest()
    finally:
        adb.close()
    latest.sort(key=lambda r: (r.get("qm_score") is None, -(r.get("qm_score") or 0)))
    tickers = [r["ticker"] for r in latest]
    return tickers[:limit] if limit and limit > 0 else tickers


def build_ohlcv_rows(db_path: str, limit: int = 0) -> List[Dict[str, Any]]:
    """
    Download 5y daily candles for the top-N tickers → cloud-ready ohlcv rows.

    Mirror of backend /api/v1/ohlcv: yfinance period='5y', auto_adjust=True,
    MultiIndex flattened, NaN rows dropped, capped at 500 candles.
    One bad ticker never aborts the run — it logs and moves on.
    """
    try:
        import pandas as pd  # noqa: F401 — needed for MultiIndex flatten check
        import yfinance as yf
    except ImportError as exc:
        log.error("OHLCV builder needs pandas + yfinance (%s)", exc)
        return []

    tickers = _top_tickers(db_path, limit)
    log.info("OHLCV: fetching %s candles for %d ticker(s) (limit=%s)",
             OHLCV_PERIOD, len(tickers), limit or "all")

    rows: List[Dict[str, Any]] = []
    for i, ticker in enumerate(tickers, 1):
        try:
            df = yf.download(ticker, period=OHLCV_PERIOD, progress=False, auto_adjust=True)
            if df is None or df.empty:
                log.warning("OHLCV: no data for %s", ticker)
                continue
            if isinstance(df.columns, type(pd.MultiIndex(levels=[[]], codes=[[]]))):
                df.columns = df.columns.get_level_values(0)

            candles: List[Dict[str, Any]] = []
            for idx, row in df.iterrows():
                if any(pd.isna(row.get(c)) for c in ("Open", "High", "Low", "Close", "Volume")):
                    continue
                date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
                candles.append({
                    "time": date_str,
                    "open": round(float(row["Open"]), 4),
                    "high": round(float(row["High"]), 4),
                    "low": round(float(row["Low"]), 4),
                    "close": round(float(row["Close"]), 4),
                    "volume": int(row["Volume"]),
                })
            candles = candles[-OHLCV_MAX_CANDLES:]
            if not candles:
                log.warning("OHLCV: no clean candles for %s", ticker)
                continue
            # NOTE: keep candles as a real JSON array — PostgREST casts a
            # json.dumps STRING into a jsonb *string* (jsonb_typeof='string').
            # A real array in the payload becomes a jsonb array on insert.
            rows.append({
                "ticker": ticker,
                "candles": candles,
                "period": OHLCV_PERIOD,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as exc:  # noqa: BLE001 — one bad ticker must not abort
            log.warning("OHLCV: %s failed: %s", ticker, exc)
        time.sleep(OHLCV_YF_SLEEP)
        if i % 50 == 0:
            log.info("OHLCV: %d/%d tickers processed, %d rows built", i, len(tickers), len(rows))
    log.info("OHLCV: built %d rows from %d ticker(s)", len(rows), len(tickers))
    return rows


def build_intraday_rows(db_path: str, limit: int = 0,
                        intervals: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    Download intraday candles for the top-N tickers → cloud-ready rows for the
    ohlcv_intraday table (one row per (ticker, interval)).

    Mirrors backend /api/v1/ohlcv: yfinance interval + period, auto_adjust=True,
    MultiIndex flattened, NaN rows dropped, capped. Intraday timestamps are kept
    as ISO datetime strings (e.g. 2025-10-01T09:15:00) — the frontend converts
    them to epoch seconds for lightweight-charts. One bad ticker never aborts
    the run — it logs and moves on.
    """
    try:
        import pandas as pd  # noqa: F401 — needed for MultiIndex flatten check
        import yfinance as yf
    except ImportError as exc:
        log.error("Intraday builder needs pandas + yfinance (%s)", exc)
        return []

    tickers = _top_tickers(db_path, limit)
    intervals = intervals or INTRADAY_INTERVALS
    log.info("Intraday: fetching %d interval(s) for %d ticker(s) (limit=%s)",
             len(intervals), len(tickers), limit or "all")

    rows: List[Dict[str, Any]] = []
    for i, ticker in enumerate(tickers, 1):
        for interval in intervals:
            try:
                period = INTRADAY_PERIOD.get(interval, "60d")
                df = yf.download(ticker, period=period, interval=interval,
                                 progress=False, auto_adjust=True)
                if df is None or df.empty:
                    log.warning("Intraday: no %s data for %s", interval, ticker)
                    continue
                if isinstance(df.columns, type(pd.MultiIndex(levels=[[]], codes=[[]]))):
                    df.columns = df.columns.get_level_values(0)

                candles: List[Dict[str, Any]] = []
                for idx, row in df.iterrows():
                    if any(pd.isna(row.get(c)) for c in ("Open", "High", "Low", "Close", "Volume")):
                        continue
                    # Intraday: keep the full ISO datetime (frontend converts to epoch).
                    # Defensive fallback for a date-only index → date string.
                    if hasattr(idx, "strftime"):
                        time_str = idx.strftime("%Y-%m-%dT%H:%M:%S")
                    else:
                        time_str = str(idx)[:10]
                    candles.append({
                        "time": time_str,
                        "open": round(float(row["Open"]), 4),
                        "high": round(float(row["High"]), 4),
                        "low": round(float(row["Low"]), 4),
                        "close": round(float(row["Close"]), 4),
                        "volume": int(row["Volume"]),
                    })
                candles = candles[-INTRADAY_MAX_CANDLES.get(interval, 3000):]
                if not candles:
                    log.warning("Intraday: no clean %s candles for %s", interval, ticker)
                    continue
                # NOTE: keep candles as a real JSON array (same rule as OHLCV).
                rows.append({
                    "ticker": ticker,
                    "interval": interval,
                    "candles": candles,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as exc:  # noqa: BLE001 — one bad ticker must not abort
                log.warning("Intraday: %s %s failed: %s", ticker, interval, exc)
            time.sleep(INTRADAY_YF_SLEEP)
        if i % 25 == 0:
            log.info("Intraday: %d/%d tickers processed, %d rows built", i, len(tickers), len(rows))
    log.info("Intraday: built %d rows from %d ticker(s)", len(rows), len(tickers))
    return rows


def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert yfinance value to float (mirror of backend _safe_float)."""
    if val is None:
        return default
    try:
        import math
        v = float(val)
        return default if math.isnan(v) or math.isinf(v) else v
    except (TypeError, ValueError):
        return default


def _normalize_fundamentals(ticker: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Map a stored raw-yfinance fundamentals dict to the backend's canonical
    snake_case response and recompute the 0-100 fundamental health score.

    Field mapping + scoring are an exact copy of backend/api/main.py
    `_fetch_fundamentals` (lines ~1200-1276) so deployed fundamentals match
    what the Python engine would have returned for the same snapshot.
    """
    result = {
        "ticker": ticker,
        "name": str(raw.get("shortName") or raw.get("longName")
                    or ticker.replace(".NS", "").replace(".BO", "")),
        "sector": str(raw.get("sector") or ""),
        "industry": str(raw.get("industry") or ""),
        "market_cap": _safe_float(raw.get("marketCap")),
        "currency": str(raw.get("currency") or "INR"),
        "current_price": _safe_float(raw.get("currentPrice") or raw.get("regularMarketPrice")),
        "day_high": _safe_float(raw.get("dayHigh")),
        "day_low": _safe_float(raw.get("dayLow")),
        "fifty_two_week_high": _safe_float(raw.get("fiftyTwoWeekHigh")),
        "fifty_two_week_low": _safe_float(raw.get("fiftyTwoWeekLow")),
        "pe_trailing": _safe_float(raw.get("trailingPE")),
        "pe_forward": _safe_float(raw.get("forwardPE")),
        "pb_ratio": _safe_float(raw.get("priceToBook")),
        "ps_ratio": _safe_float(raw.get("priceToSalesTrailing12Months")),
        "peg_ratio": _safe_float(raw.get("pegRatio")),
        "dividend_yield": _safe_float(raw.get("dividendYield")),
        "eps_trailing": _safe_float(raw.get("trailingEps")),
        "eps_forward": _safe_float(raw.get("forwardEps")),
        "book_value": _safe_float(raw.get("bookValue")),
        "revenue": _safe_float(raw.get("totalRevenue")),
        "revenue_growth": _safe_float(raw.get("revenueGrowth")),
        "net_income": _safe_float(raw.get("netIncomeToCommon")),
        "profit_margin": _safe_float(raw.get("profitMargins")),
        "operating_margin": _safe_float(raw.get("operatingMargins")),
        "roe": _safe_float(raw.get("returnOnEquity")),
        "roa": _safe_float(raw.get("returnOnAssets")),
        "debt_to_equity": _safe_float(raw.get("debtToEquity")),
        "current_ratio": _safe_float(raw.get("currentRatio")),
        "free_cash_flow": _safe_float(raw.get("freeCashflow")),
        "beta": _safe_float(raw.get("beta")),
        "avg_volume": _safe_float(raw.get("averageVolume")),
        "shares_outstanding": _safe_float(raw.get("sharesOutstanding")),
        "held_by_insiders": _safe_float(raw.get("heldPercentInsiders")),
        "held_by_institutions": _safe_float(raw.get("heldPercentInstitutions")),
        "short_ratio": _safe_float(raw.get("shortRatio")),
        "ex_dividend_date": str(raw.get("exDividendDate") or ""),
        "earnings_date": str(raw.get("earningsTimestamp") or ""),
        "analyst_target": _safe_float(raw.get("targetMeanPrice")),
        "analyst_recommendation": str(raw.get("recommendationKey") or ""),
        # ── Extended fields (full fundamentals) ──
        "ebitda": _safe_float(raw.get("ebitda")),
        "ebitda_margin": _safe_float(raw.get("ebitdaMargins")),
        "gross_profit": _safe_float(raw.get("grossProfits")),
        "gross_margin": _safe_float(raw.get("grossMargins")),
        "total_debt": _safe_float(raw.get("totalDebt")),
        "total_cash": _safe_float(raw.get("totalCash")),
        "enterprise_value": _safe_float(raw.get("enterpriseValue")),
        "ev_to_ebitda": _safe_float(raw.get("enterpriseToEbitda")),
        "payout_ratio": _safe_float(raw.get("payoutRatio")),
        "earnings_growth": _safe_float(raw.get("earningsGrowth")),
        "revenue_per_share": _safe_float(raw.get("revenuePerShare")),
        "operating_cash_flow": _safe_float(raw.get("operatingCashflow")),
        "target_low": _safe_float(raw.get("targetLowPrice")),
        "target_high": _safe_float(raw.get("targetHighPrice")),
        "recommendation_mean": _safe_float(raw.get("recommendationMean")),
        "quick_ratio": _safe_float(raw.get("quickRatio")),
    }

    # ── ROIC (proxy) — primary return metric, robust to missing ROE/ROA ──
    # net_income = profitMargins × totalRevenue (both ~99% present, no tax assumption)
    # equity     = bookValue × sharesOutstanding
    # ROIC       = net_income / (equity + totalDebt − totalCash)
    roic = None
    try:
        pm = result["profit_margin"]
        rev = result["revenue"]
        bv = result["book_value"]
        so = result["shares_outstanding"]
        td = result["total_debt"]
        tc = result["total_cash"]
        if all(x is not None and x > 0 for x in (pm, rev, bv, so)) and so > 0:
            net_income = pm * rev
            equity = bv * so
            invested_capital = equity + td - tc
            if invested_capital > 0:
                roic = net_income / invested_capital
    except Exception:
        roic = None
    result["roic"] = roic

    # ── Analyst target upside % ──
    upside = None
    if result["analyst_target"] > 0 and result["current_price"] > 0:
        upside = (result["analyst_target"] - result["current_price"]) / result["current_price"]
    result["analyst_upside"] = upside

    # ── Finance-company detection (sector exclusions) ──
    result["is_financial"] = _is_financial(result["sector"], result["industry"])

    # ── Per-metric Good/Neutral/Bad scorecard + aggregate ──
    scorecard = _compute_scorecard(result)
    result["scorecard"] = scorecard["metrics"]
    result["overall"] = scorecard["overall"]

    # 0-100 fundamental health score — exact copy of backend scoring
    score = 50.0  # base
    pe = result["pe_forward"] or result["pe_trailing"]
    if pe > 0:
        if pe < 15: score += 10
        elif pe < 25: score += 5
        elif pe > 40: score -= 5
    if result["roe"] > 0.15: score += 10
    elif result["roe"] > 0.10: score += 5
    if result["profit_margin"] > 0.15: score += 10
    elif result["profit_margin"] > 0.08: score += 5
    if result["debt_to_equity"] > 0 and result["debt_to_equity"] < 100: score += 5
    elif result["debt_to_equity"] > 200: score -= 5
    if result["revenue_growth"] > 0.10: score += 5
    elif result["revenue_growth"] < -0.05: score -= 5
    if result["dividend_yield"] > 0.01: score += 5
    if result["current_ratio"] > 1.5: score += 5
    elif result["current_ratio"] < 0.8 and result["current_ratio"] > 0: score -= 5
    if result["peg_ratio"] > 0 and result["peg_ratio"] < 1.5: score += 5
    elif result["peg_ratio"] > 3: score -= 5
    if result["analyst_target"] > 0 and result["current_price"] > 0:
        upside2 = (result["analyst_target"] - result["current_price"]) / result["current_price"]
        if upside2 > 0.15: score += 5
        elif upside2 < -0.10: score -= 5

    result["fundamental_score"] = max(0, min(100, round(score)))
    return result


def _is_financial(sector: str, industry: str) -> bool:
    """Detect finance companies (banks/NBFCs/insurance/AMC/etc.) for sector exclusions."""
    if sector and sector.strip().lower() == "financial services":
        return True
    if industry:
        il = industry.lower()
        finance_keywords = [
            "bank", "nbfc", "non-bank", "insurance", "capital market",
            "asset management", "mutual fund", "credit service", "credit company",
            "mortgage", "housing finance", "financial", "finance", "broker",
            "depository", "stock exchange", "investment banking", "consumer finance",
            "specialty finance", "financial conglomerate", "financial exchange",
        ]
        if any(kw in il for kw in finance_keywords):
            return True
    return False


def _verdict(value, good, neutral, bad, direction="higher", missing=None):
    """Return Good/Neutral/Bad for a metric value given threshold callables.

    good/neutral/bad are callables(value)->bool evaluated in order.
    missing: optional callable(value)->bool; if True returns "N/A (data)".
    """
    if value is None:
        return "N/A (data)"
    if missing and missing(value):
        return "N/A (data)"
    if good(value):
        return "Good"
    if neutral(value):
        return "Neutral"
    return "Bad"


def _compute_scorecard(r: Dict[str, Any]) -> Dict[str, Any]:
    """Compute per-metric Good/Neutral/Bad verdicts + aggregate % GOOD.

    Thresholds validated by the fundamental analyst against real data.
    N/A (data) and N/A (sector) are excluded from the aggregate denominator.
    """
    is_fin = r.get("is_financial", False)
    fin = "N/A (sector)" if is_fin else None  # sentinel for sector-excluded metrics

    def na_if_zero(v):
        return v is None or v == 0

    metrics = {}

    # ── Returns ──
    if is_fin:
        metrics["roic"] = {"value": r.get("roic"), "verdict": "N/A (sector)", "label": "ROIC"}
    else:
        roic = r.get("roic")
        metrics["roic"] = {
            "value": roic,
            "verdict": _verdict(roic, lambda v: v >= 0.12, lambda v: v >= 0.06, lambda v: True),
            "label": "ROIC",
        }

    # ── Profitability margins (N/A for financials) ──
    margin_defs = [
        ("ebitda_margin", "EBITDA Margin", 0.20, 0.10),
        ("gross_margin", "Gross Margin", 0.40, 0.20),
        ("operating_margin", "Operating Margin", 0.15, 0.07),
        ("profit_margin", "Net Profit Margin", 0.12, 0.05),
    ]
    for key, label, g, n in margin_defs:
        v = r.get(key)
        if is_fin:
            metrics[key] = {"value": v, "verdict": "N/A (sector)", "label": label}
        else:
            metrics[key] = {
                "value": v,
                "verdict": _verdict(v, lambda v, g=g: v >= g, lambda v, n=n: v >= n, lambda v: True),
                "label": label,
            }

    # ── Growth ──
    metrics["revenue_growth"] = {
        "value": r.get("revenue_growth"),
        "verdict": _verdict(r.get("revenue_growth"), lambda v: v >= 0.15, lambda v: v >= 0.05, lambda v: True),
        "label": "Revenue Growth",
    }
    metrics["earnings_growth"] = {
        "value": r.get("earnings_growth"),
        "verdict": _verdict(r.get("earnings_growth"), lambda v: v >= 0.15, lambda v: v >= 0.05, lambda v: True),
        "label": "Earnings Growth",
    }

    # ── Leverage (N/A for financials) ──
    de = r.get("debt_to_equity")
    if is_fin:
        metrics["debt_to_equity"] = {"value": de, "verdict": "N/A (sector)", "label": "Debt/Equity"}
    else:
        # yfinance debtToEquity is already a ratio (e.g. 58.7 = 0.587). Normalize.
        de_norm = de / 100.0 if de and de > 1 else de
        metrics["debt_to_equity"] = {
            "value": de,
            "verdict": _verdict(
                de_norm,
                lambda v: v < 0.5,
                lambda v: v <= 1.5,
                lambda v: True,
                missing=lambda v: v is None,
            ),
            "label": "Debt/Equity",
        }

    # ── Valuation ──
    pe = r.get("pe_trailing")
    metrics["pe_trailing"] = {
        "value": pe,
        "verdict": _verdict(pe, lambda v: 0 < v < 15, lambda v: 15 <= v <= 30, lambda v: True, missing=lambda v: v is None or v <= 0),
        "label": "P/E (Trailing)",
    }
    pb = r.get("pb_ratio")
    metrics["pb_ratio"] = {
        "value": pb,
        "verdict": _verdict(pb, lambda v: 0 < v < 1.5, lambda v: 1.5 <= v <= 4, lambda v: True, missing=lambda v: v is None or v <= 0),
        "label": "P/B",
    }
    ps = r.get("ps_ratio")
    metrics["ps_ratio"] = {
        "value": ps,
        "verdict": _verdict(ps, lambda v: 0 < v < 2, lambda v: 2 <= v <= 5, lambda v: True, missing=lambda v: v is None or v <= 0),
        "label": "P/S",
    }
    ev = r.get("ev_to_ebitda")
    if is_fin:
        metrics["ev_to_ebitda"] = {"value": ev, "verdict": "N/A (sector)", "label": "EV/EBITDA"}
    else:
        metrics["ev_to_ebitda"] = {
            "value": ev,
            "verdict": _verdict(ev, lambda v: 0 < v < 8, lambda v: 8 <= v <= 15, lambda v: True, missing=lambda v: v is None or v <= 0),
            "label": "EV/EBITDA",
        }

    # ── Dividend ──
    # NOTE: yfinance dividendYield for Indian stocks is already in percentage
    # points (e.g. 2.06 = 2.06%), NOT a decimal. Thresholds use the 0-100 scale.
    dy = r.get("dividend_yield")
    metrics["dividend_yield"] = {
        "value": dy,
        "verdict": _verdict(dy, lambda v: v >= 3.0, lambda v: v >= 1.0, lambda v: True, missing=lambda v: v is None),
        "label": "Dividend Yield",
    }

    # ── Risk ──
    beta = r.get("beta")
    metrics["beta"] = {
        "value": beta,
        "verdict": _verdict(beta, lambda v: v < 0.8, lambda v: v <= 1.2, lambda v: True, missing=lambda v: v is None or v == 0),
        "label": "Beta",
    }

    # ── Analyst ──
    up = r.get("analyst_upside")
    metrics["analyst_upside"] = {
        "value": up,
        "verdict": _verdict(up, lambda v: v >= 0.20, lambda v: v >= 0.0, lambda v: True, missing=lambda v: v is None),
        "label": "Analyst Upside",
    }

    # ── Ownership ──
    ins = r.get("held_by_insiders")
    metrics["held_by_insiders"] = {
        "value": ins,
        "verdict": _verdict(ins, lambda v: v >= 0.30, lambda v: v >= 0.10, lambda v: True, missing=lambda v: v is None),
        "label": "Insider Holding",
    }
    inst = r.get("held_by_institutions")
    metrics["held_by_institutions"] = {
        "value": inst,
        "verdict": _verdict(inst, lambda v: v >= 0.40, lambda v: v >= 0.15, lambda v: True, missing=lambda v: v is None),
        "label": "Institutional Holding",
    }

    # ── Bonus metrics (display only, NOT scored) ──
    bonus = {}
    for key, label, g, n in [
        ("roe", "ROE", 0.15, 0.08),
        ("roa", "ROA", 0.08, 0.04),
    ]:
        v = r.get(key)
        bonus[key] = {
            "value": v,
            "verdict": _verdict(v, lambda v, g=g: v >= g, lambda v, n=n: v >= n, lambda v: True, missing=lambda v: v is None or v == 0),
            "label": label,
            "bonus": True,
        }
    fcf = r.get("free_cash_flow")
    bonus["free_cash_flow"] = {
        "value": fcf,
        "verdict": _verdict(fcf, lambda v: v > 0, lambda v: True, lambda v: True, missing=lambda v: v is None or v == 0),
        "label": "Free Cash Flow",
        "bonus": True,
    }
    metrics.update(bonus)

    # ── Aggregate ──
    good = sum(1 for m in metrics.values() if m["verdict"] == "Good" and not m.get("bonus"))
    neutral = sum(1 for m in metrics.values() if m["verdict"] == "Neutral" and not m.get("bonus"))
    bad = sum(1 for m in metrics.values() if m["verdict"] == "Bad" and not m.get("bonus"))
    na_data = sum(1 for m in metrics.values() if m["verdict"] == "N/A (data)" and not m.get("bonus"))
    na_sector = sum(1 for m in metrics.values() if m["verdict"] == "N/A (sector)" and not m.get("bonus"))
    total_scored = good + neutral + bad

    signal_ratio = good / (good + bad) if (good + bad) > 0 else 0.5
    quality_breadth = good / total_scored if total_scored > 0 else 0.0
    overall_score = round((0.7 * signal_ratio + 0.3 * quality_breadth) * 100)

    if total_scored < 8:
        confidence = "LOW"
    elif total_scored < 14:
        confidence = "MEDIUM"
    else:
        confidence = "HIGH"

    if overall_score >= 75:
        band = "Strong Buy"
    elif overall_score >= 60:
        band = "Buy"
    elif overall_score >= 40:
        band = "Hold"
    elif overall_score >= 25:
        band = "Avoid"
    else:
        band = "Strong Avoid"

    overall = {
        "score": overall_score,
        "good": good,
        "neutral": neutral,
        "bad": bad,
        "na_data": na_data,
        "na_sector": na_sector,
        "total_scored": total_scored,
        "signal_ratio": round(signal_ratio, 3),
        "quality_breadth": round(quality_breadth, 3),
        "good_pct": round(100 * good / total_scored) if total_scored > 0 else 0,
        "neutral_pct": round(100 * neutral / total_scored) if total_scored > 0 else 0,
        "bad_pct": round(100 * bad / total_scored) if total_scored > 0 else 0,
        "confidence": confidence,
        "band": band,
    }

    return {"metrics": metrics, "overall": overall}


def build_fundamentals_rows(reports_dir: str = DEFAULT_REPORTS_DIR) -> List[Dict[str, Any]]:
    """Normalize the raw-yfinance fundamentals snapshots in ../reports/*_data.json."""
    files = sorted(glob.glob(os.path.join(reports_dir, "*_data.json")))
    rows: List[Dict[str, Any]] = []
    for path in files:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as exc:
            log.warning("Fundamentals: skip %s (%s)", os.path.basename(path), exc)
            continue
        raw = doc.get("fundamentals")
        if not isinstance(raw, dict) or not raw:
            continue
        ticker = str(doc.get("ticker") or os.path.basename(path)
                     .replace("_data.json", "").replace("_", "."))
        fund = _normalize_fundamentals(ticker, raw)
        # Keep `data` as a real JSON object (see OHLCV note — no json.dumps).
        rows.append({
            "ticker": fund["ticker"],
            "data": fund,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    log.info("Fundamentals: built %d rows from %d JSON report(s)", len(rows), len(files))
    return rows


# ── Main ──

def main() -> int:
    parser = argparse.ArgumentParser(description="Push local analysis snapshot to Supabase")
    parser.add_argument("--dry-run", action="store_true",
                        help="build rows and print summary without pushing")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="path to analysis_history.db")
    parser.add_argument("--log", default=None, help="log file path (also logs to stdout)")
    parser.add_argument("--ohlcv-limit", type=int, default=0,
                        help="OHLCV backfill: only the top N tickers by qm_score (0 = all)")
    parser.add_argument("--ohlcv-only", action="store_true",
                        help="backfill ohlcv + fundamentals only; skip the snapshot sync")
    parser.add_argument("--skip-ohlcv", action="store_true",
                        help="skip the OHLCV backfill")
    parser.add_argument("--intraday-limit", type=int, default=0,
                        help="intraday backfill: only the top N tickers by qm_score (0 = all)")
    parser.add_argument("--intraday-only", action="store_true",
                        help="backfill ohlcv_intraday only; skip snapshot + daily ohlcv + fundamentals")
    parser.add_argument("--intraday-intervals", default=",".join(INTRADAY_INTERVALS),
                        help="comma-separated intervals for the intraday backfill")
    parser.add_argument("--skip-intraday", action="store_true",
                        help="skip the intraday backfill")
    parser.add_argument("--skip-fundamentals", action="store_true",
                        help="skip the fundamentals backfill")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[logging.StreamHandler()]
        + ([logging.FileHandler(args.log)] if args.log else []),
    )

    cfg = get_config()
    log.info("Option B sync starting — DB: %s", args.db)
    log.info("Flags → dry_run=%s ohlcv_only=%s ohlcv_limit=%s skip_ohlcv=%s "
             "intraday_only=%s intraday_limit=%s intraday_intervals=%s skip_intraday=%s "
             "skip_fundamentals=%s",
             args.dry_run, args.ohlcv_only, args.ohlcv_limit, args.skip_ohlcv,
             args.intraday_only, args.intraday_limit, args.intraday_intervals, args.skip_intraday,
             args.skip_fundamentals)

    # ── 0. Snapshot sync (skipped with --ohlcv-only or --intraday-only) ──
    snapshot_ok = 0
    if not (args.ohlcv_only or args.intraday_only):
        rows, meta = build_rows(args.db)
        if not rows:
            log.error("Nothing to sync — run your analysis engine first (e.g. npm run dev:backend)")
            return 1

        log.info("Built %d dashboard rows | dry-run=%s", len(rows), args.dry_run)
        buys = sum(1 for r in rows if r["qm_rating"] in ("Strong Buy", "Buy"))
        holds = sum(1 for r in rows if r["qm_rating"] == "Hold")
        sells = sum(1 for r in rows if r["qm_rating"] in ("Sell", "Strong Sell"))
        log.info("Summary → buy: %d, hold: %d, sell: %d, total: %d", buys, holds, sells, len(rows))

        if not args.dry_run:
            ok, failed = _upsert_rows(cfg, "portfolio_snapshot", rows, "ticker")
            log.info("Snapshot upsert: %d rows OK, %d failed batches", ok, failed)
            keep = [r["ticker"] for r in rows]
            _delete_stale(cfg, "portfolio_snapshot", keep)
            _update_meta(cfg, meta)
            snapshot_ok = ok
    else:
        log.info("--ohlcv-only/--intraday-only: skipping snapshot sync")

    # ── 1. OHLCV backfill (5y candles, one row per ticker) ──
    ohlcv_ok = 0
    if not args.skip_ohlcv and not args.intraday_only:
        ohlcv_rows = build_ohlcv_rows(args.db, args.ohlcv_limit)
        if ohlcv_rows:
            if not args.dry_run:
                ok, failed = _upsert_rows(cfg, "ohlcv", ohlcv_rows, "ticker", batch_size=OHLCV_BATCH_SIZE)
                log.info("OHLCV upsert: %d rows OK, %d failed batches", ok, failed)
                _delete_stale(cfg, "ohlcv", [r["ticker"] for r in ohlcv_rows])
                ohlcv_ok = ok
            else:
                log.info("OHLCV dry-run: %d rows ready (sample: %s)",
                         len(ohlcv_rows), json.dumps(ohlcv_rows[0], default=str)[:300])
        else:
            log.warning("No OHLCV rows built — is pandas+yfinance installed?")

    # ── 1b. Intraday backfill (ohlcv_intraday, one row per ticker+interval) ──
    intraday_ok = 0
    if not args.skip_intraday:
        intervals = [s.strip() for s in args.intraday_intervals.split(",") if s.strip()]
        intraday_rows = build_intraday_rows(args.db, args.intraday_limit, intervals)
        if intraday_rows:
            if not args.dry_run:
                # Composite PK (ticker, interval) — PostgREST on_conflict accepts
                # comma-separated columns. Stale deletion is intentionally skipped
                # here (the daily ohlcv helper keys on ticker only; intraday rows
                # for removed tickers are harmless and overwritten on next sync).
                ok, failed = _upsert_rows(cfg, "ohlcv_intraday", intraday_rows,
                                          "ticker,interval", batch_size=INTRADAY_BATCH_SIZE)
                log.info("Intraday upsert: %d rows OK, %d failed batches", ok, failed)
                intraday_ok = ok
            else:
                log.info("Intraday dry-run: %d rows ready (sample: %s)",
                         len(intraday_rows), json.dumps(intraday_rows[0], default=str)[:300])
        else:
            log.warning("No intraday rows built — is pandas+yfinance installed?")

    # ── 2. Fundamentals backfill (from stored *_data.json reports) ──
    fund_ok = 0
    if not args.skip_fundamentals and not args.intraday_only:
        fund_rows = build_fundamentals_rows()
        if fund_rows:
            if not args.dry_run:
                ok, failed = _upsert_rows(cfg, "fundamentals", fund_rows, "ticker", batch_size=FUND_BATCH_SIZE)
                log.info("Fundamentals upsert: %d rows OK, %d failed batches", ok, failed)
                _delete_stale(cfg, "fundamentals", [r["ticker"] for r in fund_rows])
                fund_ok = ok
            else:
                log.info("Fundamentals dry-run: %d rows ready (sample: %s)",
                         len(fund_rows), json.dumps(fund_rows[0], default=str)[:300])
        else:
            log.warning("No fundamentals rows built — expected %d JSON report(s) in %s",
                        len(glob.glob(os.path.join(DEFAULT_REPORTS_DIR, "*_data.json"))),
                        DEFAULT_REPORTS_DIR)

    if args.dry_run:
        log.info("Dry-run complete — no data pushed.")
        return 0

    log.info("Sync complete ✔  (snapshot=%d, ohlcv=%d, intraday=%d, fundamentals=%d)",
             snapshot_ok, ohlcv_ok, intraday_ok, fund_ok)
    return 0


if __name__ == "__main__":
    sys.exit(main())
