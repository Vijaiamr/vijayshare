#!/usr/bin/env python3
"""
run_latest_analysis.py — re-run the full NSE quantamental analysis with the
latest market data and persist results to the local SQLite database
(reports/analysis_history.db).

Mirrors the production scan (_run_nse_scan in backend/api/main.py):
  - batches of 20 tickers, 4 parallel workers
  - 0.3s rate-limit delay between batches
  - per-ticker timeout (TICKER_TIMEOUT_SECONDS, default 120s)
  - save_db=True  → one row per (ticker, run_timestamp) in analysis_runs
  - charts + report text generated per ticker (same as run_ticker)

Resumable: tickers whose latest run_timestamp is today are skipped, so an
interrupted run can be restarted with the same command.

Usage
-----
    python3 run_latest_analysis.py                  # full refresh (~1.5-3h)
    python3 run_latest_analysis.py --limit 50      # quick partial run
    python3 run_latest_analysis.py --workers 8     # more parallelism
    python3 run_latest_analysis.py --force         # re-run even if done today

After completion, push to Supabase:
    python3 sync/sync_to_supabase.py
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# ── Paths ──
SHARE_DIR = os.path.dirname(os.path.abspath(__file__))
VIJAYMARUTHI_DIR = os.path.join(SHARE_DIR, "vijaymaruthi")
BACKEND_DIR = os.path.join(VIJAYMARUTHI_DIR, "backend")
for p in (SHARE_DIR, VIJAYMARUTHI_DIR, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

DEFAULT_DB_PATH = os.path.join(SHARE_DIR, "reports", "analysis_history.db")
DEFAULT_LOG_PATH = os.path.join(SHARE_DIR, "logs", "latest_analysis.log")

BATCH_SIZE = 20
BATCH_DELAY_S = 0.3
TICKER_TIMEOUT_S = int(os.environ.get("TICKER_TIMEOUT_SECONDS", "120"))

log = logging.getLogger("latest_analysis")


def setup_logging(log_path: str) -> None:
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = logging.FileHandler(log_path, mode="a")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(fh)
    root.addHandler(sh)


def load_tickers(db_path: str, skip_today: bool) -> tuple[list[str], int]:
    """Latest analysed tickers per the DB — exactly what the dashboard tracks.

    Returns (tickers_to_run, skipped) where tickers whose latest run is from
    today are skipped when `skip_today` is True (resumable runs).
    """
    from analysis_db import AnalysisDatabase
    adb = AnalysisDatabase(db_path)
    latest = adb.get_all_latest()
    today = datetime.now().strftime("%Y-%m-%d")
    tickers: list[str] = []
    skipped = 0
    for r in latest:
        if skip_today and str(r.get("run_timestamp", "")).startswith(today):
            skipped += 1
            continue
        tickers.append(r["ticker"])
    log.info("Loaded %d tickers from %s (%d skipped — done today)",
             len(tickers), db_path, skipped)
    return tickers, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-run latest NSE quantamental analysis")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="SQLite DB path")
    parser.add_argument("--log", default=DEFAULT_LOG_PATH, help="log file path")
    parser.add_argument("--limit", type=int, default=0, help="analyse at most N tickers (0 = all)")
    parser.add_argument("--workers", type=int, default=4, help="parallel workers (default 4)")
    parser.add_argument("--force", action="store_true", help="re-run even if analysed today")
    args = parser.parse_args()

    setup_logging(args.log)
    log.info("=== LATEST ANALYSIS START %s ===", datetime.now().isoformat(timespec="seconds"))

    from engine.runner import AnalysisRunner
    runner = AnalysisRunner()

    # Resumability: skip tickers already analysed today unless --force
    tickers, skipped = load_tickers(args.db, skip_today=not args.force)
    if args.limit > 0:
        tickers = tickers[: args.limit]
    if skipped:
        log.info("Skipping %d tickers already analysed today (use --force to override)", skipped)

    total = len(tickers)
    if total == 0:
        log.info("Nothing to do — all tickers already analysed today.")
        return
    log.info("Analysing %d tickers (workers=%d, batch=%d, timeout=%ds)",
             total, args.workers, BATCH_SIZE, TICKER_TIMEOUT_S)

    completed = 0
    failed = 0
    errors: list[str] = []
    last_log_pct = -1
    t0 = time.time()

    for i in range(0, total, BATCH_SIZE):
        batch = tickers[i : i + BATCH_SIZE]
        try:
            results = runner.run_batch(batch, period="1y", sentiment=False,
                                       save_db=True, max_workers=args.workers)
        except Exception as e:  # noqa: BLE001 — batch-level fallback
            log.warning("Batch %d failed wholesale: %s", i // BATCH_SIZE, e)
            results = [{"ticker": t, "error": f"batch: {e}"} for t in batch]

        for r in results:
            if "error" in r:
                failed += 1
                errors.append(f"{r.get('ticker')}: {r['error']}")
            else:
                completed += 1

        if i + BATCH_SIZE < total:
            time.sleep(BATCH_DELAY_S)

        pct = int(100 * completed / total)
        if pct > last_log_pct and pct % 5 == 0:
            last_log_pct = pct
            elapsed = time.time() - t0
            rate = completed / max(elapsed, 1)
            eta = (total - completed) / rate / 60 if rate else float("nan")
            log.info("PROGRESS %d/%d (%d%%) — %d failed — %.1f/s — ETA %.0f min",
                     completed, total, pct, failed, rate, eta)

    dt = time.time() - t0
    log.info("=== LATEST ANALYSIS DONE %s ===", datetime.now().isoformat(timespec="seconds"))
    log.info("Completed %d ok / %d failed / %d total in %.1f min",
             completed, failed, total, dt / 60)
    if errors:
        log.info("Last errors:\n%s", "\n".join(errors[-15:]))


if __name__ == "__main__":
    main()
