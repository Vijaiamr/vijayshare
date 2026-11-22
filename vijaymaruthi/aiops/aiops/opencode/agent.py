"""Prompt builders — fully-serialized, auditable prompts for the LLM.

The prompts embed the output contract from the ``aiops-llm`` agent file:
a single JSON object with ``tool`` = ``predict`` or ``propose_lesson``.
The LLM never computes numbers — it proposes direction/confidence/rationale.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

_OUTPUT_CONTRACT_PREDICT = """\
## Output contract
Respond with a single JSON object:
{"tool": "predict", "args": {"direction": "up|down|flat", "confidence": 0.0, "target_pct": 0.0, "stop_pct": 0.0, "rationale": "concise reasoning"}}

Rules:
- You NEVER compute prices, percentages, or statistics. You propose direction,
  confidence, and qualitative rationale. Python computes and validates all numbers.
- Confidence must be a number between 0 and 1 reflecting genuine uncertainty.
- target_pct and stop_pct are proposed risk parameters in percent (|value| <= 10).
- If the data is insufficient or ambiguous, return
  {"tool": "predict", "args": {"direction": "flat", "confidence": 0.0,
  "target_pct": 0.0, "stop_pct": 0.0, "rationale": "INSUFFICIENT_DATA"}}.
- Never reference future data. You only see data available as of the stated
  as-of timestamp.
- Be concise. No markdown outside the JSON."""

_OUTPUT_CONTRACT_LESSON = """\
## Output contract
Respond with a single JSON object:
{"tool": "propose_lesson", "args": {"title": "short title", "body": "testable observation with conditions"}}

Rules:
- The lesson must be a testable, conditional observation (if X then Y).
- Be concise. No markdown outside the JSON."""

_OUTPUT_CONTRACT_VALIDATE = """\
## Output contract
Respond with a single JSON object:
{"tool": "validate", "args": {"assessment": "concise qualitative assessment", "pattern_quality": "high|medium|low", "knowledge_proposal": {"kind": "positive|negative|none", "content": "testable pattern statement or empty string"}}}

Rules:
- You NEVER compute prices, percentages, or statistics. Python supplies the
  actual outcome (hit/miss, actual direction, error). You only assess the
  *logic* of the prediction given that outcome.
- A miss is not automatically bad logic; a hit is not automatically good
  logic. Assess whether the prediction logic was sound given the outcome.
- Propose knowledge ONLY when there is a clear, testable pattern worth
  remembering (positive: the pattern worked; negative: the pattern failed;
  none: no clear pattern — use empty content).
- Be concise. No markdown outside the JSON."""


def _fmt_knowledge(knowledge_context: list[dict[str, Any]]) -> str:
    if not knowledge_context:
        return "(none)"
    lines = []
    for item in knowledge_context:
        lines.append(f"- [{item['kind']} v{item['version']}] {item['content']}")
    return "\n".join(lines)


def _fmt_stats(recent_stats: dict[str, Any]) -> str:
    if not recent_stats or not recent_stats.get("n"):
        return "no recent validated predictions"
    return (
        f"{recent_stats['n']} recent validated predictions, "
        f"hit rate {recent_stats['hit_rate']:.0%}"
    )


def build_prediction_prompt(
    symbol: str,
    run_date: date,
    as_of: datetime,
    features: dict[str, Any],
    knowledge_context: list[dict[str, Any]],
    recent_stats: dict[str, Any],
) -> str:
    """Build the fully-serialized prediction prompt for the LLM."""
    as_of_str = as_of.isoformat() if hasattr(as_of, "isoformat") else str(as_of)
    closes = ", ".join(f"{c:.2f}" for c in features.get("recent_closes", []))
    return f"""\
You are the AIOps reasoning engine for the VijayMaruthi Auto Pilot learning
platform. You analyze NSE daily market data and produce a prediction. You have
NO tools and NO file access — you reason only from the context below.

## Task
Predict the next trading day's direction for {symbol} for run date {run_date}.

## Information boundary
You may ONLY use data available as of {as_of_str} (IST). Never reference data
after this timestamp.

## Market data (as of {as_of_str})
- Last close: {features.get('last_close')}
- Last 10 closes: {closes}
- Regime: {features.get('regime')}
- Indicators: SMA20={features.get('sma20')}, SMA50={features.get('sma50')},
  RSI14={features.get('rsi14')}, MACD={features.get('macd')},
  MACD signal={features.get('macd_signal')}, ADX={features.get('adx')},
  ATR%={features.get('atr_pct')}, Bollinger upper={features.get('bollinger_upper')},
  Bollinger mid={features.get('bollinger_mid')},
  Bollinger lower={features.get('bollinger_lower')}
- Recent returns (%): 1d={features.get('return_1d')}, 5d={features.get('return_5d')},
  10d={features.get('return_10d')}, 20d={features.get('return_20d')}

## Knowledge context
{_fmt_knowledge(knowledge_context)}

## Recent validation stats
{_fmt_stats(recent_stats)}

{_OUTPUT_CONTRACT_PREDICT}
"""


def build_lesson_prompt(
    symbol: str,
    run_date: date,
    prediction: dict[str, Any],
    validation_row: dict[str, Any],
    features_summary: dict[str, Any] | None = None,
) -> str:
    """Build the fully-serialized lesson-proposal prompt for the LLM."""
    features_summary = features_summary or {}
    return f"""\
You are the AIOps reasoning engine for the VijayMaruthi Auto Pilot learning
platform. You propose testable lessons from validated prediction outcomes.
You have NO tools and NO file access — you reason only from the context below.

## Context
- Symbol: {symbol}
- Run date: {run_date}
- Prediction: direction={prediction.get('direction')},
  confidence={prediction.get('confidence')},
  target={prediction.get('target_price')}, stop={prediction.get('stop_price')}
- Rationale: {prediction.get('rationale')}
- Actual: open={validation_row.get('actual_open')},
  close={validation_row.get('actual_close')},
  direction={validation_row.get('actual_direction')},
  error_pct={validation_row.get('error_pct')}
- Hit: {bool(validation_row.get('hit'))}
- Regime: {features_summary.get('regime', 'unknown')}

{_OUTPUT_CONTRACT_LESSON}
"""


def build_validation_prompt(
    symbol: str,
    run_date: date,
    prediction: dict[str, Any],
    actual_open: float,
    actual_close: float,
    actual_direction: str,
    hit: bool,
    features_summary: dict[str, Any] | None = None,
) -> str:
    """Build the fully-serialized validation prompt for the validator agent.

    The prediction, the Python-computed actual outcome, and a feature summary
    are embedded so the validator can assess whether the prediction *logic*
    was sound given the outcome. The validator never computes numbers.
    """
    features_summary = features_summary or {}
    return f"""\
You are the AIOps validator for the VijayMaruthi Auto Pilot learning platform.
You assess whether a prediction's logic was sound given the actual outcome.
You have NO tools and NO file access — you reason only from the context below.

## Context
- Symbol: {symbol}
- Run date: {run_date}
- Prediction: direction={prediction.get('direction')},
  confidence={prediction.get('confidence')},
  target_pct={prediction.get('target_pct')}, stop_pct={prediction.get('stop_pct')},
  target_price={prediction.get('target_price')}, stop_price={prediction.get('stop_price')}
- Pattern: {prediction.get('pattern', 'none')}
- Rationale: {prediction.get('rationale')}
- Actual (computed by Python): open={actual_open}, close={actual_close},
  direction={actual_direction}
- Hit: {hit}
- Feature summary: regime={features_summary.get('regime', 'unknown')},
  last_close={features_summary.get('last_close')},
  sma20={features_summary.get('sma20')}, sma50={features_summary.get('sma50')},
  rsi14={features_summary.get('rsi14')}, adx={features_summary.get('adx')}

{_OUTPUT_CONTRACT_VALIDATE}
"""