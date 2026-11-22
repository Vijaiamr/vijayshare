"""Validator prompt tests — the agent prompt carries prediction + actual outcome."""

from __future__ import annotations

from aiops.opencode.agent import build_validation_prompt


def test_build_validation_prompt_contains_prediction_and_outcome():
    prompt = build_validation_prompt(
        symbol="TEST.NS",
        run_date="2026-01-05",
        prediction={
            "direction": "up",
            "confidence": 0.65,
            "target_pct": 1.5,
            "stop_pct": -1.0,
            "rationale": "trend_up pattern",
            "pattern": "trend_up",
        },
        actual_open=101.0,
        actual_close=103.0,
        actual_direction="up",
        hit=True,
        features_summary=None,
    )
    assert "TEST.NS" in prompt
    assert "2026-01-05" in prompt
    assert "up" in prompt
    assert "0.65" in prompt
    assert "1.5" in prompt
    assert "103.0" in prompt
    assert "hit" in prompt.lower()


def test_build_validation_prompt_contract_mentioned():
    prompt = build_validation_prompt(
        symbol="TEST.NS",
        run_date="2026-01-05",
        prediction={"direction": "flat", "confidence": 0.5},
        actual_open=100.0,
        actual_close=99.0,
        actual_direction="down",
        hit=False,
    )
    # The agent must be told to answer with the validate tool contract.
    assert "validate" in prompt
    assert "knowledge_proposal" in prompt


def test_build_validation_prompt_no_features_summary():
    """features_summary=None must not fabricate data in the prompt."""
    prompt = build_validation_prompt(
        symbol="TEST.NS",
        run_date="2026-01-05",
        prediction={"direction": "up", "confidence": 0.6},
        actual_open=100.0,
        actual_close=102.0,
        actual_direction="up",
        hit=True,
        features_summary=None,
    )
    assert "features" not in prompt.lower() or "no feature" in prompt.lower()