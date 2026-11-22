#!/usr/bin/env python3
"""
sync_cloud_prices.py — run the VijayMaruthi price sync ENTIRELY in the cloud.

The Mac cron job pushes local analysis data → Supabase. This script does the
cloud-equivalent of the OHLCV part WITHOUT any local files: it reads the
ticker list from Supabase, downloads fresh 5y candles from Yahoo Finance, and
upserts them back into Supabase. Designed to run on GitHub Actions once daily
(see .github/workflows/cloud-sync.yml) — zero cost.

Usage (env vars required):
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 sync_cloud_prices.py

Options:
    --limit N          only refresh the first N tickers from the cloud table
                       (default 0 = all; keep runs short for free CI minutes)
    --workers N        parallel download workers (default 4)
    --dry-run          fetch + build rows but do NOT write to Supabase
    --only A,BB,C      refresh only these tickers (comma-separated)

Output: one-line summary per run, e.g.
    OK  tickers=2386  fresh=2386  rows=2386  failed=0  duration=812s
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests  # noqa: F401 — validated below
import yfinance as yf
import pandas as pd

OHLCV_PERIOD = "5y"
OHLCV_MAX_CANDLES = 500
OHLCV_BATCH_SIZE = 25
OHLCV_YF_SLEEP = 0.15  # seconds between downloads (be nice to Yahoo)
TICKER_PAGE = 1000

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
log = logging.getLogger(__name__)


# ── Config ────────────────────────────────────────────────────────────────

def get_config() -> Dict[str, str]:
    cfg = {
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", "").rstrip("/"),
        "SUPABASE_SERVICE_ROLE_KEY": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    }
    missing = [k for k, v in cfg.items() if not v]
    if missing:
        log.error("Missing env var(s): %s", ", ".join(missing))
        sys.exit(2)
    return cfg


def _headers(cfg: Dict[str, str]) -> Dict[str, str]:
    return {
        "apikey": cfg["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {cfg['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
    }


# ── Supabase helpers ───────────────────────────────────────────────────────

def fetch_cloud_tickers(cfg: Dict[str, str], table: str, limit: int = 0) -> List[str]:
    """Read every ticker from a cloud table (paginated)."""
    base = f"{cfg['SUPABASE_URL']}/rest/v1/{table}"
    tickers: List[str] = []
    start = 0
    while True:
        r = requests.get(
            base,
            params={"select": "ticker", "order": "ticker"},
            headers={**_headers(cfg), "Range-Unit": "items", "Range": f"{start}-{start + TICKER_PAGE - 1}"},
            timeout=30,
        )
        if r.status_code not in (200, 206):
            log.error("Fetch tickers failed (HTTP %s): %s", r.status_code, r.text[:300])
            break
        page = r.json()
        tickers += [row["ticker"] for row in page]
        if len(page) < TICKER_PAGE:
            break
        start += TICKER_PAGE
        if limit and len(tickers) >= limit:
            break
    if limit:
        tickers = tickers[:limit]
    return tickers


def upsert_rows(cfg: Dict[str, str], table: str, rows: List[Dict[str, Any]],
                key: str = "ticker", batch_size: int = OHLCV_BATCH_SIZE) -> int:
    """Upsert rows (on conflict key) in small batches; returns rows written."""
    base = f"{cfg['SUPABASE_URL']}/rest/v1/{table}"
    ok = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        r = requests.post(
            base,
            params={"on_conflict": key},
            headers={**_headers(cfg), "Prefer": "resolution=merge-duplicates,return=minimal"},
            data=json.dumps(chunk),
            timeout=60,
        )
        if r.status_code in (200, 201, 204):
            ok += len(chunk)
        else:
            log.error("Upsert %s failed (HTTP %s): %s", table, r.status_code, r.text[:300])
    return ok


def update_meta(cfg: Dict[str, str], values: Dict[str, str]) -> None:
    """Upsert a small key/value map into sync_meta."""
    base = f"{cfg['SUPABASE_URL']}/rest/v1/sync_meta"
    rows = [{"key": k, "value": v, "updated_at": datetime.now(timezone.utc).isoformat()}
            for k, v in values.items()]
    try:
        upsert_rows(cfg, "sync_meta", rows, key="key", batch_size=50)
    except Exception as exc:  # meta is best-effort
        log.warning("Meta update failed: %s", exc)


# ── Candle fetching ────────────────────────────────────────────────────────

def build_candle_row(ticker: str) -> Optional[Dict[str, Any]]:
    """Download 5y candles for one ticker → cloud-ready ohlcv row."""
    try:
        df = yf.download(ticker, period=OHLCV_PERIOD, progress=False, auto_adjust=True)
        if df is None or df.empty:
            log.warning("no data for %s", ticker)
            return None
        if isinstance(df.columns, pd.MultiIndex):
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
            log.warning("no clean candles for %s", ticker)
            return None
        return {
            "ticker": ticker,
            "candles": candles,  # real JSON array (not a string) → jsonb array
            "period": OHLCV_PERIOD,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:  # one bad ticker must never abort the run
        log.warning("%s failed: %s", ticker, exc)
        return None


def build_rows(tickers: List[str], workers: int = 4) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if len(tickers) == 1:
        row = build_candle_row(tickers[0])
        if row:
            rows.append(row)
        return rows

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(build_candle_row, t): t for t in tickers}
        for fut in as_completed(futures):
            done += 1
            try:
                row = fut.result()
                if row:
                    rows.append(row)
            except Exception as exc:  # defensive
                log.warning("worker error: %s", exc)
            if done % 50 == 0:
                log.info("processed %d/%d tickers, %d rows built", done, len(tickers), len(rows))
            time.sleep(OHLCV_YF_SLEEP)
    return rows


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Cloud OHLCV sync → Supabase")
    parser.add_argument("--limit", type=int, default=0, help="refresh at most N tickers (0 = all)")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only", default="", help="comma-separated tickers to refresh")
    args = parser.parse_args()

    cfg = get_config()
    started = time.time()

    if args.only:
        tickers = [t.strip().upper() for t in args.only.split(",") if t.strip()]
    else:
        tickers = fetch_cloud_tickers(cfg, "portfolio_snapshot", limit=args.limit)
    if not tickers:
        log.error("No tickers found in portfolio_snapshot")
        return 1

    log.info("Refreshing %d ticker(s) (limit=%s, workers=%d)%s",
             len(tickers), args.limit or "all", args.workers,
             " [DRY RUN — no writes]" if args.dry_run else "")

    rows = build_rows(tickers, workers=args.workers)
    log.info("Built %d ohlcv rows from %d tickers", len(rows), len(tickers))

    failed = len(tickers) - len(rows)
    if not args.dry_run and rows:
        ok = upsert_rows(cfg, "ohlcv", rows, key="ticker")
        log.info("Upserted %d/%d ohlcv rows", ok, len(rows))
        update_meta(cfg, {
            "cloud_sync_last_run": datetime.now(timezone.utc).isoformat(),
            "cloud_sync_tickers": str(len(tickers)),
            "cloud_sync_rows": str(ok),
            "cloud_sync_failed": str(failed),
        })
    elif args.dry_run:
        log.info("DRY RUN — first row: %s", json.dumps(rows[0], default=str)[:200] if rows else "none")

    duration = int(time.time() - started)
    log.info("OK tickers=%d fresh=%d rows=%d failed=%d duration=%ds",
             len(tickers), len(rows), len(rows), failed, duration)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
