"""Prediction engine — LLM or baseline, always validated by Python.

Python computes all numbers; the LLM proposes direction/confidence/rationale.
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import date
from typing import Any

from ..clock import predict_at
from ..learning.knowledge import knowledge_context, negative_patterns
from ..opencode.agent import build_prediction_prompt
from ..opencode.parser import ParseError, parse_llm_json
from ..prediction.store import get_prediction, insert_prediction, record_agent_run

VALID_DIRECTIONS = {"up", "down", "flat"}
MAX_PCT = 10.0


def _insufficient() -> dict[str, Any]:
    """Canonical INSUFFICIENT_DATA result."""
    return {
        "direction": "flat",
        "confidence": 0.0,
        "target_pct": 0.0,
        "stop_pct": 0.0,
        "rationale": "INSUFFICIENT_DATA",
    }


def _validate(parsed: dict | None, features: dict) -> dict[str, Any]:
    """Validate LLM output. Returns _insufficient() on any validation failure."""
    if not isinstance(parsed, dict):
        return _insufficient()

    tool = parsed.get("tool")
    if tool != "predict":
        return _insufficient()

    args = parsed.get("args")
    if not isinstance(args, dict):
        return _insufficient()

    direction = str(args.get("direction", "")).strip().lower()
    if direction not in VALID_DIRECTIONS:
        return _insufficient()

    try:
        confidence = float(args.get("confidence"))
    except (TypeError, ValueError):
        return _insufficient()
    if not (0.0 <= confidence <= 1.0):
        return _insufficient()

    try:
        target_pct = float(args.get("target_pct"))
        stop_pct = float(args.get("stop_pct"))
    except (TypeError, ValueError):
        return _insufficient()
    if abs(target_pct) > MAX_PCT or abs(stop_pct) > MAX_PCT:
        return _insufficient()

    rationale = str(args.get("rationale", "")).strip()
    if not rationale:
        return _insufficient()

    return {
        "direction": direction,
        "confidence": confidence,
        "target_pct": target_pct,
        "stop_pct": stop_pct,
        "rationale": rationale,
    }


def _baseline(features: dict) -> dict[str, Any]:
    """Deterministic pattern-gated baseline — NO FORCE-FIT (v2).

    Returns EITHER a valid prediction dict (direction/confidence/target_pct/
    stop_pct/rationale + a ``pattern`` key) OR ``{"pattern": "none"}`` meaning
    "no clear pattern — SKIP, do not predict".

    v2 changes (from institutional analyst cross-checks of the 2000-2009
    backtests):
    - **Regime gate**: trend patterns are BLOCKED in ``high_volatility``
      regime — the engine's own regime classifier states momentum signals are
      unreliable there (measured 42.5% hit rate vs 47.6%+ elsewhere).
    - **Pullback-continuation trends**: ``trend_up``/``trend_down`` now
      require the close to be NEAR sma20 (within 2%) and RSI in the
      non-extended zone (50-62 up / 38-50 down) — buying/selling strength
      into extension was the anti-predictive failure mode (trend_up 46.5%,
      z=-4.08).
    - **Confidence recalibration**: confidence is capped at 0.70 and no
      longer rewards price extension (the old formula's highest-confidence
      bucket was its worst-calibrated).

    Patterns are checked in priority order (first match wins). Feature keys
    used: ``last_close``, ``sma20``, ``sma50``, ``rsi14``, ``adx``,
    ``bollinger_lower``/``bollinger_upper``, ``volume_sma20`` (vol_sma20),
    ``last_volume``, ``high_20``, ``low_20``, ``regime``.

    1. ``trend_up``: close > sma20 > sma50 AND adx >= 20 AND 50 <= rsi14 <= 62
       AND close within 2% of sma20 (pullback) AND regime != high_volatility
       → up; confidence = min(0.70, 0.5 + (adx-20)/150);
       target_pct 1.5, stop_pct -1.0
    2. ``trend_down``: close < sma20 < sma50 AND adx >= 20 AND 38 <= rsi14 <= 50
       AND close within 2% of sma20 (pullback) AND regime != high_volatility
       → down; confidence = min(0.70, 0.5 + (adx-20)/150);
       target_pct -1.5, stop_pct 1.0
    3. ``meanrev_up``: rsi14 <= 30 AND close <= bollinger_lower → up (bounce);
       confidence 0.6; target_pct 1.0, stop_pct -1.0
    4. ``meanrev_down``: rsi14 >= 70 AND close >= bollinger_upper → down;
       confidence 0.6; target_pct -1.0, stop_pct 1.0
    5. ``breakout_up``: close >= high_20 AND last_volume >= 1.5 * vol_sma20
       → up; confidence 0.65; target_pct 2.0, stop_pct -1.5
    6. ``breakout_down``: close <= low_20 AND last_volume >= 1.5 * vol_sma20
       → down; confidence 0.65; target_pct -2.0, stop_pct 1.5
    7. else → ``{"pattern": "none"}`` (SKIP — no force-fit)

    Reproducible across runs; no network, no LLM. Used by the backtester so
    acceptance is fast and reproducible.
    """
    close = features.get("last_close")
    sma20 = features.get("sma20")
    sma50 = features.get("sma50")
    rsi14 = features.get("rsi14")
    adx_val = features.get("adx")
    boll_lower = features.get("bollinger_lower")
    boll_upper = features.get("bollinger_upper")
    vol_sma20 = features.get("volume_sma20")
    last_volume = features.get("last_volume")
    high_20 = features.get("high_20")
    low_20 = features.get("low_20")
    regime = features.get("regime", "unknown")

    def _pred(
        pattern: str,
        direction: str,
        confidence: float,
        target_pct: float,
        stop_pct: float,
        detail: str,
    ) -> dict[str, Any]:
        return {
            "direction": direction,
            "confidence": round(float(confidence), 2),
            "target_pct": target_pct,
            "stop_pct": stop_pct,
            "pattern": pattern,
            "rationale": (
                f"pattern {pattern}: {detail} "
                f"(regime={regime})"
            ),
        }

    # Regime gate: momentum signals are unreliable in high volatility.
    trend_allowed = regime != "high_volatility"

    def _near_ma(px: float | None, ma: float | None, tol: float = 0.02) -> bool:
        """True when ``px`` is within ``tol`` (2%) of ``ma`` — a pullback."""
        return (
            px is not None and ma is not None and ma > 0
            and abs(px / ma - 1.0) <= tol
        )

    # 1. trend_up (pullback continuation within an uptrend)
    if (
        trend_allowed
        and close is not None and sma20 is not None and sma50 is not None
        and adx_val is not None and rsi14 is not None
        and close > sma20 > sma50 and adx_val >= 20.0
        and 50.0 <= rsi14 <= 62.0 and _near_ma(close, sma20)
    ):
        conf = min(0.70, 0.5 + (adx_val - 20.0) / 150.0)
        return _pred(
            "trend_up", "up", conf, 1.5, -1.0,
            f"close {close:.2f} > sma20 {sma20:.2f} > sma50 {sma50:.2f}, "
            f"adx {adx_val:.1f} >= 20, rsi {rsi14:.1f} in [50, 62], "
            f"close within 2% of sma20 (pullback)",
        )

    # 2. trend_down (pullback continuation within a downtrend)
    if (
        trend_allowed
        and close is not None and sma20 is not None and sma50 is not None
        and adx_val is not None and rsi14 is not None
        and close < sma20 < sma50 and adx_val >= 20.0
        and 38.0 <= rsi14 <= 50.0 and _near_ma(close, sma20)
    ):
        conf = min(0.70, 0.5 + (adx_val - 20.0) / 150.0)
        return _pred(
            "trend_down", "down", conf, -1.5, 1.0,
            f"close {close:.2f} < sma20 {sma20:.2f} < sma50 {sma50:.2f}, "
            f"adx {adx_val:.1f} >= 20, rsi {rsi14:.1f} in [38, 50], "
            f"close within 2% of sma20 (pullback)",
        )

    # 3. meanrev_up
    if (
        rsi14 is not None and boll_lower is not None and close is not None
        and rsi14 <= 30.0 and close <= boll_lower
    ):
        return _pred(
            "meanrev_up", "up", 0.6, 1.0, -1.0,
            f"rsi {rsi14:.1f} <= 30 and close {close:.2f} <= bollinger_lower "
            f"{boll_lower:.2f} (bounce)",
        )

    # 4. meanrev_down
    if (
        rsi14 is not None and boll_upper is not None and close is not None
        and rsi14 >= 70.0 and close >= boll_upper
    ):
        return _pred(
            "meanrev_down", "down", 0.6, -1.0, 1.0,
            f"rsi {rsi14:.1f} >= 70 and close {close:.2f} >= bollinger_upper "
            f"{boll_upper:.2f}",
        )

    # 5. breakout_up
    if (
        close is not None and high_20 is not None
        and last_volume is not None and vol_sma20
        and close >= high_20 and last_volume >= 1.5 * vol_sma20
    ):
        return _pred(
            "breakout_up", "up", 0.65, 2.0, -1.5,
            f"close {close:.2f} >= high_20 {high_20:.2f} and volume "
            f"{last_volume} >= 1.5 * vol_sma20 {vol_sma20:.0f}",
        )

    # 6. breakout_down
    if (
        close is not None and low_20 is not None
        and last_volume is not None and vol_sma20
        and close <= low_20 and last_volume >= 1.5 * vol_sma20
    ):
        return _pred(
            "breakout_down", "down", 0.65, -2.0, 1.5,
            f"close {close:.2f} <= low_20 {low_20:.2f} and volume "
            f"{last_volume} >= 1.5 * vol_sma20 {vol_sma20:.0f}",
        )

    # 7. no clear pattern — SKIP (no force-fit)
    return {"pattern": "none"}


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _recent_stats(conn: sqlite3.Connection, symbol: str, run_date: date) -> dict:
    """Recent validation hit-rate for ``symbol`` prior to ``run_date``."""
    rows = conn.execute(
        """SELECT v.hit FROM validation v
           JOIN predictions p ON p.id = v.prediction_id
           WHERE p.symbol = ? AND p.run_date < ?
           ORDER BY p.run_date DESC LIMIT 20""",
        (symbol, run_date.isoformat()),
    ).fetchall()
    n = len(rows)
    hits = sum(r["hit"] for r in rows)
    return {
        "n": n,
        "hits": hits,
        "hit_rate": round(hits / n, 4) if n else None,
    }


def _is_insufficient(validated: dict[str, Any]) -> bool:
    """True when ``validated`` is the canonical INSUFFICIENT_DATA result."""
    return (
        validated.get("direction") == "flat"
        and validated.get("confidence") == 0.0
    )


def predict_symbol(
    conn: sqlite3.Connection,
    symbol: str,
    run_date: date | str,
    features: dict,
    llm_client: Any,
    prompt_version: str,
    prompt_hash: str | None,
    knowledge_version: int,
    knowledge_hash: str,
    model: str,
    *,
    mode: str = "llm",
    daily_run_id: int | None = None,
    allow_skip: bool = False,
    neg_patterns: set[tuple[str, str]] | None = None,
    pos_symbols: set[str] | None = None,
    suppress_patterns: set[str] | None = None,
    direction_gate: str | None = None,
) -> dict | None:
    """Generate, validate, and persist a prediction for ``symbol`` on ``run_date``.

    ``mode="llm"`` calls the opencode server; ``mode="baseline"`` uses a
    deterministic pattern-gated rule.  In both cases **Python validates all
    numeric outputs** — the LLM never computes prices.

    ``allow_skip=True`` enables the no-force-fit gate: when no clear pattern
    exists (baseline returns ``{"pattern": "none"}``) or the LLM yields
    INSUFFICIENT_DATA (direction flat, confidence 0.0), the function returns
    ``None`` and **no prediction row is inserted**. When ``allow_skip=False``
    (live morning default) the flat/INSUFFICIENT_DATA prediction is persisted
    as before.

    If ``daily_run_id`` is supplied, the prompt/response is recorded in
    ``agent_runs`` for audit purposes.
    """
    if isinstance(run_date, str):
        run_date = date.fromisoformat(run_date)

    if not features.get("ok"):
        validated = _insufficient()
        target_price: float | None = None
        stop_price: float | None = None
        prompt_text: str | None = None
        response_text: str | None = None
        llm_error: str | None = None
    else:
        last_close = features["last_close"]
        if mode == "llm":
            if llm_client is None:
                raise ValueError("mode='llm' requires an llm_client (OpenCodeClient)")
            prompt_text = build_prediction_prompt(
                symbol=symbol,
                run_date=run_date,
                as_of=predict_at(run_date),
                features=features,
                knowledge_context=knowledge_context(
                    conn, f"{symbol} {features.get('regime', '')} prediction"
                ),
                recent_stats=_recent_stats(conn, symbol, run_date),
            )
            try:
                response_text = llm_client.complete(prompt_text)
                parsed = parse_llm_json(response_text)
            except Exception as exc:  # network failure or unparseable output
                parsed = None
                llm_error = str(exc)
            else:
                llm_error = None
            validated = _validate(parsed, features)
        elif mode == "baseline":
            validated = _baseline(features)
            # Knowledge gate: suppress patterns the knowledge base flags as
            # NEGATIVE for this symbol (learned from other periods — e.g.
            # TCS meanrev_up measured at 11% over 26 years). The suppressed
            # prediction becomes a skip via the no-force-fit gate below.
            if validated.get("pattern") not in (None, "none") and (
                symbol,
                validated["pattern"],
            ) in (
                neg_patterns
                if neg_patterns is not None
                else negative_patterns(conn, knowledge_hash)
            ):
                validated = {"pattern": "none"}
            # Pattern gate: suppress globally negative-expectancy patterns
            # (meanrev_up, breakout_up, breakout_down — measured expectancy
            # below zero in 2005-09).
            if (
                validated.get("pattern") not in (None, "none")
                and suppress_patterns
                and validated["pattern"] in suppress_patterns
            ):
                validated = {"pattern": "none"}
            # Symbol gate: only trade symbols with >=1 positive knowledge
            # entry (measured edge). None = gate off.
            if (
                pos_symbols is not None
                and validated.get("pattern") not in (None, "none")
                and symbol not in pos_symbols
            ):
                validated = {"pattern": "none"}
            # Direction gate: "down" suppresses up predictions (the measured
            # base-rate edge — up predictions were worse than random).
            if (
                direction_gate == "down"
                and validated.get("direction") == "up"
            ):
                validated = {"pattern": "none"}
            if validated.get("pattern") == "none" and not allow_skip:
                # Live mode (no skip): no clear pattern → persist a flat
                # prediction (old baseline behavior, no force-fit violation:
                # the flat row is an explicit "no signal" record).
                validated = {
                    "direction": "flat",
                    "confidence": 0.5,
                    "target_pct": 0.0,
                    "stop_pct": 0.0,
                    "rationale": "no clear pattern (flat)",
                }
            prompt_text = None
            response_text = None
            llm_error = None
        else:
            raise ValueError(f"unknown prediction mode: {mode!r}")

        # --- No-force-fit gate: skip instead of persisting a weak prediction --
        if allow_skip:
            skip = False
            if mode == "baseline" and validated.get("pattern") == "none":
                skip = True
            elif _is_insufficient(validated):
                skip = True
            if skip:
                # Audit the LLM interaction even when skipping (full audit trail).
                if daily_run_id is not None and mode == "llm":
                    common = dict(
                        daily_run_id=daily_run_id,
                        model=model,
                        prompt_version=prompt_version,
                        prompt_hash=prompt_hash or _sha256(prompt_text or "INSUFFICIENT_DATA"),
                        knowledge_version=knowledge_version,
                        knowledge_hash=knowledge_hash,
                    )
                    if prompt_text:
                        record_agent_run(
                            conn, **common, symbol=symbol, role="user",
                            content=prompt_text, turn=1,
                        )
                    if response_text:
                        record_agent_run(
                            conn, **common, symbol=symbol, role="assistant",
                            content=response_text, turn=2,
                        )
                    if llm_error:
                        record_agent_run(
                            conn, **common, symbol=symbol, role="tool",
                            content=f"llm error: {llm_error}", turn=3,
                        )
                return None

        target_price = round(
            last_close * (1 + validated["target_pct"] / 100.0), 4
        )
        stop_price = round(
            last_close * (1 + validated["stop_pct"] / 100.0), 4
        )

    # --- Compute prompt_hash when caller did not supply it -------------------
    if prompt_hash is None:
        if prompt_text:
            prompt_hash = _sha256(prompt_text)
        elif mode == "baseline":
            prompt_hash = _sha256("baseline-v1")
        else:
            prompt_hash = _sha256("INSUFFICIENT_DATA")

    run_date_str = run_date.isoformat()

    pid = insert_prediction(
        conn,
        symbol=symbol,
        run_date=run_date_str,
        direction=validated["direction"],
        confidence=validated["confidence"],
        target_price=target_price,
        stop_price=stop_price,
        rationale=validated["rationale"],
        as_of=predict_at(run_date).isoformat(),
        prompt_version=prompt_version,
        prompt_hash=prompt_hash,
        knowledge_version=knowledge_version,
        knowledge_hash=knowledge_hash,
        model=model,
    )

    # --- Audit trail --------------------------------------------------------
    if daily_run_id is not None:
        common = dict(
            daily_run_id=daily_run_id,
            model=model,
            prompt_version=prompt_version,
            prompt_hash=prompt_hash,
            knowledge_version=knowledge_version,
            knowledge_hash=knowledge_hash,
        )
        if prompt_text:
            record_agent_run(
                conn, **common, symbol=symbol, role="user",
                content=prompt_text, turn=1,
            )
        if response_text:
            record_agent_run(
                conn, **common, symbol=symbol, role="assistant",
                content=response_text, turn=2,
            )
        if llm_error:
            record_agent_run(
                conn, **common, symbol=symbol, role="tool",
                content=f"llm error: {llm_error}", turn=3,
            )

    result = get_prediction(conn, symbol, run_date_str)
    if result is not None and validated.get("pattern"):
        # The pattern is not persisted in the predictions table; merge it into
        # the returned dict so callers (backtester) can accumulate pattern stats.
        result["pattern"] = validated["pattern"]
    return result