"""Pattern voting + gating rules.

Wraps the calibration weights and acceptance filters that turn the geometric
patterns from ``pattern_engine`` into the weighted bull/bear votes consumed by
the technical convolution. Pure: it receives already-detected pattern objects
and never imports or runs the engine itself.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

# Calibrated per-pattern weights (pattern_engine calibration, AUDIT_TRACKING.md
# §12-13). Bullish adds, bearish subtracts.
BULL_W: Dict[str, float] = {
    "falling_wedge": 8,
    "inverse_head_and_shoulders": 7,
    "double_bottom": 6,
    "cup_and_handle": 5,
    "ascending_triangle": 5,
    "symmetrical_triangle": 5,
    "rounding_bottom": 4,
    "triple_bottom": 4,
    "island_reversal": 3,
    "bull_flag": 2,
}
BEAR_W: Dict[str, float] = {
    "head_and_shoulders": 10,
    "rising_wedge": 6,
    "descending_triangle": 6,
    "double_top": 5,
    "triple_top": 5,
    "rounding_top": 4,
    "bear_flag": 3,
    "island_reversal": 3,
    "symmetrical_triangle": 5,
}

# A bullish symmetrical triangle only counts when its risk:reward and ATR are
# inside the measured-edge band (2026-09-06 calibration).
SYM_TRIANGLE_MAX_RR = 3.5
SYM_TRIANGLE_MAX_ATR_PCT = 1.0

UNAVAILABLE: Dict[str, Any] = {
    "bull_weight": 0.0,
    "bear_weight": 0.0,
    "patterns": [],
    "majority": True,
    "veto": False,
    "available": False,
    "geometry": [],
}


def _geometry(p: Any) -> Optional[Dict[str, Any]]:
    """Full institutional detail so the UI can render confidence/levels."""
    if not (getattr(p, "neckline", None) or getattr(p, "structure", None)
            or getattr(p, "lines", None) or getattr(p, "markers", None)):
        return None
    return {
        "type": p.type,
        "direction": p.direction,
        "neckline": list(getattr(p, "neckline", None) or []),
        "structure": list(getattr(p, "structure", None) or []),
        "lines": list(getattr(p, "lines", None) or []),
        "markers": list(getattr(p, "markers", None) or []),
        "confidence": int(getattr(p, "confidence", 0) or 0),
        "status": getattr(p, "status", "forming") or "forming",
        "entry": getattr(p, "entry", None),
        "stop_loss": getattr(p, "stop_loss", None),
        "target": getattr(p, "target", None),
        "risk_reward": getattr(p, "risk_reward", None),
        "confirmations": list(getattr(p, "confirmations", None) or []),
        "end_idx": getattr(p, "end_idx", None),
        "timeframe": getattr(p, "timeframe", "daily") or "daily",
        "multi_tf_boost": float(getattr(p, "multi_tf_boost", 1.0) or 1.0),
        "entry_checklist": dict(getattr(p, "entry_checklist", None) or {}),
    }


def pattern_votes(patterns: Sequence[Any], atr_pct: Optional[float]) -> Dict[str, Any]:
    """Weighted bull/bear votes from detected patterns.

    Mirrors the legacy ``_pattern_votes`` scoring exactly: each pattern adds its
    calibrated weight; a filtered symmetrical triangle only counts when
    ``rr <= 3.5`` and ``atr_pct <= 1.0``. Equal weights are NEUTRAL, never a
    veto — only ``bear > bull`` blocks a BUY.
    """
    atr_pct = atr_pct or 0
    bull_w = 0.0
    bear_w = 0.0
    names: List[str] = []
    geometry: List[Dict[str, Any]] = []
    for p in patterns:
        names.append(p.type)
        g = _geometry(p)
        if g is not None:
            geometry.append(g)
        if p.direction == "bullish":
            if p.type == "symmetrical_triangle":
                rr = getattr(p, "risk_reward", None) or 0
                if rr <= SYM_TRIANGLE_MAX_RR and atr_pct <= SYM_TRIANGLE_MAX_ATR_PCT:
                    bull_w += BULL_W.get(p.type, 0)
            else:
                bull_w += BULL_W.get(p.type, 0)
        elif p.direction == "bearish":
            bear_w += BEAR_W.get(p.type, 0)

    return {
        "bull_weight": round(bull_w, 1),
        "bear_weight": round(bear_w, 1),
        "patterns": names,
        "majority": bull_w >= bear_w,
        "veto": bear_w > bull_w,
        "available": True,
        "geometry": geometry,
    }
