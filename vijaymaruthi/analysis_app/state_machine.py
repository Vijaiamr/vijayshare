"""Composite state machine: regime x setup x position.

Three layered, fully deterministic finite-state machines per stock:

* **Regime** — ``trend_up`` / ``trend_down`` / ``range`` / ``high_volatility``
  (same recipe as ``aiops.market.regime``: ATR% > 3 -> high vol; else SMA20/50
  slope + ADX>=20; with a <50-bar fallback).
* **Setup** — ``none`` -> ``watch`` -> ``armed`` -> ``triggered``, plus
  ``invalidated``. Driven by the pattern lifecycle (``forming`` / ``active`` /
  ``completed`` / ``failed``) already computed by the pattern engine.
* **Position** — ``flat`` -> ``entered`` -> ``managing`` -> ``target_hit`` /
  ``stopped`` -> ``exited``. Derived from the pattern's entry/stop/target and
  the price path (first-hit-wins, stop checked before target within a bar —
  the same semantics as ``pattern_engine._calc_status``).

Everything here is pure: identical inputs always yield identical states.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .indicators import adx, atr, sma

# ── Regime ──
REGIME_TREND_UP = "trend_up"
REGIME_TREND_DOWN = "trend_down"
REGIME_RANGE = "range"
REGIME_HIGH_VOL = "high_volatility"

HIGH_VOL_ATR_PCT = 3.0
ADX_TREND_THRESHOLD = 20.0

# ── Setup ──
SETUP_NONE = "none"
SETUP_WATCH = "watch"
SETUP_ARMED = "armed"
SETUP_TRIGGERED = "triggered"
SETUP_INVALIDATED = "invalidated"

# ── Position ──
POS_FLAT = "flat"
POS_ENTERED = "entered"
POS_MANAGING = "managing"
POS_TARGET_HIT = "target_hit"
POS_STOPPED = "stopped"
POS_EXITED = "exited"

# pattern status -> setup state
_STATUS_TO_SETUP = {
    "forming": SETUP_WATCH,
    "active": SETUP_ARMED,
    "completed": SETUP_TRIGGERED,
    "failed": SETUP_INVALIDATED,
}


# ──────────────────────────────────────────────────────────────
# Regime engine
# ──────────────────────────────────────────────────────────────
class RegimeEngine:
    """Precomputes the indicator series once; classifies any bar in O(1)."""

    def __init__(self, df):
        self.df = df
        self.close = df["Close"].astype(float)
        self.sma20 = sma(self.close, 20)
        self.sma50 = sma(self.close, 50)
        self.adx14 = adx(df, 14)
        self.atr14 = atr(df, 14)

    def at(self, i: int = -1) -> str:
        n = len(self.close)
        if n == 0:
            return REGIME_RANGE
        if i < 0:
            i = n + i
        if i < 0 or i >= n:
            return REGIME_RANGE

        close = float(self.close.iloc[i])
        a14 = self.atr14.iloc[i]
        atr_pct = (float(a14) / close * 100.0) if (close and a14 == a14) else 0.0
        if atr_pct > HIGH_VOL_ATR_PCT:
            return REGIME_HIGH_VOL

        s20 = self.sma20.iloc[i]
        s50 = self.sma50.iloc[i]
        a = self.adx14.iloc[i]

        slope20 = 0.0
        if i >= 5:
            prev = self.sma20.iloc[i - 5]
            if prev == prev and prev:
                slope20 = (float(s20) - float(prev)) / float(prev) * 100.0

        if s20 == s20 and s50 == s50 and a == a:
            if s20 > s50 and slope20 > 0.0 and a >= ADX_TREND_THRESHOLD:
                return REGIME_TREND_UP
            if s20 < s50 and slope20 < 0.0 and a >= ADX_TREND_THRESHOLD:
                return REGIME_TREND_DOWN

        if s20 == s20:
            if close > s20 and slope20 > 0.0:
                return REGIME_TREND_UP
            if close < s20 and slope20 < 0.0:
                return REGIME_TREND_DOWN

        return REGIME_RANGE

    def series(self) -> List[str]:
        return [self.at(i) for i in range(len(self.close))]


# ──────────────────────────────────────────────────────────────
# Records
# ──────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class CompositeState:
    regime: str
    setup: str
    position: str
    reason: str
    pattern_type: str = ""
    pattern_direction: str = ""
    entry: Optional[float] = None
    stop: Optional[float] = None
    target: Optional[float] = None
    risk_reward: Optional[float] = None
    gates: Tuple[str, ...] = ()

    def as_dict(self) -> Dict[str, Any]:
        return {
            "regime": self.regime,
            "setup": self.setup,
            "position": self.position,
            "reason": self.reason,
            "pattern_type": self.pattern_type,
            "pattern_direction": self.pattern_direction,
            "entry": self.entry,
            "stop": self.stop,
            "target": self.target,
            "risk_reward": self.risk_reward,
            "gates": list(self.gates),
        }


@dataclass(frozen=True)
class StateTransition:
    bar: str
    position: str
    price: float
    cause: str

    def as_dict(self) -> Dict[str, Any]:
        return {"bar": self.bar, "position": self.position,
                "price": self.price, "cause": self.cause}


# ──────────────────────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────────────────────
def top_pattern(pattern_votes: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """Deterministically pick the dominant pattern from pattern votes."""
    geo = list((pattern_votes or {}).get("geometry", []) or [])
    if not geo:
        return None
    return sorted(
        geo,
        key=lambda g: (-int(g.get("confidence", 0) or 0),
                       str(g.get("type", "")),
                       -int(g.get("end_idx", 0) or 0)),
    )[0]


def classify_setup(pattern_votes: Mapping[str, Any],
                   gates: Optional[List[str]] = None) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    """Return ``(setup_state, reason, pattern)``."""
    gates = gates or []
    if not (pattern_votes or {}).get("available", False):
        return SETUP_NONE, "pattern engine unavailable", None
    pat = top_pattern(pattern_votes)
    if pat is None:
        return SETUP_NONE, "no pattern detected", None
    if (pattern_votes or {}).get("veto"):
        return SETUP_INVALIDATED, "pattern veto", pat
    status = str(pat.get("status", "forming"))
    state = _STATUS_TO_SETUP.get(status, SETUP_WATCH)
    reason = f"{pat.get('type')} {pat.get('direction')} ({status})"
    if gates:
        reason += f"; {len(gates)} gate(s)"
    return state, reason, pat


# ──────────────────────────────────────────────────────────────
# Position
# ──────────────────────────────────────────────────────────────
def classify_position(df, pat: Optional[Dict[str, Any]]) -> Tuple[str, str]:
    """Current position state from the dominant pattern + last price."""
    if pat is None:
        return POS_FLAT, "no setup"
    status = str(pat.get("status", "forming"))
    if status == "forming":
        return POS_FLAT, "setup forming"
    if status == "failed":
        return POS_STOPPED, "stop hit"
    if status == "completed":
        return POS_TARGET_HIT, "target hit"

    # active: entry crossed, neither stop nor target hit yet.
    entry = _f(pat.get("entry"))
    stop = _f(pat.get("stop_loss"))
    target = _f(pat.get("target"))
    direction = str(pat.get("direction", "bullish"))
    price = float(df["Close"].iloc[-1]) if len(df) else float("nan")
    if entry is None or stop is None or target is None:
        return POS_ENTERED, "active (levels unavailable)"
    risk = abs(entry - stop)
    if direction == "bullish":
        if risk > 0 and price >= entry + risk:
            return POS_MANAGING, "in profit >= 1R"
        return POS_ENTERED, "active"
    else:
        if risk > 0 and price <= entry - risk:
            return POS_MANAGING, "in profit >= 1R"
        return POS_ENTERED, "active"


def position_timeline(df, pat: Optional[Dict[str, Any]]) -> List[StateTransition]:
    """Walk bars from the pattern's formation end, emitting position states.

    First-hit-wins with the stop checked before the target within a bar
    (mirrors ``pattern_engine._calc_status``).
    """
    if pat is None:
        return []
    entry = _f(pat.get("entry"))
    stop = _f(pat.get("stop_loss"))
    target = _f(pat.get("target"))
    direction = str(pat.get("direction", "bullish"))
    end_idx = pat.get("end_idx")
    if entry is None or stop is None or target is None or end_idx is None:
        return []

    start = max(0, int(end_idx))
    out: List[StateTransition] = []
    state = POS_FLAT
    risk = abs(entry - stop)
    for i in range(start, len(df)):
        row = df.iloc[i]
        bar = str(df.index[i])[:10]
        high = float(row["High"])
        low = float(row["Low"])
        close = float(row["Close"])
        if state in (POS_FLAT,):
            # entry trigger: price trades through the entry level
            if (direction == "bullish" and high >= entry) or \
               (direction == "bearish" and low <= entry):
                state = POS_ENTERED
                out.append(StateTransition(bar, state, entry, "entry triggered"))
            continue
        if state in (POS_ENTERED, POS_MANAGING):
            # stop first (conservative), then target
            if direction == "bullish":
                if low <= stop:
                    state = POS_STOPPED
                    out.append(StateTransition(bar, state, stop, "stop hit"))
                    continue
                if high >= target:
                    state = POS_TARGET_HIT
                    out.append(StateTransition(bar, state, target, "target hit"))
                    continue
                if risk > 0 and close >= entry + risk and state == POS_ENTERED:
                    state = POS_MANAGING
                    out.append(StateTransition(bar, state, close, "in profit >= 1R"))
            else:
                if high >= stop:
                    state = POS_STOPPED
                    out.append(StateTransition(bar, state, stop, "stop hit"))
                    continue
                if low <= target:
                    state = POS_TARGET_HIT
                    out.append(StateTransition(bar, state, target, "target hit"))
                    continue
                if risk > 0 and close <= entry - risk and state == POS_ENTERED:
                    state = POS_MANAGING
                    out.append(StateTransition(bar, state, close, "in profit >= 1R"))
    return out


# ──────────────────────────────────────────────────────────────
# Composite
# ──────────────────────────────────────────────────────────────
def analyze_state(df, pattern_votes: Mapping[str, Any],
                  gates: Optional[List[str]] = None) -> CompositeState:
    """Compute the composite (regime, setup, position) state for a stock."""
    regime = RegimeEngine(df).at(-1)
    setup, reason, pat = classify_setup(pattern_votes, gates)
    position, pos_reason = classify_position(df, pat)
    return CompositeState(
        regime=regime,
        setup=setup,
        position=position,
        reason=f"{reason}; {pos_reason}",
        pattern_type=str(pat.get("type", "")) if pat else "",
        pattern_direction=str(pat.get("direction", "")) if pat else "",
        entry=_f(pat.get("entry")) if pat else None,
        stop=_f(pat.get("stop_loss")) if pat else None,
        target=_f(pat.get("target")) if pat else None,
        risk_reward=_f(pat.get("risk_reward")) if pat else None,
        gates=tuple(gates or ()),
    )


def _f(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
