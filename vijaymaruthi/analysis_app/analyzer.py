"""Analyzer orchestrator: pinned universe -> deterministic per-stock analysis.

For each ticker it runs the (unchanged) analysis pipeline in deterministic mode
— pinned OHLCV via ``df_override``, pinned fundamentals via an injected
analyzer, a frozen clock — then layers the composite state machine on top and
assembles a canonical :class:`StockAnalysis` record.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import state_machine as sm
from .datasource import PinnedDataSource
from .determinism import Clock, canonical_json, derive_run_id, sha256_obj, sha256_text

# ── locate the canonical engine (sibling of analysis_app/) ──
_APP_DIR = Path(__file__).resolve().parent
_ENGINE_DIR = _APP_DIR.parent / "engine"
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))


@dataclass(frozen=True)
class AnalyzeConfig:
    period: str = "3y"
    min_rows: int = 60
    include_timeline: bool = False
    do_wyckoff: bool = True
    do_gann: bool = True

    def as_dict(self) -> Dict[str, Any]:
        return {
            "period": self.period,
            "min_rows": self.min_rows,
            "include_timeline": self.include_timeline,
            "do_wyckoff": self.do_wyckoff,
            "do_gann": self.do_gann,
        }


@dataclass
class StockAnalysis:
    ticker: str
    as_of: str
    price: Optional[float] = None
    signal: str = ""
    confidence: float = 0.0
    technical_signal: str = ""
    conv_technical: Dict[str, Any] = field(default_factory=dict)
    conv_fundamental: Dict[str, Any] = field(default_factory=dict)
    quantamental: Dict[str, Any] = field(default_factory=dict)
    quality_gates: List[str] = field(default_factory=list)
    state: Dict[str, Any] = field(default_factory=dict)
    timeline: List[Dict[str, Any]] = field(default_factory=list)
    rule_trace: Dict[str, Any] = field(default_factory=dict)
    error: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "ticker": self.ticker,
            "as_of": self.as_of,
            "price": self.price,
            "signal": self.signal,
            "confidence": self.confidence,
            "technical_signal": self.technical_signal,
            "conv_technical": self.conv_technical,
            "conv_fundamental": self.conv_fundamental,
            "quantamental": self.quantamental,
            "quality_gates": self.quality_gates,
            "state": self.state,
            "timeline": self.timeline,
            "rule_trace": self.rule_trace,
            "error": self.error,
        }


def make_pinned_analyzer(ds: PinnedDataSource):
    """Build a FundamentalAnalyzer-compatible class backed by the snapshot."""

    class _PinnedFundamentalAnalyzer:
        def __init__(self, ticker: str, manual_overrides: Optional[dict] = None,
                     now=None):
            self.ticker = ticker
            self.manual_overrides = manual_overrides or {}
            self.info = ds.info(ticker)
            self._fund = ds.fundamentals(ticker)

        def collect(self) -> dict:
            return self._fund

    return _PinnedFundamentalAnalyzer


def analyze_ticker(ds: PinnedDataSource, ticker: str, clock: Clock,
                   config: AnalyzeConfig) -> StockAnalysis:
    """Run the deterministic pipeline + state machine for one ticker."""
    import technical_analysis_report as tar

    df = ds.ohlcv(ticker)
    if df is None or len(df) < config.min_rows:
        return StockAnalysis(ticker=ticker, as_of=clock.date_str,
                             error=f"insufficient data ({0 if df is None else len(df)} rows)")

    pipeline = tar.TechnicalAnalysisPipeline(
        ticker=ticker,
        period=config.period,
        do_options=False,
        do_wyckoff=config.do_wyckoff,
        do_gann=config.do_gann,
        do_sentiment=False,
        do_db=False,
        manual_overrides={},
        df_override=df,
        do_fundamentals=True,
        now=clock.now(),
        fundamental_analyzer_cls=make_pinned_analyzer(ds),
    )
    result = pipeline.run()
    analysis = getattr(pipeline, "analysis", {}) or {}

    conv_tech = getattr(result, "conv_technical", {}) or {}
    pattern_votes = conv_tech.get("pattern_votes", {}) or {}
    gates = list(getattr(result, "quality_gates", []) or [])

    state = sm.analyze_state(df, pattern_votes, gates)
    timeline: List[Dict[str, Any]] = []
    if config.include_timeline:
        pat = sm.top_pattern(pattern_votes)
        timeline = [t.as_dict() for t in sm.position_timeline(df, pat)]

    price = None
    try:
        price = float(df["Close"].iloc[-1])
    except Exception:
        price = None

    return StockAnalysis(
        ticker=ticker,
        as_of=clock.date_str,
        price=price,
        signal=str(getattr(result, "signal", "") or ""),
        confidence=float(getattr(result, "confidence", 0.0) or 0.0),
        technical_signal=str(getattr(result, "technical_signal", "") or ""),
        conv_technical=conv_tech,
        conv_fundamental=getattr(result, "conv_fundamental", {}) or {},
        quantamental=getattr(result, "quantamental", {}) or {},
        quality_gates=gates,
        state=state.as_dict(),
        timeline=timeline,
        rule_trace=analysis.get("rule_trace", {}) or {},
        error=str(getattr(result, "error", "") or ""),
    )


def analyze_universe(ds: PinnedDataSource, clock: Clock, config: AnalyzeConfig,
                     limit: Optional[int] = None,
                     log: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    """Analyze the pinned universe. Returns ``{run_id, manifest, results}``."""
    universe = ds.universe()
    if limit:
        universe = universe[:limit]

    results: List[StockAnalysis] = []
    for i, ticker in enumerate(universe):
        try:
            results.append(analyze_ticker(ds, ticker, clock, config))
        except Exception as e:  # never let one ticker abort the run
            results.append(StockAnalysis(ticker=ticker, as_of=clock.date_str,
                                         error=f"{type(e).__name__}: {e}"))
        if log and (i + 1) % 25 == 0:
            log(f"  ...{i + 1}/{len(universe)} analyzed")

    results.sort(key=lambda r: r.ticker)

    config_sha = sha256_text(canonical_json(config.as_dict()))
    universe_sha = ds.universe_sha()
    # The run identity must reflect the *effective* universe actually analyzed
    # (i.e. after ``--limit``), otherwise a limited run and a full run collide on
    # the same run_id despite producing different artifacts. For a full run the
    # effective universe equals the snapshot universe, so the id is unchanged.
    effective_universe_sha = sha256_text(canonical_json(universe))
    snapshot_sha = ds.snapshot_sha()
    run_id = derive_run_id(effective_universe_sha, snapshot_sha, config_sha,
                           clock.date_str)

    outputs_sha = sha256_obj([r.as_dict() for r in results])
    errors = sum(1 for r in results if r.error)

    manifest = {
        "run_id": run_id,
        "as_of": clock.date_str,
        "snapshot_sha": snapshot_sha,
        "universe_sha": universe_sha,
        "effective_universe_sha": effective_universe_sha,
        "config_sha": config_sha,
        "config": config.as_dict(),
        "tickers": len(universe),
        "analyzed": len(results) - errors,
        "errors": errors,
        "outputs_sha": outputs_sha,
    }
    return {"run_id": run_id, "manifest": manifest, "results": results}
