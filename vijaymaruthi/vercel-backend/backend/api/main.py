"""
VijayMaruthi Wealth API — FastAPI backend.

Serves analysis results from the Python engine via REST endpoints.
Supports file-based caching (6h TTL) to avoid unnecessary re-analysis.
"""

import os
import sys
import json
import time
import hashlib
import uuid
import asyncio
import logging
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from typing import List, Dict, Optional
from pydantic import BaseModel

from api.models import (
    AnalyzeRequest, BatchAnalyzeRequest, BacktestRequest,
    TickerAnalysisResponse, BatchAnalysisResponse, HeatmapRow,
    DashboardRow, DashboardResponse,
    BacktestResponse, PortfolioRow, TickerHistoryResponse,
    OHLCVResponse, OHLCVPoint, HealthResponse,
    NseSymbolsResponse, ScanProgress, ScanStartResponse,
    LastPriceResponse,
)
from api.routes.chatbot_routes import router as chatbot_router


# ── Pattern Backtest Models ──

class PatternBacktestRequest(BaseModel):
    ticker: str
    years: int = 3
    min_confidence: int = 60
    min_rr: float = 1.5
    trend_filter: bool = True


class PatternTradeResult(BaseModel):
    pattern_type: str
    direction: str
    confidence: int
    entry_date: str
    entry_price: float
    stop_loss: float
    target: float
    exit_date: str
    exit_price: float
    r_multiple: float
    bars_held: int
    result: str
    trend_at_entry: str
    confidence_breakdown: Dict[str, int] = {}
    entry_checklist: Dict[str, bool] = {}
    failure_risk: Dict[str, float] = {}
    multi_tf_boost: float = 1.0
    timeframe: str = "daily"


class PatternDetail(BaseModel):
    """Enhanced pattern with confidence breakdown and institutional checklist."""
    type: str
    direction: str
    confidence: int
    confidence_breakdown: Dict[str, int] = {}
    entry_checklist: Dict[str, bool] = {}
    failure_risk: Dict[str, float] = {}
    multi_tf_boost: float = 1.0
    timeframe: str = "daily"
    entry: Optional[float] = None
    stop_loss: Optional[float] = None
    target: Optional[float] = None
    risk_reward: Optional[float] = None
    confirmations: List[str] = []
    status: str = "forming"


class PatternBacktestResponse(BaseModel):
    ticker: str
    total_trades: int
    wins: int
    losses: int
    scratches: int
    win_rate: float
    total_r: float
    avg_win_r: float
    avg_loss_r: float
    trades: List[PatternTradeResult]
    per_pattern: Dict[str, Dict]
    detected_patterns: List[PatternDetail] = []


from engine.runner import AnalysisRunner
from engine.report_generator import generate_report

logging.basicConfig(level=logging.INFO, format='%(levelname)s | %(message)s')
log = logging.getLogger(__name__)

# ── App Setup ──

_runner = AnalysisRunner()
# api/main.py → backend/ → quantamental-platform/ → share/ (4 levels up).
# On serverless (Vercel) point VM_SHARE_DIR at /tmp — the only writable dir.
_SHARE_DIR = os.environ.get("VM_SHARE_DIR") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_CACHE_DIR = os.path.join(_SHARE_DIR, 'reports', 'cache')
_CACHE_TTL_HOURS = int(os.environ.get("CACHE_TTL_HOURS", "6"))
_BATCH_TIMEOUT_SECONDS = int(os.environ.get("BATCH_TIMEOUT_SECONDS", "300"))  # 5 min per batch

os.makedirs(_CACHE_DIR, exist_ok=True)

# ── In-Memory Dashboard Cache ──
# Eliminates N+1 queries on every page load. Invalidated on scan completion or force refresh.

_dashboard_cache: dict = {}
_DASHBOARD_CACHE_TTL = int(os.environ.get("DASHBOARD_CACHE_TTL", "30"))

def _invalidate_dashboard_cache():
    _dashboard_cache.clear()
    log.info("  Dashboard cache invalidated")

def _get_dashboard_cache() -> DashboardResponse | None:
    data = _dashboard_cache.get("data")
    ts = _dashboard_cache.get("ts", 0.0)
    if data is not None and (time.time() - ts) < _DASHBOARD_CACHE_TTL:
        return data
    return None

def _set_dashboard_cache(data: DashboardResponse):
    _dashboard_cache["data"] = data
    _dashboard_cache["ts"] = time.time()


def _cache_path(ticker: str, period: str) -> str:
    """Get filesystem path for a cached analysis response."""
    key = f"{ticker.upper()}_{period}"
    hashed = hashlib.md5(key.encode()).hexdigest()
    return os.path.join(_CACHE_DIR, f"{hashed}.json")


def _get_cached(ticker: str, period: str) -> tuple[dict | None, float | None]:
    """
    Return (cached_result_dict, age_hours) if fresh cache exists,
    otherwise (None, None).
    """
    path = _cache_path(ticker, period)
    if not os.path.isfile(path):
        return None, None

    mtime = os.path.getmtime(path)
    age_hours = (time.time() - mtime) / 3600

    if age_hours > _CACHE_TTL_HOURS:
        log.info(f"  Cache stale for {ticker} ({age_hours:.1f}h old, max {_CACHE_TTL_HOURS}h)")
        return None, None

    try:
        with open(path, 'r') as f:
            data = json.load(f)
        log.info(f"  Cache HIT for {ticker} ({age_hours:.1f}h old)")
        return data, age_hours
    except Exception as e:
        log.warning(f"  Cache read error for {ticker}: {e}")
        return None, None


def _save_cache(ticker: str, period: str, data: dict):
    """Persist analysis response to file cache."""
    path = _cache_path(ticker, period)
    try:
        with open(path, 'w') as f:
            json.dump(data, f)
        log.info(f"  Cache saved for {ticker}")
    except Exception as e:
        log.warning(f"  Cache save error for {ticker}: {e}")


def _batch_read_cache(tickers: list[str], period: str) -> dict[str, dict | None]:
    """Read cache files for ALL tickers in a single blocking call.

    Runs in a thread pool worker so the event loop stays free.
    Returns {ticker: cached_data_or_None}.
    """
    result: dict[str, dict | None] = {}
    for ticker in tickers:
        cached, _ = _get_cached(ticker, period)
        result[ticker] = cached
    return result


# ── NSE Symbols ──

_nse_symbols_cache: list[str] | None = None
_nse_symbols_cache_time: float = 0
_NSE_CACHE_TTL = 3600  # 1 hour


def _get_nse_symbols() -> list[str]:
    """Get all NSE equity symbols using nsetools. Cached for 1 hour."""
    global _nse_symbols_cache, _nse_symbols_cache_time
    now = time.time()
    if _nse_symbols_cache is not None and (now - _nse_symbols_cache_time) < _NSE_CACHE_TTL:
        return _nse_symbols_cache

    try:
        from nsetools import Nse
        nse = Nse()
        codes = nse.get_stock_codes()
        if isinstance(codes, list):
            symbols = sorted(codes)
        elif isinstance(codes, dict):
            symbols = sorted(codes.keys())
        else:
            symbols = []
        # Filter out non-equity entries
        symbols = [s for s in symbols if s.isupper() and not s.startswith('NIFTY') and not s.startswith('BANK')]
        _nse_symbols_cache = symbols
        _nse_symbols_cache_time = now
        log.info(f"  NSE symbols loaded: {len(symbols)}")
        return symbols
    except Exception as e:
        log.warning(f"  NSE symbols fetch failed: {e}")
        return _nse_symbols_cache or []


# ── Background scan progress ──

_scans: dict[str, dict] = {}


# ── App ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown."""
    log.info("VijayMaruthi Wealth API starting...")
    # Verify modules are importable
    try:
        import technical_analysis_report
        log.info("  ✓ Analysis engine loaded")
    except ImportError as e:
        log.warning(f"  ✗ Analysis engine not available: {e}")
    yield
    log.info("VijayMaruthi Wealth API shutting down.")


app = FastAPI(
    title="VijayMaruthi Wealth API",
    version="4.0.0",
    description="Institutional-grade analysis engine — "
                "technical + fundamental + sentiment fusion.",
    lifespan=lifespan,
)

app.include_router(chatbot_router)

# CORS — allow Next.js dev server and production
# Extra origins can be added via the CORS_ORIGINS env var (comma-separated),
# e.g. CORS_ORIGINS=https://vijaymaruthi.vercel.app
_cors_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        *_cors_extra,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static reports (charts, etc.)
reports_dir = os.path.join(_SHARE_DIR, 'reports')
charts_dir = os.path.join(reports_dir, 'charts')
os.makedirs(reports_dir, exist_ok=True)
os.makedirs(charts_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=reports_dir), name="static")


# ── Routes ──

@app.get("/api/v1/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    modules = {}
    for name in ['numpy', 'pandas', 'yfinance', 'scipy', 'matplotlib']:
        try:
            __import__(name)
            modules[name] = True
        except ImportError:
            modules[name] = False
    return HealthResponse(modules=modules)


@app.get("/api/v1/nse-symbols", response_model=NseSymbolsResponse)
async def get_nse_symbols():
    """Get all NSE equity symbols (cached from nsetools)."""
    log.info("API: nse-symbols")
    loop = asyncio.get_event_loop()
    symbols = await loop.run_in_executor(None, _get_nse_symbols)
    return NseSymbolsResponse(total=len(symbols), symbols=symbols)


@app.post("/api/v1/analyze/scan-nse", response_model=ScanStartResponse)
async def scan_nse(period: str = "1y", limit: int = 0):
    """Start background scan of NSE stocks.

    - limit=0: scan ALL NSE stocks (2397 symbols, ~2-3 hours)
    - limit=N: scan only first N symbols (for testing)
    Returns immediately with a scan_id. Poll /analyze/scan-progress/{scan_id}.
    Results saved to DB + cache as each stock completes.
    """
    log.info("API: scan-nse (period=%s, limit=%d)", period, limit)
    scan_id = str(uuid.uuid4())
    _scans[scan_id] = {"status": "starting", "total": 0, "completed": 0, "failed": 0, "errors": []}

    # Launch background task
    asyncio.create_task(_run_nse_scan(scan_id, period, limit))

    return ScanStartResponse(scan_id=scan_id)


@app.get("/api/v1/analyze/scan-progress/{scan_id}", response_model=ScanProgress)
async def get_scan_progress(scan_id: str):
    """Get progress of an NSE scan."""
    scan = _scans.get(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan {scan_id} not found")
    return ScanProgress(
        scan_id=scan_id,
        status=scan["status"],
        total=scan["total"],
        completed=scan["completed"],
        failed=scan["failed"],
        errors=scan.get("errors", [])[-20:],  # last 20 errors
    )


async def _run_nse_scan(scan_id: str, period: str = "1y", limit: int = 0):
    """Background task: analyze NSE stocks in **parallel batches**.

    Each batch of 20 stocks is processed with 4 parallel workers via
    _run_batch_analysis. Progress updates after each batch completes.
    """
    log.info(f"  NSE scan {scan_id}: starting (limit={limit})")
    loop = asyncio.get_event_loop()

    # 1. Get all NSE symbols
    all_symbols = await loop.run_in_executor(None, _get_nse_symbols)
    if limit > 0:
        all_symbols = all_symbols[:limit]
    nse_symbols = [f"{s}.NS" for s in all_symbols]

    total = len(nse_symbols)
    _scans[scan_id]["total"] = total
    _scans[scan_id]["status"] = "running"
    log.info(f"  NSE scan {scan_id}: {total} symbols to analyze in batches of 20")

    # 2. Analyze in parallel batches of 20
    BATCH_SIZE = 20
    completed = 0
    failed = 0
    errors: list[str] = []
    last_log_pct = -1

    for i in range(0, total, BATCH_SIZE):
        batch = nse_symbols[i:i + BATCH_SIZE]
        try:
            # "Scan All NSE" is an explicit user action → force fresh analysis so
            # the LATEST price is always pulled (never reuse stale cache).
            await _run_batch_analysis(
                batch, period=period, sentiment=False, save_db=True, force=True,
            )
            completed += len(batch)
        except Exception as e:
            log.warning(f"  NSE scan {scan_id}: batch error at {i}: {e}")
            failed += len(batch)
            errors.append(f"Batch at {i} ({batch[0]}..{batch[-1]}): {e}")

        # Update progress after each batch
        _scans[scan_id]["completed"] = completed
        _scans[scan_id]["failed"] = failed
        _scans[scan_id]["errors"] = errors[-20:]

        # Rate-limit delay between batches
        if i + BATCH_SIZE < total:
            await asyncio.sleep(0.3)

        # Log progress every 5%
        pct = int(100 * completed / total) if total > 0 else 0
        if pct > last_log_pct and pct % 5 == 0:
            last_log_pct = pct
            log.info(f"  NSE scan {scan_id}: {completed}/{total} ({pct}%) — {failed} failed")

    _scans[scan_id]["status"] = "completed"
    _scans[scan_id]["completed"] = completed
    _scans[scan_id]["failed"] = failed
    _invalidate_dashboard_cache()
    log.info(f"  NSE scan {scan_id}: DONE — {completed} ok, {failed} failed")

    # Push results to Supabase (background, non-blocking)
    asyncio.create_task(_sync_to_supabase_after_scan(scan_id))


async def _sync_to_supabase_after_scan(scan_id: str) -> None:
    """Run sync_to_supabase.py in background after a scan completes.

    Non-blocking: the scan is already marked 'completed' before this runs.
    Failures are logged but never affect the scan status.
    """
    sync_script = os.path.join(_SHARE_DIR, "vijaymaruthi", "sync", "sync_to_supabase.py")
    if not os.path.isfile(sync_script):
        log.warning(f"Scan {scan_id}: sync script not found at {sync_script} — skipping cloud push")
        return

    log.info(f"Scan {scan_id}: syncing to Supabase...")
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, sync_script, "--skip-ohlcv",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode == 0:
            log.info(f"Scan {scan_id}: Supabase sync OK")
        else:
            log.warning(f"Scan {scan_id}: Supabase sync failed (exit {proc.returncode}): {stderr.decode()[:500]}")
    except asyncio.TimeoutError:
        log.warning(f"Scan {scan_id}: Supabase sync timed out (300s)")
    except Exception as exc:
        log.warning(f"Scan {scan_id}: Supabase sync error: {exc}")


# ── Pending NSE scan ──


async def _run_pending_nse_scan(scan_id: str, period: str = "1y", limit: int = 0):
    """Background task: analyze only NSE stocks not yet in the DB.

    1. Fetch all NSE symbols
    2. Subtract tickers already in the portfolio DB
    3. Run batch analysis on the remainder
    """
    log.info(f"  Pending NSE scan {scan_id}: starting (limit={limit})")
    loop = asyncio.get_event_loop()

    # 1. Get all NSE symbols
    all_symbols = await loop.run_in_executor(None, _get_nse_symbols)

    # 2. Get already-analyzed tickers from DB
    try:
        portfolio = await loop.run_in_executor(None, _runner.get_portfolio)
        db_tickers: set[str] = set()
        for p in portfolio:
            t = p.get("ticker", "")
            if t:
                db_tickers.add(t)
    except Exception as e:
        log.warning(f"  Could not read portfolio for pending scan: {e}")
        db_tickers = set()

    # 3. Compute pending (NSE symbols not yet in DB)
    pending = [f"{s}.NS" for s in all_symbols if f"{s}.NS" not in db_tickers]
    if limit > 0:
        pending = pending[:limit]

    total = len(pending)
    _scans[scan_id]["total"] = total
    _scans[scan_id]["status"] = "running"
    log.info(f"  Pending NSE scan {scan_id}: {total} pending (already have {len(db_tickers)})")

    if total == 0:
        _scans[scan_id]["status"] = "completed"
        _invalidate_dashboard_cache()
        log.info(f"  Pending NSE scan {scan_id}: nothing to do — all {len(db_tickers)} analysed")
        return

    # 4. Analyze in parallel batches (same batch logic as full scan)
    BATCH_SIZE = 20
    completed = 0
    failed = 0
    errors: list[str] = []
    last_log_pct = -1

    for i in range(0, total, BATCH_SIZE):
        batch = pending[i:i + BATCH_SIZE]
        try:
            await _run_batch_analysis(batch, period=period, sentiment=False, save_db=True, force=False)
            completed += len(batch)
        except Exception as e:
            log.warning(f"  Pending scan {scan_id}: batch error at {i}: {e}")
            failed += len(batch)
            errors.append(f"Batch at {i} ({batch[0]}..{batch[-1]}): {e}")

        _scans[scan_id]["completed"] = completed
        _scans[scan_id]["failed"] = failed
        _scans[scan_id]["errors"] = errors[-20:]

        if i + BATCH_SIZE < total:
            await asyncio.sleep(0.3)

        pct = int(100 * completed / total) if total > 0 else 0
        if pct > last_log_pct and pct % 5 == 0:
            last_log_pct = pct
            log.info(f"  Pending scan {scan_id}: {completed}/{total} ({pct}%) — {failed} failed")

    _scans[scan_id]["status"] = "completed"
    _scans[scan_id]["completed"] = completed
    _scans[scan_id]["failed"] = failed
    _invalidate_dashboard_cache()
    log.info(f"  Pending NSE scan {scan_id}: DONE — {completed} ok, {failed} failed")

    # Push results to Supabase (background, non-blocking)
    asyncio.create_task(_sync_to_supabase_after_scan(scan_id))


@app.post("/api/v1/analyze/scan-pending", response_model=ScanStartResponse)
async def scan_pending_nse(period: str = "1y", limit: int = 0):
    """Start a background scan of only pending (not-yet-analysed) NSE stocks.

    Fetches all NSE symbols, subtracts those already in the portfolio DB,
    and runs batch analysis on the remainder. Returns immediately with a
    scan_id for progress polling.
    """
    log.info("API: scan-pending (period=%s, limit=%d)", period, limit)
    scan_id = str(uuid.uuid4())
    _scans[scan_id] = {"status": "starting", "total": 0, "completed": 0, "failed": 0, "errors": []}

    asyncio.create_task(_run_pending_nse_scan(scan_id, period, limit))

    return ScanStartResponse(scan_id=scan_id)


# ── Export / Report ──


@app.get("/api/v1/export/report")
async def export_report():
    """Generate a professional executive report HTML page.

    Returns a fully self-contained, print-friendly HTML document with
    inline CSS — ready for browser print-to-PDF. No external resources.
    """
    log.info("API: export/report")
    loop = asyncio.get_event_loop()

    # Fetch all analysed stocks from DB + cache (same logic as dashboard)
    rows: list[dict] = []
    try:
        portfolio = await loop.run_in_executor(None, _runner.get_portfolio)
        for p in portfolio:
            ticker = p.get("ticker", "")
            if not ticker:
                continue
            # Enrich with cache data
            cached, _ = _get_cached(ticker, "1y")
            price = p.get("price", 0) or 0
            qm_score = p.get("qm_score", 0) or 0
            qm_rating = p.get("qm_rating", "N/A")
            tech_signal = p.get("tech_signal", "HOLD")
            trend = p.get("trend", "stable")
            score_change = p.get("score_change", 0.0) or 0.0

            # Get history run count
            history_runs = 0
            try:
                h = await loop.run_in_executor(None, _runner.get_ticker_history, ticker)
                history_runs = h.get("runs", 0) if isinstance(h, dict) else 0
            except Exception:
                pass

            if cached:
                fund = cached.get("fundamentals", {})
                qr = fund.get("quick_ratings", {}) if isinstance(fund, dict) else {}
                fund_rating = qr.get("screening_rating", "N/A")
                price = cached.get("price", price) or price
            else:
                fund_rating = "N/A"

            rows.append({
                "ticker": ticker,
                "qm_rating": qm_rating,
                "qm_score": qm_score,
                "trend": trend,
                "score_change": score_change,
                "tech_signal": tech_signal,
                "fund_rating": fund_rating,
                "price": price,
                "history_runs": history_runs,
            })
    except Exception as e:
        log.warning(f"  Export data fetch failed: {e}")

    # Sort by score descending within rating buckets (same as dashboard)
    def pri(r):
        if r.get("qm_rating") in ("Strong Buy", "Buy"):
            return 0
        if r.get("qm_rating") == "Hold":
            return 1
        return 2
    rows.sort(key=lambda r: (pri(r), -(r.get("qm_score", 0) or 0)))

    html = generate_report(rows)

    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html, status_code=200,
                        headers={"Content-Type": "text/html; charset=utf-8"})


@app.post("/api/v1/analyze", response_model=TickerAnalysisResponse)
async def analyze(req: AnalyzeRequest):
    """Run full quantamental analysis on a single ticker.

    Returns cached result if available and < 6h old (unless force=True).
    Always saves to cache after fresh analysis.
    """
    log.info(f"API: analyze {req.ticker} (period={req.period}, force={req.force})")

    # 1. Check cache (skip if force=True)
    if not req.force:
        cached, age_hours = _get_cached(req.ticker, req.period)
        if cached is not None:
            cached['cached'] = True
            cached['cached_at'] = datetime.now().isoformat()
            return cached

    # 2. Run fresh analysis
    log.info(f"  Cache MISS — running analysis for {req.ticker}")
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, _runner.run_ticker,
            req.ticker, req.period, req.sentiment, req.save_db,
            req.manual_data, req.options,
        )
    except Exception as e:
        log.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if 'error' in result:
        raise HTTPException(status_code=404, detail=result['error'])

    # 3. Save to cache
    _save_cache(req.ticker, req.period, result)
    result['cached'] = False
    result['cached_at'] = None

    return result


async def _run_batch_analysis(
    tickers: list[str],
    period: str = "1y",
    sentiment: bool = False,
    save_db: bool = True,
    force: bool = False,
) -> tuple[list[dict], int, int]:
    """Shared batch analysis logic — checks cache, runs fresh, returns (rows, cached_count, fresh_count)."""
    rows: list[dict] = []
    fresh_count = 0
    cached_count = 0
    fresh_tickers: list[str] = []
    loop = asyncio.get_event_loop()

    # 1. Check cache for each ticker
    for ticker in tickers:
        if not force:
            cached, _ = _get_cached(ticker, period)
            if cached is not None:
                qm = cached.get('quantamental', {})
                fund = cached.get('fundamentals', {})
                qr = fund.get('quick_ratings', {}) if isinstance(fund, dict) else {}
                rows.append({
                    'ticker': ticker,
                    'qm_rating': qm.get('blended_rating', 'N/A'),
                    'qm_score': qm.get('blended_score', 0) or 0,
                    'tech_signal': cached.get('signal', 'HOLD'),
                    'tech_confidence': cached.get('confidence', 0) or 0,
                    'tech_score': qm.get('technical_score', 0) or 0,
                    'fund_rating': qr.get('screening_rating', 'N/A'),
                    'fund_score': qm.get('fundamental_score', 0) or 0,
                    'cap_category': qm.get('market_cap_category', 'mid') or 'mid',
                    'price': cached.get('price', 0),
                    'cached': True,
                })
                cached_count += 1
                continue
        fresh_tickers.append(ticker)

    # 2. Run fresh analysis for uncached tickers (with timeout to prevent stuck scans)
    if fresh_tickers:
        log.info(f"  Running fresh analysis for {len(fresh_tickers)} tickers: {fresh_tickers}")
        try:
            fresh_results = await asyncio.wait_for(
                loop.run_in_executor(
                    None, _runner.run_batch,
                    fresh_tickers, period, sentiment, save_db,
                ),
                timeout=_BATCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            log.error(f"  Batch analysis TIMEOUT after {_BATCH_TIMEOUT_SECONDS}s for {len(fresh_tickers)} tickers")
            raise RuntimeError(f"Batch analysis timed out after {_BATCH_TIMEOUT_SECONDS}s")
        except Exception as e:
            raise RuntimeError(f"Batch analysis failed: {e}")

        for r in fresh_results:
            if 'error' in r:
                log.warning(f"  Batch error for {r.get('ticker')}: {r['error']}")
                rows.append({
                    'ticker': r.get('ticker', '?'),
                    'qm_rating': 'N/A',
                    'qm_score': 0,
                    'tech_signal': 'HOLD',
                    'tech_confidence': 0,
                    'tech_score': 0,
                    'fund_rating': 'N/A',
                    'fund_score': 0,
                    'cap_category': 'mid',
                    'price': 0,
                    'cached': False,
                })
                continue

            qm = r.get('quantamental', {})
            fund = r.get('fundamentals', {})
            qr = fund.get('quick_ratings', {}) if isinstance(fund, dict) else {}
            rows.append({
                'ticker': r.get('ticker', '?'),
                'qm_rating': qm.get('blended_rating', 'N/A'),
                'qm_score': qm.get('blended_score', 0) or 0,
                'tech_signal': r.get('signal', 'HOLD'),
                'tech_confidence': r.get('confidence', 0) or 0,
                'tech_score': qm.get('technical_score', 0) or 0,
                'fund_rating': qr.get('screening_rating', 'N/A'),
                'fund_score': qm.get('fundamental_score', 0) or 0,
                'cap_category': qm.get('market_cap_category', 'mid') or 'mid',
                'price': r.get('price', 0),
                'cached': False,
            })
            # Save fresh result to cache
            _save_cache(r.get('ticker', ''), period, r)

        fresh_count = len(fresh_results)

    # 3. Sort by score descending
    rows.sort(key=lambda r: r['qm_score'], reverse=True)
    for i, row in enumerate(rows, 1):
        row['rank'] = i

    return rows, cached_count, fresh_count


@app.post("/api/v1/analyze/batch", response_model=BatchAnalysisResponse)
async def analyze_batch(req: BatchAnalyzeRequest):
    """Run analysis on multiple tickers and return heatmap.

    Checks cache for each ticker first — only runs fresh analysis
    for uncached or expired results.
    """
    log.info(f"API: batch analyze {len(req.tickers)} tickers (force={req.force})")

    rows, cached_count, fresh_count = await _run_batch_analysis(
        req.tickers, req.period, req.sentiment, req.save_db, req.force,
    )

    heatmap_rows = [HeatmapRow(**r) for r in rows]

    buys = sum(1 for r in heatmap_rows if r.qm_rating in ('Strong Buy', 'Buy'))
    holds = sum(1 for r in heatmap_rows if r.qm_rating == 'Hold')
    sells = sum(1 for r in heatmap_rows if r.qm_rating in ('Sell', 'Strong Sell'))

    return BatchAnalysisResponse(
        rows=heatmap_rows,
        summary={'buy': buys, 'hold': holds, 'sell': sells, 'total': len(heatmap_rows)},
        cached_count=cached_count,
        fresh_count=fresh_count,
    )


@app.get("/api/v1/dashboard", response_model=DashboardResponse)
async def get_dashboard(force: bool = False, period: str = "1y"):
    """Full-picture dashboard: latest analysis merged with DB trend data.

    **Always returns instantly** — never blocks on analysis.
    Uses in-memory cache (30s TTL) to avoid redundant DB queries on every page load.
    Cache is invalidated when a scan completes or force=True is requested.
    """
    log.info(f"API: dashboard (force={force}, period={period})")

    # 0. Check in-memory cache (instant — skip if force refresh)
    if not force:
        cached = _get_dashboard_cache()
        if cached is not None:
            return cached

    loop = asyncio.get_event_loop()

    # 1. Get portfolio / trend data from DB (single call — includes history_runs now)
    portfolio_map: dict[str, dict] = {}
    try:
        portfolio = await loop.run_in_executor(None, _runner.get_portfolio)
        for p in portfolio:
            ticker = p.get("ticker", "")
            if not ticker:
                continue
            portfolio_map[ticker] = {
                "trend": p.get("trend", "stable"),
                "score_change": p.get("score_change", 0.0),
                "last_analyzed": p.get("date", None),
                "history_runs": p.get("history_runs", 0),
                "price": p.get("price", 0) or 0,
                "qm_rating": p.get("qm_rating", "N/A"),
                "qm_score": p.get("qm_score", 0) or 0,
                "tech_signal": p.get("tech_signal", "HOLD"),
                "tech_score": p.get("tech_score", 0) or 0,
                "fund_score": p.get("fund_score", 0) or 0,
                "cap_category": p.get("cap_category", "mid"),
                "health_pass": p.get("health_pass"),
            }
    except Exception as e:
        log.warning(f"  Portfolio query failed: {e}")

    all_tickers = list(portfolio_map.keys())

    # Get total NSE count for context
    total_nse = 0
    try:
        nse_symbols = await loop.run_in_executor(None, _get_nse_symbols)
        total_nse = len(nse_symbols)
    except Exception:
        pass

    if not all_tickers:
        resp = DashboardResponse(
            rows=[],
            summary={"buy": 0, "hold": 0, "sell": 0, "total": 0},
            db_entries=0,
            total_nse_count=total_nse,
        )
        _set_dashboard_cache(resp)
        return resp

    # 2. Read ALL cache files in a single thread pool batch (avoids 2368 event-loop hops)
    cache_map: dict[str, dict | None] = {}
    if not force:
        try:
            cache_map = await loop.run_in_executor(
                None, _batch_read_cache, all_tickers, period,
            )
        except Exception:
            pass

    # 3. Build enriched rows (no more per-ticker run_in_executor calls)
    enriched = []
    for ticker in all_tickers:
        pdata = portfolio_map.get(ticker, {})
        cached_data = cache_map.get(ticker)

        history_runs = pdata.get("history_runs", 0)

        if cached_data:
            qm = cached_data.get('quantamental', {})
            fund = cached_data.get('fundamentals', {})
            qr = fund.get('quick_ratings', {}) if isinstance(fund, dict) else {}
            enriched.append(DashboardRow(
                rank=0,
                ticker=ticker,
                qm_rating=qm.get('blended_rating', pdata.get('qm_rating', 'N/A')),
                qm_score=qm.get('blended_score', pdata.get('qm_score', 0)) or 0,
                tech_signal=cached_data.get('signal', pdata.get('tech_signal', 'HOLD')),
                tech_confidence=cached_data.get('confidence', 0) or 0,
                tech_score=qm.get('technical_score', pdata.get('tech_score', 0)) or 0,
                fund_rating=qr.get('screening_rating', 'N/A'),
                fund_score=qm.get('fundamental_score', pdata.get('fund_score', 0)) or 0,
                cap_category=qm.get('market_cap_category', pdata.get('cap_category', 'mid')) or 'mid',
                price=cached_data.get('price', pdata.get('price', 0)) or 0,
                cached=True,
                trend=pdata.get("trend", "stable"),
                score_change=pdata.get("score_change", 0.0),
                last_analyzed=pdata.get("last_analyzed", None),
                history_runs=history_runs,
                health_pass=pdata.get("health_pass"),
            ))
        else:
            enriched.append(DashboardRow(
                rank=0,
                ticker=ticker,
                qm_rating=pdata.get('qm_rating', 'N/A'),
                qm_score=pdata.get('qm_score', 0) or 0,
                tech_signal=pdata.get('tech_signal', 'HOLD'),
                tech_confidence=0.0,
                tech_score=pdata.get('tech_score', 0) or 0,
                fund_rating='N/A',
                fund_score=pdata.get('fund_score', 0) or 0,
                cap_category=pdata.get('cap_category', 'mid') or 'mid',
                price=pdata.get('price', 0) or 0,
                cached=False,
                trend=pdata.get("trend", "stable"),
                score_change=pdata.get("score_change", 0.0),
                last_analyzed=pdata.get("last_analyzed", None),
                history_runs=history_runs,
                health_pass=pdata.get("health_pass"),
            ))

    # 4. Score-desc sort + rank
    enriched.sort(key=lambda r: r.qm_score, reverse=True)
    for i, r in enumerate(enriched, 1):
        r.rank = i

    buys = sum(1 for r in enriched if r.qm_rating in ("Strong Buy", "Buy"))
    holds = sum(1 for r in enriched if r.qm_rating == "Hold")
    sells = sum(1 for r in enriched if r.qm_rating in ("Sell", "Strong Sell"))

    # v3 health summary (None = pre-v3 rows without health data)
    health_known = [r for r in enriched if r.health_pass is not None]
    health_pass_count = sum(1 for r in health_known if r.health_pass)
    health_fail_count = len(health_known) - health_pass_count

    resp = DashboardResponse(
        rows=enriched,
        summary={"buy": buys, "hold": holds, "sell": sells, "total": len(enriched)},
        db_entries=len(all_tickers),
        total_nse_count=total_nse,
        health_summary={
            "known": len(health_known),
            "pass": health_pass_count,
            "fail": health_fail_count,
        },
    )

    # 5. Cache in memory for next request (30s TTL)
    _set_dashboard_cache(resp)

    return resp


@app.get("/api/v1/portfolio", response_model=list[PortfolioRow])
async def get_portfolio():
    """Get latest portfolio snapshot from the database."""
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _runner.get_portfolio)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return [
        PortfolioRow(**row) if isinstance(row, dict) else row
        for row in data
    ]


@app.get("/api/v1/history/{ticker}", response_model=TickerHistoryResponse)
async def get_history(ticker: str):
    """Get analysis history for a specific ticker."""
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _runner.get_ticker_history, ticker)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return data


@app.post("/api/v1/backtest", response_model=BacktestResponse)
async def backtest(req: BacktestRequest):
    """Run quantamental backtest for a ticker."""
    log.info(f"API: backtest {req.ticker} ({req.years}y, "
             f"rebalance={req.rebalance_days}d)")
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, _runner.run_backtest,
            req.ticker, req.years, req.rebalance_days,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if 'error' in result:
        raise HTTPException(status_code=400, detail=result['error'])
    return result


@app.get("/api/v1/last-price/{ticker}", response_model=LastPriceResponse)
async def get_last_price(ticker: str):
    """Get the most recent/last traded price for a ticker.

    Priority:
    1. yfinance Ticker.info.currentPrice (actual last traded price, fastest)
    2. yfinance daily history close (accurate daily close)
    3. yfinance 1-minute intraday data last candle close (fallback)
    4. yfinance 5-daily close (last resort fallback)
    """
    log.info(f"API: last-price {ticker}")
    import yfinance as yf
    from datetime import datetime, timezone

    def _flatten_cols(df: pd.DataFrame) -> pd.DataFrame:
        """Flatten MultiIndex columns (from NSE symbols with auto_adjust=True)."""
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df

    # Priority 1: Ticker.info for currentPrice (actual last traded price)
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if price is not None:
            now_utc = datetime.now(timezone.utc)
            time_str = now_utc.strftime('%Y-%m-%d %H:%M:%S')
            return LastPriceResponse(ticker=ticker, price=float(price), time=time_str, source="intraday")
    except Exception as e:
        log.warning(f"  Ticker.info failed for {ticker}: {e}")

    # Priority 2: Try daily history first (accurate daily close)
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="1d", auto_adjust=True)
        if hist is not None and not hist.empty and 'Close' in hist.columns:
            last = hist.iloc[-1]
            price = float(last['Close'])
            ts = last.name
            if hasattr(ts, 'strftime'):
                time_str = ts.strftime('%Y-%m-%d')
            else:
                time_str = str(ts)
            return LastPriceResponse(ticker=ticker, price=price, time=time_str, source="intraday")
    except Exception as e:
        log.warning(f"  Daily history fetch failed for {ticker}: {e}")

    # Priority 3: Intraday 1-minute data (last candle close)
    try:
        df = yf.download(ticker, period="1d", interval="1m", progress=False, auto_adjust=True)
        df = _flatten_cols(df)
        if df is not None and not df.empty and 'Close' in df.columns:
            last = df.iloc[-1]
            price = float(last['Close'])
            ts = last.name
            if hasattr(ts, 'strftime'):
                time_str = ts.strftime('%Y-%m-%d %H:%M:%S')
            else:
                time_str = str(ts)
            return LastPriceResponse(ticker=ticker, price=price, time=time_str, source="intraday")
    except Exception as e:
        log.warning(f"  Intraday fetch failed for {ticker}: {e}")

    # Priority 4: Fallback to 5-day daily close
    try:
        df = yf.download(ticker, period="5d", progress=False, auto_adjust=True)
        df = _flatten_cols(df)
        if df is not None and not df.empty and 'Close' in df.columns:
            last = df.iloc[-1]
            price = float(last['Close'])
            ts = last.name
            if hasattr(ts, 'strftime'):
                time_str = ts.strftime('%Y-%m-%d')
            else:
                time_str = str(ts)
            return LastPriceResponse(ticker=ticker, price=price, time=time_str, source="daily")
    except Exception as e:
        log.error(f"  Daily fetch failed for {ticker}: {e}")

    return LastPriceResponse(ticker=ticker, price=None, source="none")


@app.get("/api/v1/ohlcv/{ticker}", response_model=OHLCVResponse)
async def get_ohlcv(ticker: str, period: str = "1y"):
    """Get OHLCV price data for interactive charting."""
    log.info(f"API: ohlcv {ticker} (period={period})")
    import yfinance as yf
    try:
        df = yf.download(ticker, period=period, progress=False, auto_adjust=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {e}")

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {ticker}")

    # Rename columns if needed (yfinance returns with MultiIndex columns)
    if isinstance(df.columns, type(pd.MultiIndex(levels=[[]], codes=[[]]))):
        df.columns = df.columns.get_level_values(0)

    cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume'] if c in df.columns]

    candles = []
    for idx, row in df.iterrows():
        # Skip rows with NaN values (e.g. incomplete trading day)
        if any(pd.isna(row.get(c)) for c in ['Open', 'High', 'Low', 'Close', 'Volume']):
            continue
        date_str = idx.strftime('%Y-%m-%d') if hasattr(idx, 'strftime') else str(idx)[:10]
        candles.append(OHLCVPoint(
            time=date_str,
            open=float(row['Open']),
            high=float(row['High']),
            low=float(row['Low']),
            close=float(row['Close']),
            volume=int(row['Volume']),
        ))

    # Limit to 500 candles max (for performance)
    if len(candles) > 500:
        # Keep last 500
        candles = candles[-500:]

    return OHLCVResponse(ticker=ticker, period=period, candles=candles)


@app.post("/api/v1/pattern-backtest", response_model=PatternBacktestResponse)
async def pattern_backtest(req: PatternBacktestRequest):
    """Run chart pattern backtest for a ticker using pattern detection engine."""
    log.info(f"API: pattern-backtest {req.ticker} ({req.years}y, "
             f"min_conf={req.min_confidence}, min_rr={req.min_rr})")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None, _run_pattern_backtest,
            req.ticker, req.years, req.min_confidence, req.min_rr, req.trend_filter,
        )
    except Exception as e:
        log.error(f"Pattern backtest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    trades = [
        PatternTradeResult(
            pattern_type=t.pattern_type, direction=t.direction, confidence=t.confidence,
            entry_date=t.entry_date, entry_price=t.entry_price, stop_loss=t.stop_loss,
            target=t.target, exit_date=t.exit_date, exit_price=t.exit_price,
            r_multiple=t.r_multiple, bars_held=t.bars_held, result=t.result,
            trend_at_entry=t.trend_at_entry,
            confidence_breakdown=t.confidence_breakdown,
            entry_checklist=t.entry_checklist,
            failure_risk=t.failure_risk,
            multi_tf_boost=t.multi_tf_boost,
            timeframe=t.timeframe,
        )
        for t in result["trades"]
    ]

    detected = [
        PatternDetail(
            type=p.type, direction=p.direction, confidence=p.confidence,
            confidence_breakdown=p.confidence_breakdown,
            entry_checklist=p.entry_checklist,
            failure_risk=p.failure_risk,
            multi_tf_boost=p.multi_tf_boost,
            timeframe=p.timeframe,
            entry=p.entry, stop_loss=p.stop_loss, target=p.target,
            risk_reward=p.risk_reward,
            confirmations=p.confirmations,
            status=p.status,
        )
        for p in result.get("detected_patterns", [])
    ]

    return PatternBacktestResponse(
        ticker=result["ticker"], total_trades=result["total_trades"],
        wins=result["wins"], losses=result["losses"], scratches=result["scratches"],
        win_rate=result["win_rate"], total_r=result["total_r"],
        avg_win_r=result["avg_win_r"], avg_loss_r=result["avg_loss_r"],
        trades=trades, per_pattern=result["per_pattern"],
        detected_patterns=detected,
    )


def _run_pattern_backtest(ticker: str, years: int, min_confidence: int,
                          min_rr: float, trend_filter: bool) -> dict:
    """Blocking pattern backtest (runs in thread pool)."""
    from engine.pattern_engine import run_pattern_backtest
    return run_pattern_backtest(ticker, years, min_confidence, min_rr, trend_filter)


# ═══════════════════════════════════════════════════════════════
#  Fundamentals endpoint for Convolution view
# ═══════════════════════════════════════════════════════════════

from pydantic import BaseModel as PydanticBase

class FundamentalsResponse(PydanticBase):
    ticker: str
    name: str = ""
    sector: str = ""
    industry: str = ""
    market_cap: float = 0
    currency: str = "INR"
    current_price: float = 0
    day_high: float = 0
    day_low: float = 0
    fifty_two_week_high: float = 0
    fifty_two_week_low: float = 0
    pe_trailing: float = 0
    pe_forward: float = 0
    pb_ratio: float = 0
    ps_ratio: float = 0
    peg_ratio: float = 0
    dividend_yield: float = 0
    eps_trailing: float = 0
    eps_forward: float = 0
    book_value: float = 0
    revenue: float = 0
    revenue_growth: float = 0
    net_income: float = 0
    profit_margin: float = 0
    operating_margin: float = 0
    roe: float = 0
    roa: float = 0
    debt_to_equity: float = 0
    current_ratio: float = 0
    free_cash_flow: float = 0
    beta: float = 0
    avg_volume: float = 0
    shares_outstanding: float = 0
    held_by_insiders: float = 0
    held_by_institutions: float = 0
    short_ratio: float = 0
    ex_dividend_date: str = ""
    earnings_date: str = ""
    analyst_target: float = 0
    analyst_recommendation: str = ""
    fundamental_score: float = 0  # 0-100 computed score


def _safe_float(val, default=0.0):
    """Safely convert yfinance value to float."""
    if val is None:
        return default
    try:
        import math
        v = float(val)
        return default if math.isnan(v) or math.isinf(v) else v
    except (TypeError, ValueError):
        return default


def _fetch_fundamentals(ticker: str) -> dict:
    """Fetch fundamental data from yfinance."""
    import yfinance as yf

    stock = yf.Ticker(ticker)
    info = stock.info or {}

    result = {
        "ticker": ticker,
        "name": info.get("shortName") or info.get("longName") or ticker.replace(".NS", "").replace(".BO", ""),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
        "market_cap": _safe_float(info.get("marketCap")),
        "currency": info.get("currency", "INR"),
        "current_price": _safe_float(info.get("currentPrice") or info.get("regularMarketPrice")),
        "day_high": _safe_float(info.get("dayHigh")),
        "day_low": _safe_float(info.get("dayLow")),
        "fifty_two_week_high": _safe_float(info.get("fiftyTwoWeekHigh")),
        "fifty_two_week_low": _safe_float(info.get("fiftyTwoWeekLow")),
        "pe_trailing": _safe_float(info.get("trailingPE")),
        "pe_forward": _safe_float(info.get("forwardPE")),
        "pb_ratio": _safe_float(info.get("priceToBook")),
        "ps_ratio": _safe_float(info.get("priceToSalesTrailing12Months")),
        "peg_ratio": _safe_float(info.get("pegRatio")),
        "dividend_yield": _safe_float(info.get("dividendYield")),
        "eps_trailing": _safe_float(info.get("trailingEps")),
        "eps_forward": _safe_float(info.get("forwardEps")),
        "book_value": _safe_float(info.get("bookValue")),
        "revenue": _safe_float(info.get("totalRevenue")),
        "revenue_growth": _safe_float(info.get("revenueGrowth")),
        "net_income": _safe_float(info.get("netIncomeToCommon")),
        "profit_margin": _safe_float(info.get("profitMargins")),
        "operating_margin": _safe_float(info.get("operatingMargins")),
        "roe": _safe_float(info.get("returnOnEquity")),
        "roa": _safe_float(info.get("returnOnAssets")),
        "debt_to_equity": _safe_float(info.get("debtToEquity")),
        "current_ratio": _safe_float(info.get("currentRatio")),
        "free_cash_flow": _safe_float(info.get("freeCashflow")),
        "beta": _safe_float(info.get("beta")),
        "avg_volume": _safe_float(info.get("averageVolume")),
        "shares_outstanding": _safe_float(info.get("sharesOutstanding")),
        "held_by_insiders": _safe_float(info.get("heldPercentInsiders")),
        "held_by_institutions": _safe_float(info.get("heldPercentInstitutions")),
        "short_ratio": _safe_float(info.get("shortRatio")),
        "ex_dividend_date": str(info.get("exDividendDate", "")),
        "earnings_date": str(info.get("earningsTimestamp", "")),
        "analyst_target": _safe_float(info.get("targetMeanPrice")),
        "analyst_recommendation": str(info.get("recommendationKey", "")),
    }

    # Compute a 0-100 fundamental health score
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
        upside = (result["analyst_target"] - result["current_price"]) / result["current_price"]
        if upside > 0.15: score += 5
        elif upside < -0.10: score -= 5

    result["fundamental_score"] = max(0, min(100, round(score)))
    return result


@app.get("/api/v1/fundamentals/{ticker:path}")
async def get_fundamentals(ticker: str):
    """Fetch fundamental data for a stock ticker."""
    log.info(f"API: fundamentals {ticker}")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, _fetch_fundamentals, ticker)
    except Exception as e:
        log.error(f"Fundamentals error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return result


# ── Direct run ──
if __name__ == '__main__':
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8765, reload=True)
