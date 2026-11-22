"""Unit tests for the weighted convolution signal model (2026-09-05).

Covers:
- _pattern_votes: neutral no-pattern case must NOT veto; bull/bear weighting.
- _technical_convolution: score mapping (50 + total/2, clamped 0-100),
  component weights, pattern majority propagation.
- _fundamental_convolution: AND-floor cap (any weak factor caps the score,
  cap not veto), factor weighting.
- _compute_quantamental: 50/50 narrow band [0.45, 0.55] blend uses the
  convolution scores.
"""
import sys
import os
from pathlib import Path

import pytest

# The analysis engine lives in the git repo engine/ dir (3 levels up from
# backend/tests/). The backend normally imports the PRODUCTION copy from the
# share root; tests target the git copy so changes are validated pre-sync.
_ENGINE_DIR = Path(__file__).resolve().parents[2] / "engine"
sys.path.insert(0, str(_ENGINE_DIR))

from technical_analysis_report import TechnicalAnalysisPipeline  # noqa: E402


@pytest.fixture
def pipeline():
    p = TechnicalAnalysisPipeline(
        "TEST.NS", period="1y", do_options=False, do_wyckoff=True,
        do_gann=True, do_sentiment=False, do_db=False, do_fundamentals=False,
    )
    return p


class _StubResult:
    """Minimal result stub so _pattern_votes can run without a full run()."""

    def __init__(self, df=None):
        self.df = df


# ── _pattern_votes ────────────────────────────────────────────────────────

def test_pattern_votes_no_patterns_is_neutral_not_veto(pipeline):
    """No patterns → majority True, veto False (neutral, never blocks a BUY)."""
    pipeline.result = _StubResult(df=None)
    pv = pipeline._pattern_votes({})
    assert pv["majority"] is True
    assert pv["veto"] is False
    assert pv["bull_weight"] == 0.0
    assert pv["bear_weight"] == 0.0


def test_pattern_votes_engine_unavailable_is_neutral(pipeline, monkeypatch):
    """If the pattern engine cannot be imported, the vote is neutral."""
    pipeline.result = _StubResult(df=None)
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "pattern_engine":
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    pv = pipeline._pattern_votes({})
    assert pv["majority"] is True
    assert pv["veto"] is False
    assert pv["available"] is False


# ── _technical_convolution ────────────────────────────────────────────────

def test_technical_convolution_score_mapping(pipeline):
    """score = clamp(50 + raw_total/2, 0, 100)."""
    a = {
        "structure": {"structure": "Uptrend"},
        "ma": {"above_50": True, "above_200": True},
        "rsi": {"value": 55},
        "macd": {"crossover": "Bullish"},
        "adx": {"adx": 30, "di_bias": "Bullish"},
        "volume": {"status": "Above Avg", "up_down_ratio_10d": 1.8},
        "obv_raw": {"obv_trend": "Bullish"},
        "candlestick": {"last_pattern": "Hammer"},
        "divergence": [{"type": "Regular Bullish"}],
        "wyckoff": {"wyckoff_phase": {"phase": "Markup"}},
        "atr": {"percent_of_price": 0.5},
    }
    pipeline.result = _StubResult(df=None)  # no patterns → neutral
    conv = pipeline._technical_convolution(a, 100.0)
    assert 0 <= conv["score"] <= 100
    assert conv["score"] == round(50 + conv["raw_total"] / 2, 1)
    # All 7 components present with the documented weights.
    expected_weights = {
        "pattern": 30, "trend": 15, "momentum": 15, "volume": 15,
        "candlestick": 10, "oscillator": 10, "wyckoff": 5,
    }
    assert set(conv["components"]) == set(expected_weights)
    for k, w in expected_weights.items():
        assert conv["components"][k]["weight"] == w
    # Strong bullish setup should score well above neutral.
    assert conv["score"] > 65


def test_technical_convolution_bearish_scores_low(pipeline):
    """A bearish setup must score below the BUY floor."""
    a = {
        "structure": {"structure": "Downtrend"},
        "ma": {"above_50": False, "above_200": False},
        "rsi": {"value": 75},
        "macd": {"crossover": "Bearish"},
        "adx": {"adx": 30, "di_bias": "Bearish"},
        "volume": {"status": "Below Avg", "up_down_ratio_10d": 0.4},
        "obv_raw": {"obv_trend": "Bearish"},
        "candlestick": {"last_pattern": "Shooting Star"},
        "divergence": [{"type": "Regular Bearish"}],
        "wyckoff": {"wyckoff_phase": {"phase": "Markdown"}},
        "atr": {"percent_of_price": 0.5},
    }
    pipeline.result = _StubResult(df=None)
    conv = pipeline._technical_convolution(a, 100.0)
    assert conv["score"] < 50
    assert conv["score"] < 65  # below TECH_BUY_MIN


def test_technical_convolution_pattern_majority_propagates(pipeline):
    """pattern_majority in the result mirrors the pattern vote."""
    a = {"atr": {"percent_of_price": 0.5}}
    pipeline.result = _StubResult(df=None)
    conv = pipeline._technical_convolution(a, 100.0)
    assert conv["pattern_majority"] is True  # neutral no-pattern case


# ── _fundamental_convolution ──────────────────────────────────────────────

def test_fundamental_convolution_all_good_no_cap(pipeline):
    """All factors strong → no cap, score reflects weighted factors."""
    fund = {
        "quick_ratings": {"analyst_rating": "strong_buy"},
        "section_08_ratios": {
            "roe": 22.0, "profit_margin": 15.0,
            "debt_to_equity": 0.3, "dividend_yield": 2.5,
        },
        "section_09_growth": {"revenue_cagr_2yr": 18.0, "net_income_cagr_2yr": 22.0},
        "section_12_valuation": {
            "pe_ttm": 12.0, "pb": 2.0, "peg_ratio": 0.8,
            "current_price": 90.0, "high_52w": 100.0, "low_52w": 40.0,
        },
        "section_15_risk": {"risk_rating": "Low"},
    }
    conv = pipeline._fundamental_convolution(fund)
    assert conv["cap_applied"] is False
    assert conv["score"] > 60
    assert set(conv["factors"]) == {
        "value", "growth", "profitability", "risk", "momentum", "analyst", "dividend",
    }


def test_fundamental_convolution_weak_factor_caps_not_vetoes(pipeline):
    """One weak factor triggers the AND-floor cap (score ≤ FUND_CAP=65)."""
    fund = {
        "quick_ratings": {"analyst_rating": "strong_buy"},
        "section_08_ratios": {
            "roe": 22.0, "profit_margin": 15.0,
            "debt_to_equity": 3.5, "dividend_yield": 2.5,  # weak risk
        },
        "section_09_growth": {"revenue_cagr_2yr": 18.0, "net_income_cagr_2yr": 22.0},
        "section_12_valuation": {
            "pe_ttm": 12.0, "pb": 2.0, "peg_ratio": 0.8,
            "current_price": 90.0, "high_52w": 100.0, "low_52w": 40.0,
        },
        "section_15_risk": {"risk_rating": "High"},  # weak risk → cap fires
    }
    conv = pipeline._fundamental_convolution(fund)
    assert conv["cap_applied"] is True
    assert conv["cap_reason"] is not None
    assert conv["score"] <= 65  # capped, not vetoed


def test_fundamental_convolution_empty_is_neutral(pipeline):
    """No fundamental data → neutral 50, no cap."""
    conv = pipeline._fundamental_convolution({})
    assert conv["score"] == 50.0
    assert conv["cap_applied"] is False


# ── _compute_quantamental 50/50 narrow band ───────────────────────────────

def test_quantamental_uses_convolution_scores_and_narrow_band(pipeline):
    """Blend = tech_conv × w + fund_conv × (1-w) with w in [0.45, 0.55]."""
    class R:
        confidence = 70.0
        signal = "BUY"
        conv_technical = {"score": 72.0}
        conv_fundamental = {"score": 58.0}

    result = R()
    analysis = {
        "fundamentals": {
            "quick_ratings": {"screening_rating": "Buy"},
        },
    }
    qm = pipeline._compute_quantamental(analysis, result, sentiment=None)
    w = qm["weights"]["technical"]
    assert 0.45 <= w <= 0.55
    assert qm["weights"]["fundamental"] == round(1 - w, 3)
    expected = round(72.0 * w + 58.0 * (1 - w), 1)
    assert qm["technical_score"] == 72.0
    assert qm["fundamental_score"] == 58.0
    assert qm["blended_score"] == expected


def test_quantamental_band_clamps_large_cap_weights(pipeline):
    """Large-cap raw weights (0.40/0.60) clamp into the [0.45, 0.55] band."""
    class R:
        confidence = 70.0
        signal = "BUY"
        conv_technical = {"score": 70.0}
        conv_fundamental = {"score": 60.0}

    result = R()
    analysis = {"fundamentals": {"quick_ratings": {}}}
    pipeline._yf_info = {"marketCap": 600e9}  # large cap
    qm = pipeline._compute_quantamental(analysis, result, sentiment=None)
    w = qm["weights"]["technical"]
    assert 0.45 <= w <= 0.55
    assert qm["market_cap_category"] == "large"