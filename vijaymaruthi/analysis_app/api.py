"""FastAPI router exposing the deterministic analyzer.

Mount in ``backend/api/main.py``::

    from analysis_app.api import router as deterministic_router
    app.include_router(deterministic_router)

Endpoints (all read from the pinned snapshot; only ``/analyze`` computes):

    GET  /api/v1/deterministic/health
    GET  /api/v1/deterministic/universe
    GET  /api/v1/deterministic/state/{ticker}
    POST /api/v1/deterministic/analyze
    GET  /api/v1/deterministic/runs
    GET  /api/v1/deterministic/runs/{run_id}
    GET  /api/v1/deterministic/runs/{run_id}/stocks/{ticker}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ── make the analysis_app package importable from the backend ──
_APP_DIR = Path(__file__).resolve().parent
_REPO_DIR = _APP_DIR.parent
if str(_REPO_DIR) not in sys.path:
    sys.path.insert(0, str(_REPO_DIR))

from analysis_app.analyzer import AnalyzeConfig, analyze_ticker, analyze_universe  # noqa: E402
from analysis_app.datasource import PinnedDataSource  # noqa: E402
from analysis_app.determinism import Clock  # noqa: E402
from analysis_app.report import write_run  # noqa: E402

router = APIRouter(prefix="/api/v1/deterministic", tags=["deterministic"])

SNAPSHOT_DIR = os.environ.get("ANALYSIS_APP_SNAPSHOT", str(_APP_DIR / "snapshot"))
RUNS_DIR = os.environ.get("ANALYSIS_APP_RUNS", str(_APP_DIR / "runs"))


class AnalyzeBody(BaseModel):
    limit: Optional[int] = None
    as_of: Optional[str] = None
    period: str = "3y"
    timeline: bool = False
    persist: bool = True


def _ds() -> PinnedDataSource:
    try:
        return PinnedDataSource(SNAPSHOT_DIR)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/health")
def health() -> Dict[str, Any]:
    ds = _ds()
    meta = ds.meta()
    return {
        "status": "ok",
        "snapshot_dir": SNAPSHOT_DIR,
        "snapshot_date": meta.get("snapshot_date"),
        "snapshot_sha": meta.get("snapshot_sha"),
        "tickers": int(meta.get("tickers_count", 0) or 0),
        "ohlcv_rows": int(meta.get("ohlcv_rows", 0) or 0),
        "fundamentals": int(meta.get("fundamentals_count", 0) or 0),
    }


@router.get("/universe")
def universe() -> Dict[str, Any]:
    ds = _ds()
    tickers = ds.universe()
    return {"count": len(tickers), "universe_sha": ds.universe_sha(),
            "tickers": tickers}


@router.get("/state/{ticker}")
def state(ticker: str, timeline: bool = False) -> Dict[str, Any]:
    ds = _ds()
    if ticker not in set(ds.universe()):
        raise HTTPException(status_code=404, detail=f"{ticker} not in universe")
    as_of = ds.meta().get("snapshot_date") or "1970-01-01"
    res = analyze_ticker(ds, ticker, Clock.at(as_of),
                         AnalyzeConfig(include_timeline=timeline))
    return res.as_dict()


@router.post("/analyze")
def analyze(body: AnalyzeBody) -> Dict[str, Any]:
    ds = _ds()
    as_of = body.as_of or ds.meta().get("snapshot_date") or "1970-01-01"
    run = analyze_universe(
        ds, Clock.at(as_of),
        AnalyzeConfig(period=body.period, include_timeline=body.timeline),
        limit=body.limit)
    manifest = run["manifest"]
    if body.persist:
        out = Path(RUNS_DIR) / run["run_id"]
        manifest = write_run(out, run)
        manifest["out"] = str(out)
    return {
        "run_id": run["run_id"],
        "manifest": manifest,
        "results": [r.as_dict() for r in run["results"]],
    }


@router.get("/runs")
def list_runs() -> Dict[str, Any]:
    base = Path(RUNS_DIR)
    if not base.exists():
        return {"runs": []}
    runs = []
    for p in sorted(base.iterdir()):
        mf = p / "manifest.json"
        if p.is_dir() and mf.exists():
            try:
                m = json.loads(mf.read_text())
            except Exception:
                continue
            runs.append({"run_id": m.get("run_id", p.name),
                         "as_of": m.get("as_of"),
                         "tickers": m.get("tickers"),
                         "analyzed": m.get("analyzed"),
                         "errors": m.get("errors"),
                         "run_sha256": m.get("run_sha256")})
    return {"runs": runs}


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> Dict[str, Any]:
    base = Path(RUNS_DIR) / run_id
    mf = base / "manifest.json"
    if not mf.exists():
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    manifest = json.loads(mf.read_text())
    ranking: List[Dict[str, Any]] = []
    rk = base / "ranking.csv"
    if rk.exists():
        import csv
        with rk.open() as f:
            ranking = list(csv.DictReader(f))
    return {"manifest": manifest, "ranking": ranking}


@router.get("/runs/{run_id}/stocks/{ticker}")
def get_run_stock(run_id: str, ticker: str) -> Dict[str, Any]:
    p = Path(RUNS_DIR) / run_id / "stocks" / f"{ticker}.json"
    if not p.exists():
        raise HTTPException(status_code=404,
                            detail=f"{ticker} not in run {run_id}")
    return json.loads(p.read_text())
