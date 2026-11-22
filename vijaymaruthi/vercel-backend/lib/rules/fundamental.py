"""Fundamental-domain rules: 7-factor weighted scoring + AND-floor cap.

Mirrors ``_fundamental_convolution`` exactly. Pure: consumes the 22-section
fundamentals dict, returns the score/factors/cap dict.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

FUND_FACTOR_FLOOR = 50  # any factor with data below this triggers the cap
FUND_CAP = 65           # cap (not veto) applied when the AND-floor fires

WEIGHTS = {
    "value": 20, "growth": 20, "profitability": 20, "risk": 15,
    "momentum": 10, "analyst": 10, "dividend": 5,
}


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


def _avg(scores) -> Optional[float]:
    return round(sum(scores) / len(scores), 1) if scores else None


def fundamental_convolution(fund: Mapping[str, Any]) -> Dict[str, Any]:
    """Weighted factor scoring with an AND-floor cap (0-100)."""
    qr = fund.get("quick_ratings", {}) or {}
    s08 = fund.get("section_08_ratios", {}) or {}
    s09 = fund.get("section_09_growth", {}) or {}
    s12 = fund.get("section_12_valuation", {}) or {}
    s15 = fund.get("section_15_risk", {}) or {}

    factors: Dict[str, Optional[float]] = {}

    # ── Value (20) ──
    pe = _num(s12.get("pe_ttm"))
    pb = _num(s12.get("pb"))
    peg = _num(s12.get("peg_ratio"))
    v = []
    if pe is not None:
        v.append(100 if pe < 15 else 70 if pe < 25 else 40 if pe < 40 else 10)
    if pb is not None:
        v.append(100 if pb < 1.5 else 70 if pb < 3 else 40 if pb < 5 else 10)
    if peg is not None:
        v.append(100 if peg < 1 else 70 if peg < 2 else 40 if peg < 3 else 10)
    factors["value"] = _avg(v)

    # ── Growth (20) ──
    rev_cagr = _num(s09.get("revenue_cagr_2yr"))
    ni_cagr = _num(s09.get("net_income_cagr_2yr"))
    g = []
    if rev_cagr is not None:
        g.append(100 if rev_cagr > 15 else 70 if rev_cagr > 10 else 40 if rev_cagr > 0 else 10)
    if ni_cagr is not None:
        g.append(100 if ni_cagr > 15 else 70 if ni_cagr > 10 else 40 if ni_cagr > 0 else 10)
    factors["growth"] = _avg(g)

    # ── Profitability (20) ──
    roe = _num(s08.get("roe"))
    pm = _num(s08.get("profit_margin"))
    p = []
    if roe is not None:
        p.append(100 if roe > 15 else 70 if roe > 10 else 40 if roe > 5 else 10)
    if pm is not None:
        p.append(100 if pm > 20 else 70 if pm > 10 else 40 if pm > 5 else 10)
    factors["profitability"] = _avg(p)

    # ── Risk (15) ──
    de = _num(s08.get("debt_to_equity"))
    risk_rating = s15.get("risk_rating", "")
    r = []
    if de is not None:
        r.append(100 if de < 0.5 else 70 if de < 1 else 40 if de < 2 else 10)
    if risk_rating:
        r.append(100 if risk_rating == "Low" else 70 if risk_rating == "Moderate" else 30)
    factors["risk"] = _avg(r)

    # ── Momentum (10) ──
    price = _num(s12.get("current_price"))
    high52 = _num(s12.get("high_52w"))
    low52 = _num(s12.get("low_52w"))
    m = []
    if price is not None and high52 and low52 and high52 > low52:
        pos = (price - low52) / (high52 - low52)
        m.append(100 if pos > 0.8 else 70 if pos > 0.5 else 40 if pos > 0.3 else 10)
    factors["momentum"] = _avg(m)

    # ── Analyst (10) ──
    analyst = qr.get("analyst_rating", "")
    if analyst in ("strong_buy", "Strong Buy"):
        factors["analyst"] = 100
    elif analyst in ("buy", "Buy"):
        factors["analyst"] = 75
    elif analyst in ("hold", "Hold"):
        factors["analyst"] = 50
    elif analyst:
        factors["analyst"] = 25
    else:
        factors["analyst"] = None

    # ── Dividend (5) ──
    dy = _num(s08.get("dividend_yield"))
    factors["dividend"] = (100 if dy > 2 else 70 if dy > 1 else 40 if dy > 0 else 10) \
        if dy is not None else None

    # ── Weighted sum ──
    total_w = 0.0
    weighted = 0.0
    for k, w in WEIGHTS.items():
        val = factors[k]
        if val is not None:
            weighted += val * w
            total_w += w
    fund_conv = 50.0 if total_w == 0 else weighted / total_w

    # ── AND-floor cap ──
    known = {k: val for k, val in factors.items() if val is not None}
    cap_applied = False
    cap_reason = None
    if known and min(known.values()) < FUND_FACTOR_FLOOR:
        cap_applied = True
        weak = min(known, key=known.get)
        cap_reason = f"{weak} factor {known[weak]:.0f}/100 < {FUND_FACTOR_FLOOR}"
        fund_conv = min(fund_conv, FUND_CAP)

    return {
        "score": round(fund_conv, 1),
        "factors": factors,
        "cap_applied": cap_applied,
        "cap_reason": cap_reason,
    }
