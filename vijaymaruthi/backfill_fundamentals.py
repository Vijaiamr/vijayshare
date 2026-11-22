"""
Backfill full fundamentals for ALL analyzed tickers.

Fetches yfinance `info` for every ticker in the analysis DB that lacks a
*_data.json report, saves the report (same shape the sync script expects),
then pushes to Supabase.

Usage:
    python backfill_fundamentals.py            # fetch missing + sync
    python backfill_fundamentals.py --fetch-only
    python backfill_fundamentals.py --sync-only
    python backfill_fundamentals.py --limit 50 # only first 50 missing (test)
"""
import argparse
import glob
import json
import logging
import os
import sys
import time

log = logging.getLogger("backfill_fundamentals")

SHARE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(SHARE_DIR, "reports")
DB_PATH = os.path.join(REPORTS_DIR, "analysis_history.db")

# Add share root + sync dir to path so we can reuse analysis_db + the sync main
SHARE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SHARE_ROOT not in sys.path:
    sys.path.insert(0, SHARE_ROOT)
SYNC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync")
if SYNC_DIR not in sys.path:
    sys.path.insert(0, SYNC_DIR)


def get_analyzed_tickers(db_path: str) -> list[str]:
    """Return distinct tickers from the analysis DB."""
    from analysis_db import AnalysisDatabase
    adb = AnalysisDatabase(db_path)
    latest = adb.get_all_latest()
    return [r["ticker"] for r in latest]


def get_existing_reports(reports_dir: str) -> set[str]:
    """Return set of tickers (normalized, e.g. GIPCL.NS) that already have reports."""
    out = set()
    for p in glob.glob(os.path.join(reports_dir, "*_data.json")):
        base = os.path.basename(p).replace("_data.json", "")
        out.add(base.replace("_", "."))
    return out


def fetch_and_save(ticker: str, reports_dir: str) -> bool:
    """Fetch yfinance info for a ticker and save a *_data.json report. Returns True on success."""
    import yfinance as yf
    safe = ticker.replace(".", "_")
    path = os.path.join(reports_dir, f"{safe}_data.json")
    try:
        t = yf.Ticker(ticker)
        info = t.info
        if not info or not isinstance(info, dict) or len(info) < 5:
            log.warning("  %s: empty info, skipping", ticker)
            return False
        report = {
            "ticker": ticker,
            "signal": None,
            "confidence": None,
            "price": info.get("currentPrice") or info.get("regularMarketPrice"),
            "market_structure": {},
            "rsi": {},
            "macd": {},
            "adx": None,
            "atr": None,
            "bollinger": {},
            "volume": {},
            "wyckoff_phase": {},
            "gann_cycles": {},
            "fundamentals": info,
            "quantamental": {},
            "sentiment": {},
        }

        def clean(obj):
            if isinstance(obj, dict):
                return {k: clean(v) for k, v in obj.items()}
            elif isinstance(obj, float) and obj != obj:  # NaN
                return None
            return obj

        with open(path, "w") as f:
            json.dump(clean(report), f, indent=2, default=str)
        return True
    except Exception as e:
        log.warning("  %s: error %s", ticker, e)
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch-only", action="store_true")
    parser.add_argument("--sync-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="only first N missing (test)")
    parser.add_argument("--delay", type=float, default=0.6, help="seconds between fetches (rate-limit)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

    if not args.sync_only:
        analyzed = get_analyzed_tickers(DB_PATH)
        existing = get_existing_reports(REPORTS_DIR)
        missing = [t for t in analyzed if t not in existing]
        log.info("Analyzed: %d | with reports: %d | missing: %d", len(analyzed), len(existing), len(missing))
        if args.limit:
            missing = missing[: args.limit]
            log.info("Limiting to first %d missing", len(missing))

        ok = 0
        for i, ticker in enumerate(missing, 1):
            if fetch_and_save(ticker, REPORTS_DIR):
                ok += 1
            if i % 25 == 0:
                log.info("  progress %d/%d (ok=%d)", i, len(missing), ok)
            time.sleep(args.delay)
        log.info("Fetch done: %d/%d saved", ok, len(missing))

        if args.fetch_only:
            return 0

    # Sync to Supabase (fundamentals only)
    log.info("Syncing fundamentals to Supabase...")
    rc = os.system(
        f"python3 {os.path.join(SYNC_DIR, 'sync_to_supabase.py')} --ohlcv-only --skip-ohlcv"
    )
    return rc


if __name__ == "__main__":
    sys.exit(main())
