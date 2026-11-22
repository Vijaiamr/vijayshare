"""Parity tests: the new ``rules`` package must reproduce the legacy engine.

Runs the real pipeline over every deterministic fixture case and asserts the
rule functions return exactly what the legacy methods do, on identical inputs.
This lets us rewire the pipeline onto ``rules`` knowing behaviour is unchanged.

Run:
    cd vijaymaruthi/backend && python -m pytest tests/test_rules_parity.py -v
"""
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from fixtures.golden_cases import CASES  # noqa: E402
from fixtures.snapshot import run_pipeline  # noqa: E402
import pattern_engine as pe  # noqa: E402
from rules.core import MarketFeatures  # noqa: E402
from rules import fundamental, gates, pattern_gates, quantamental, technical  # noqa: E402

_CASE_NAMES = [c["name"] for c in CASES]


def _patterns(df):
    candles = [
        pe.Candle(time=str(i.date()), open=float(r["Open"]), high=float(r["High"]),
                  low=float(r["Low"]), close=float(r["Close"]),
                  volume=float(r.get("Volume", 0) or 0))
        for i, r in df.tail(120).iterrows()
    ]
    sh, sl = pe.find_swing_points(candles)
    return pe.detect_patterns(candles, sh, sl)


def _features(case):
    pipeline, result, df = run_pipeline(case)
    a = pipeline.analysis
    price = float(df["Close"].iloc[-1])
    legacy_pv = pipeline._pattern_votes(a)
    feats = MarketFeatures(
        analysis=a, price=price, pattern_votes=legacy_pv,
        ticker=case["ticker"], yf_info=getattr(pipeline, "_yf_info", {}) or {},
    )
    return pipeline, a, price, df, legacy_pv, feats


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_pattern_votes_parity(name):
    case = next(c for c in CASES if c["name"] == name)
    pipeline, a, price, df, legacy_pv, _ = _features(case)
    new_pv = pattern_gates.pattern_votes(_patterns(df), a.get("atr", {}).get("percent_of_price"))
    assert new_pv == legacy_pv


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_classify_signal_parity(name):
    case = next(c for c in CASES if c["name"] == name)
    pipeline, a, price, df, legacy_pv, feats = _features(case)
    assert technical.classify_signal(feats) == pipeline._classify_signal(a, price)


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_technical_convolution_parity(name):
    case = next(c for c in CASES if c["name"] == name)
    pipeline, a, price, df, legacy_pv, feats = _features(case)
    assert technical.technical_convolution(feats) == pipeline._technical_convolution(a, price)


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_fundamental_convolution_parity(name):
    case = next(c for c in CASES if c["name"] == name)
    pipeline, a, price, df, legacy_pv, feats = _features(case)
    fund = a.get("fundamentals", {}) or {}
    assert fundamental.fundamental_convolution(fund) == pipeline._fundamental_convolution(fund)


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_quality_gates_parity(name):
    case = next(c for c in CASES if c["name"] == name)
    pipeline, a, price, df, legacy_pv, feats = _features(case)
    sig = getattr(pipeline.result, "pre_gate_signal", None) or pipeline.result.signal
    conf = pipeline.result.confidence
    legacy = pipeline._apply_quality_gates(sig, conf, a, price)
    new = gates.apply_quality_gates(
        sig, conf, a, price, ticker=case["ticker"],
        yf_info=getattr(pipeline, "_yf_info", {}) or {}, n_rows=len(pipeline.result.df))
    assert new == legacy


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_compute_quantamental_parity(name):
    case = next(c for c in CASES if c["name"] == name)
    pipeline, a, price, df, legacy_pv, feats = _features(case)
    legacy = pipeline._compute_quantamental(a, pipeline.result, sentiment=None)
    new = quantamental.compute_quantamental(
        a, pipeline.result.confidence, pipeline.result.signal,
        getattr(pipeline.result, "conv_technical", {}) or {},
        getattr(pipeline.result, "conv_fundamental", {}) or {},
        ticker=case["ticker"], yf_info=getattr(pipeline, "_yf_info", {}) or {},
        sentiment=None)
    assert new == legacy

