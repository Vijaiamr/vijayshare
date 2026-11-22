"""Quality-gate rules: institutional filters applied after classification.

Mirrors ``_apply_quality_gates`` exactly:
  1. Data-quality gate   — insufficient history / no price.
  2. Liquidity gate      — market cap + average volume thresholds.
  3. Fundamental gate    — extreme leverage / broken fundamentals / risk flags.
  3b. Valuation gate     — extreme multiples.
  4. Confidence calibration — missing fundamentals reduce confidence.

Pure: receives everything it needs (no self/result access).
"""
from __future__ import annotations

import math
from typing import Any, List, Mapping, Optional, Tuple

# Thresholds
MIN_ROWS = 60
INDIA_MICRO_CAP = 5e9
INDIA_SMALL_CAP = 20e9
US_MICRO_CAP = 300e6
US_SMALL_CAP = 2e9
THIN_VOL_1 = 20_000
THIN_VOL_2 = 100_000


def _num(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, bool):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        import re

        m = re.search(r"-?[\d.]+", val.replace(",", ""))
        return float(m.group()) if m else None
    return None


def apply_quality_gates(
    signal: str,
    confidence: int,
    analysis: Mapping[str, Any],
    price: float,
    ticker: str = "",
    yf_info: Optional[Mapping[str, Any]] = None,
    n_rows: int = 0,
) -> Tuple[str, int, List[str]]:
    """Return ``(signal, confidence, gate_reasons)``."""
    gates: List[str] = []
    info = yf_info or {}
    fund = analysis.get("fundamentals", {}) or {}
    qr = fund.get("quick_ratings", {}) or {}
    s08 = fund.get("section_08_ratios", {}) or {}
    s09 = fund.get("section_09_growth", {}) or {}
    s12 = fund.get("section_12_valuation", {}) or {}
    s15 = fund.get("section_15_risk", {}) or {}
    s17 = fund.get("section_17_quarterly_detail", {}) or {}

    # ── 1. Data-quality gate ──
    if price is None or (isinstance(price, float) and math.isnan(price)):
        return "N/A", 0, ["No valid price data"]
    if n_rows < MIN_ROWS:
        gates.append(f"Insufficient price history ({n_rows} rows)")
        if signal == "BUY":
            signal = "HOLD"
        confidence = min(confidence, 40)

    # ── 2. Liquidity gate (market cap + volume) ──
    market_cap = info.get("marketCap", None)
    is_india = ticker.endswith(".NS") or ticker.endswith(".BO")
    if market_cap is not None:
        try:
            market_cap = float(market_cap)
        except (TypeError, ValueError):
            market_cap = None
    if market_cap is not None:
        if is_india:
            if market_cap < INDIA_MICRO_CAP:
                gates.append(f"Micro-cap (₹{market_cap/1e7:.0f} Cr) — severe liquidity risk")
                if signal == "BUY":
                    signal = "HOLD"
                confidence = min(confidence, 40)
            elif market_cap < INDIA_SMALL_CAP:
                gates.append(f"Small-cap (₹{market_cap/1e7:.0f} Cr) — liquidity risk")
                confidence = min(confidence, 60)
        else:
            if market_cap < US_MICRO_CAP:
                gates.append(f"Micro-cap (${market_cap/1e6:.0f}M) — severe liquidity risk")
                if signal == "BUY":
                    signal = "HOLD"
                confidence = min(confidence, 40)
            elif market_cap < US_SMALL_CAP:
                gates.append(f"Small-cap (${market_cap/1e6:.0f}M) — liquidity risk")
                confidence = min(confidence, 60)

    avg_vol = (analysis.get("volume", {}) or {}).get("avg_vol_20")
    if avg_vol is not None:
        try:
            avg_vol = float(avg_vol)
        except (TypeError, ValueError):
            avg_vol = None
    if avg_vol is not None:
        if avg_vol < THIN_VOL_1:
            gates.append(f"Very thin liquidity (avg vol {avg_vol:,.0f})")
            if signal == "BUY":
                signal = "HOLD"
            confidence = min(confidence, 40)
        elif avg_vol < THIN_VOL_2:
            gates.append(f"Thin liquidity (avg vol {avg_vol:,.0f})")
            confidence = min(confidence, 60)

    # ── 3. Fundamental gate ──
    d_e = _num(s08.get("debt_to_equity"))
    if d_e is not None:
        if d_e > 10:
            gates.append(f"Extreme leverage (D/E {d_e:.1f})")
            signal = "AVOID"
            confidence = min(confidence, 40)
        elif d_e > 5:
            gates.append(f"High leverage (D/E {d_e:.1f})")
            if signal == "BUY":
                signal = "HOLD"
            confidence = min(confidence, 55)

    pm = _num(s08.get("profit_margin"))
    yoy_rev = _num(s17.get("revenue_yoy_growth"))
    if pm is not None and pm < 0 and yoy_rev is not None and yoy_rev < 0:
        gates.append("Loss-making with declining revenue")
        if signal == "BUY":
            signal = "HOLD"
        confidence = min(confidence, 45)

    risk_flags = s15.get("risk_flags", []) or []
    warn_flags = [f for f in risk_flags if "⚠" in str(f)]
    if len(warn_flags) >= 3:
        gates.append(f"{len(warn_flags)} risk flags")
        if signal == "BUY":
            signal = "HOLD"
        confidence = min(confidence, 55)

    # ── 3b. Valuation gate ──
    pe = _num(s08.get("pe_ttm") or s12.get("pe_ratio"))
    eg = _num(s09.get("earnings_growth_ttm") or s17.get("earnings_yoy_growth"))
    if pe is not None and pe > 0:
        if pe > 100:
            gates.append(f"Extreme valuation (PE {pe:.0f})")
            if signal == "BUY":
                signal = "HOLD"
            confidence = min(confidence, 55)
        elif pe > 60 and (eg is None or eg < 0.10):
            gates.append(f"Rich valuation (PE {pe:.0f}, growth {eg*100:.0f}%)" if eg is not None
                         else f"Rich valuation (PE {pe:.0f}, growth N/A)")
            if signal == "BUY":
                signal = "HOLD"
            confidence = min(confidence, 55)

    # ── 4. Confidence calibration ──
    if not qr:
        gates.append("Fundamentals unavailable — reduced confidence")
        confidence = max(0, confidence - 10)

    return signal, confidence, gates
