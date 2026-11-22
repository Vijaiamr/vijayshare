"""Shared golden-master snapshot logic (offline, deterministic).

Used by both ``backend/scripts/snapshot_golden.py`` (to (re)generate the
committed golden files) and ``backend/tests/test_rule_engine_golden.py`` (to
assert the engine still reproduces them exactly after the rule-engine
refactor).

The snapshot runs the REAL ``TechnicalAnalysisPipeline`` on injected fixtures,
replacing only ``FundamentalAnalyzer`` with a stub that returns canned
fundamentals, so no network call is made and the output is reproducible.
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd

# ── Path setup: import the git-canonical engine modules ──
_HERE = Path(__file__).resolve()
_TESTS_DIR = _HERE.parents[1]              # backend/tests
_BACKEND_DIR = _HERE.parents[2]            # backend
_ENGINE_DIR = _BACKEND_DIR.parent / "engine"          # vijaymaruthi/engine
_PATTERN_DIR = _BACKEND_DIR / "engine"                # vijaymaruthi/backend/engine
for _p in (str(_ENGINE_DIR), str(_PATTERN_DIR), str(_TESTS_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from fixtures.golden_cases import CASES, build_fundamentals, build_ohlcv, load_csv  # noqa: E402
import technical_analysis_report as tar  # noqa: E402
import pattern_engine as pe  # noqa: E402

GOLDEN_DIR = _TESTS_DIR / "golden"


def _clean(obj: Any) -> Any:
    """Recursively convert numpy scalars/arrays to JSON-native types."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def _ohlcv_sha(df: pd.DataFrame) -> str:
    payload = df.to_csv(float_format="%.10f").encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _pattern_snapshot(df: pd.DataFrame) -> List[dict]:
    """Detect patterns on the same last-120-bar window the engine uses."""
    candles = [
        pe.Candle(
            time=str(idx.date()),
            open=float(row["Open"]), high=float(row["High"]),
            low=float(row["Low"]), close=float(row["Close"]),
            volume=float(row.get("Volume", 0) or 0),
        )
        for idx, row in df.tail(120).iterrows()
    ]
    swing_highs, swing_lows = pe.find_swing_points(candles)
    pats = pe.detect_patterns(candles, swing_highs, swing_lows)
    out = []
    for p in pats:
        out.append({
            "type": p.type,
            "direction": p.direction,
            "confidence": int(getattr(p, "confidence", 0) or 0),
            "risk_reward": getattr(p, "risk_reward", None),
            "start_idx": getattr(p, "start_idx", None),
            "end_idx": getattr(p, "end_idx", None),
            "status": getattr(p, "status", None),
            "entry": getattr(p, "entry", None),
            "stop_loss": getattr(p, "stop_loss", None),
            "target": getattr(p, "target", None),
            "timeframe": getattr(p, "timeframe", None),
        })
    # Order by type so dict/list ordering can never affect equality.
    return sorted(out, key=lambda d: (d["type"], str(d.get("start_idx"))))


class _StubFundamentalAnalyzer:
    """Stand-in for FundamentalAnalyzer — returns canned data, no network."""

    def __init__(self, ticker: str, manual_overrides: dict | None = None, _fund=None, _info=None):
        self.ticker = ticker
        self.info = _info or {}
        self._fund = _fund or {}

    def collect(self) -> dict:
        return self._fund


def run_pipeline(case: dict):
    """Run one fixture case and return ``(pipeline, result, df)``.

    Exposes the live pipeline object so parity tests can call both the legacy
    methods and the new ``rules`` functions on identical inputs.
    """
    df = load_csv(case["csv"]) if "csv" in case else build_ohlcv(case["ohlcv"])
    fund = build_fundamentals(case["fund"])
    info = case.get("info", {})

    real_fa = tar.FundamentalAnalyzer

    def _factory(ticker, manual_overrides=None):
        return _StubFundamentalAnalyzer(ticker, manual_overrides, _fund=fund, _info=info)

    tar.FundamentalAnalyzer = _factory  # type: ignore[assignment]
    try:
        pipeline = tar.TechnicalAnalysisPipeline(
            ticker=case["ticker"], period="1y", do_options=False,
            do_wyckoff=True, do_gann=True, do_sentiment=False, do_db=False,
            manual_overrides={}, df_override=df, do_fundamentals=True,
        )
        result = pipeline.run()
    finally:
        tar.FundamentalAnalyzer = real_fa  # type: ignore[assignment]
    return pipeline, result, df


def run_case(case: dict) -> dict:
    """Run one fixture case through the real pipeline and return its snapshot."""
    pipeline, result, df = run_pipeline(case)

    snapshot = {
        "case": case["name"],
        "ticker": case["ticker"],
        "ohlcv_sha": _ohlcv_sha(df),
        "signal": result.signal,
        "confidence": result.confidence,
        "pre_gate_signal": getattr(result, "pre_gate_signal", None),
        "technical_signal": getattr(result, "technical_signal", None),
        "entry_zone": list(getattr(result, "entry_zone", ()) or ()),
        "targets": list(getattr(result, "targets", []) or []),
        "invalidation": getattr(result, "invalidation", None),
        "conv_technical": getattr(result, "conv_technical", {}),
        "conv_fundamental": getattr(result, "conv_fundamental", {}),
        "quantamental": getattr(result, "quantamental", {}),
        "quality_gates": getattr(result, "quality_gates", []),
        "patterns": _pattern_snapshot(df),
    }
    return _clean(snapshot)


def snapshot_all() -> Dict[str, dict]:
    """Return {case_name: snapshot} for every fixture case."""
    out: Dict[str, dict] = {}
    for case in CASES:
        out[case["name"]] = run_case(case)
    return out


def golden_path(name: str) -> Path:
    return GOLDEN_DIR / f"{name}.json"
