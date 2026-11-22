"""Quantamental-fusion rules: blend technical + fundamental + sentiment.

Mirrors ``_cap_weight``, ``_fallback_fund_score`` and ``_compute_quantamental``
exactly. Pure: the caller passes the already-computed convolution scores and
technical confidence instead of a live ``result`` object.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

TECH_BAND_LO, TECH_BAND_HI = 0.45, 0.55


def cap_weight(ticker: str, market_cap: Optional[float]) -> tuple:
    """Dynamic technical/fundamental base weights by market cap."""
    is_india = ticker.endswith(".NS") or ticker.endswith(".BO")
    if market_cap is None:
        return 0.50, 0.50
    if is_india:
        if market_cap > 500e9:
            return 0.40, 0.60
        if market_cap > 50e9:
            return 0.50, 0.50
        return 0.60, 0.40
    if market_cap > 10e9:
        return 0.40, 0.60
    if market_cap > 1e9:
        return 0.50, 0.50
    return 0.60, 0.40


def cap_category(ticker: str, market_cap: Optional[float]) -> str:
    if market_cap is None:
        return "mid"
    is_india = ticker.endswith(".NS") or ticker.endswith(".BO")
    if is_india:
        if market_cap > 500e9:
            return "large"
        if market_cap > 50e9:
            return "mid"
        return "small"
    if market_cap > 10e9:
        return "large"
    if market_cap > 1e9:
        return "mid"
    return "small"


def map_fund_rating_to_score(rating: str) -> float:
    return {
        "strong_buy": 90, "Strong Buy": 90,
        "buy": 75, "Buy": 75,
        "hold": 50, "Hold": 50,
        "sell": 25, "Sell": 25,
        "strong_sell": 10, "Strong Sell": 10,
    }.get(rating, 50)


def parse_pct(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(str(v).strip().replace("%", ""))
        return f / 100.0 if abs(f) > 1 else f
    except (TypeError, ValueError):
        return None


def parse_num(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(str(v).strip().replace("x", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def fallback_fund_score(fund: Mapping[str, Any]) -> Optional[float]:
    """Compute a real fundamental score from sections when screening is missing."""
    s08 = fund.get("section_08_ratios", {}) or {}
    s09 = fund.get("section_09_growth", {}) or {}
    s12 = fund.get("section_12_valuation", {}) or {}
    s15 = fund.get("section_15_risk", {}) or {}

    score = 0
    max_score = 0

    pe = parse_num(s08.get("pe_ttm") or s12.get("pe_ratio"))
    if pe is not None and pe > 0:
        max_score += 20
        if pe < 15:
            score += 15
        elif pe < 20:
            score += 10
        elif pe < 25:
            score += 5
    pb = parse_num(s08.get("price_to_book") or s12.get("pb_ratio"))
    if pb is not None and pb > 0:
        max_score += 5
        if pb < 1.5:
            score += 5
        elif pb < 3:
            score += 3

    eg = parse_pct(s09.get("earnings_growth_ttm") or s09.get("net_income_yoy_1yr"))
    if eg is not None:
        max_score += 15
        if eg > 0.15:
            score += 15
        elif eg > 0.05:
            score += 10
        elif eg > 0:
            score += 5
    rg = parse_pct(s09.get("revenue_growth_ttm") or s09.get("revenue_yoy_1yr"))
    if rg is not None:
        max_score += 5
        if rg > 0.10:
            score += 5
        elif rg > 0:
            score += 3

    roe = parse_pct(s08.get("return_on_equity"))
    if roe is not None:
        max_score += 15
        if roe > 0.15:
            score += 15
        elif roe > 0.10:
            score += 10
        elif roe > 0.05:
            score += 5
    pm = parse_pct(s08.get("profit_margin"))
    if pm is not None:
        max_score += 5
        if pm > 0.20:
            score += 5
        elif pm > 0.10:
            score += 3

    price = parse_num(s12.get("current_price"))
    high52 = parse_num(s12.get("high_52w"))
    low52 = parse_num(s12.get("low_52w"))
    if price is not None and high52 and low52 and high52 > low52:
        max_score += 10
        pos = (price - low52) / (high52 - low52)
        if pos > 0.8:
            score += 10
        elif pos > 0.5:
            score += 5

    de = parse_num(s08.get("debt_to_equity"))
    if de is not None:
        max_score += 5
        if de < 0.5:
            score += 5
        elif de < 1:
            score += 3
    risk_rating = s15.get("risk_rating", "")
    if risk_rating:
        max_score += 5
        if risk_rating == "Low":
            score += 5
        elif risk_rating == "Moderate":
            score += 3

    dy = parse_pct(s08.get("dividend_yield"))
    if dy is not None:
        max_score += 5
        if dy > 0.02:
            score += 5
        elif dy > 0.01:
            score += 3

    if max_score == 0:
        return None
    return round(score / max_score * 100, 1)


def _num(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, bool):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        import re

        m = re.search(r"[\d.]+", val.replace(",", ""))
        return float(m.group()) if m else None
    return None


def compute_quantamental(
    analysis: Mapping[str, Any],
    tech_conf: int,
    tech_signal: str,
    conv_tech: Mapping[str, Any],
    conv_fund: Mapping[str, Any],
    ticker: str,
    yf_info: Optional[Mapping[str, Any]] = None,
    sentiment: Optional[dict] = None,
) -> Dict[str, Any]:
    """Fuse technical, fundamental and optional sentiment signals."""
    tech_score = float((conv_tech or {}).get("score", tech_conf))
    fund = analysis.get("fundamentals", {}) or {}
    qr = fund.get("quick_ratings", {}) or {}
    fund_score = float((conv_fund or {}).get("score", 50.0))
    fund_rating = qr.get("screening_rating", "Hold")

    info = yf_info or {}
    market_cap = info.get("marketCap", None)
    cat = cap_category(ticker, market_cap)
    raw_tech_w, raw_fund_w = cap_weight(ticker, market_cap)

    adjustments = []
    adj_tech = 0.0
    adj_fund = 0.0
    if qr.get("moat_rating", "") == "Wide Moat":
        adj_fund += 0.03
        adj_tech -= 0.03
        adjustments.append("Wide Moat +3% fundamental")
    if qr.get("risk_rating", "") == "Low":
        adj_fund += 0.03
        adj_tech -= 0.03
        adjustments.append("Low Risk +3% fundamental")
    if qr.get("analyst_rating", "") == "strong_buy":
        adj_fund += 0.03
        adj_tech -= 0.03
        adjustments.append("Strong Buy consensus +3% fundamental")

    tech_w = max(TECH_BAND_LO, min(TECH_BAND_HI, raw_tech_w + adj_tech))
    fund_w = max(TECH_BAND_LO, min(TECH_BAND_HI, raw_fund_w + adj_fund))
    tot = tech_w + fund_w
    tech_w /= tot
    fund_w /= tot

    blended = tech_score * tech_w + fund_score * fund_w
    if blended >= 80:
        blended_rating = "Strong Buy"
    elif blended >= 65:
        blended_rating = "Buy"
    elif blended >= 40:
        blended_rating = "Hold"
    elif blended >= 25:
        blended_rating = "Sell"
    else:
        blended_rating = "Strong Sell"

    # ── Evidence ──
    tech_evidence = []
    ms = analysis.get("structure", {}) or {}
    if "Uptrend" in ms.get("structure", ""):
        tech_evidence.append("Uptrending market structure")
    if "Downtrend" in ms.get("structure", ""):
        tech_evidence.append("Downtrending market structure")
    ma = analysis.get("ma", {}) or {}
    if ma.get("above_200"):
        tech_evidence.append("Price above SMA200")
    if ma.get("above_50"):
        tech_evidence.append("Price above SMA50")
    macd = analysis.get("macd", {}) or {}
    if macd.get("crossover") == "Bullish":
        tech_evidence.append("MACD bullish crossover")
    if macd.get("crossover") == "Bearish":
        tech_evidence.append("MACD bearish crossover")
    rsi_val = (analysis.get("rsi", {}) or {}).get("value", 50)
    if rsi_val <= 35:
        tech_evidence.append(f"RSI oversold ({rsi_val:.0f})")
    elif rsi_val >= 65:
        tech_evidence.append(f"RSI overbought ({rsi_val:.0f})")
    adx_v = (analysis.get("adx", {}) or {}).get("adx", 0)
    if adx_v > 25:
        tech_evidence.append(f"Strong trend (ADX {adx_v:.0f})")
    wy = (analysis.get("wyckoff", {}) or {}).get("wyckoff_phase", {}).get("phase", "")
    if wy in ("Markup", "Accumulation"):
        tech_evidence.append(f"Wyckoff {wy}")
    if wy == "Markdown":
        tech_evidence.append(f"Wyckoff {wy}")
    divs = analysis.get("divergence", [])
    if divs:
        tech_evidence.append(f"{len(divs)} divergence(s) detected")

    fund_evidence = []
    s08 = fund.get("section_08_ratios", {}) or {}
    roe = _num(s08.get("roe", None))
    if roe and roe > 15:
        fund_evidence.append(f"Strong ROE ({roe:.1f}%)")
    elif roe and roe > 10:
        fund_evidence.append(f"Healthy ROE ({roe:.1f}%)")
    pm = _num(s08.get("profit_margin", None))
    if pm and pm > 20:
        fund_evidence.append(f"Healthy margins ({pm:.1f}%)")
    s12 = fund.get("section_12_valuation", {}) or {}
    pe = _num(s12.get("pe_ttm", None))
    peg = _num(s12.get("peg_ratio", None))
    if peg and peg < 1:
        fund_evidence.append(f"Attractive PEG ({peg:.2f})")
    if pe and pe < 20:
        fund_evidence.append(f"Reasonable P/E ({pe:.1f}x)")
    strengths = (fund.get("section_22_suitability", {}) or {}).get("key_strengths", [])
    if strengths:
        fund_evidence.append(strengths[0])
    analyst_r = qr.get("analyst_rating", "")
    if analyst_r in ("strong_buy", "buy"):
        fund_evidence.append(f"Positive analyst consensus ({analyst_r})")

    # ── Sentiment pillar ──
    sent_evidence = []
    if sentiment and isinstance(sentiment, dict):
        sent_score = sentiment.get("score", 0)
        sent_label = sentiment.get("label", "Neutral")
        sent_conf = sentiment.get("confidence", 0)
        sent_count = sentiment.get("article_count", 0)
        if abs(sent_score) >= 0.2 and sent_count >= 2:
            sent_evidence.append(
                f"{sent_label} news sentiment ({sent_score:+.2f}) "
                f"— {sent_count} articles, {sent_conf:.0f}% confidence")
        if abs(sent_score) >= 0.3 and sent_conf >= 40:
            shift = min(0.05, abs(sent_score) * sent_conf / 100 * 0.10)
            if sent_score > 0:
                if fund_w - shift >= 0.45:
                    fund_w -= shift
                    tech_w += shift
                    adjustments.append(f"{sent_label} sentiment → +{shift*100:.0f}% technical")
            else:
                if tech_w - shift >= 0.45:
                    tech_w -= shift
                    fund_w += shift
                    adjustments.append(f"{sent_label} sentiment → +{shift*100:.0f}% fundamental")

    # ── Deduplicate evidence ──
    def _dedup(items):
        seen = set()
        out = []
        for e in items:
            key = e.lower().strip()
            if key not in seen:
                seen.add(key)
                out.append(e)
        return out

    evidence_tech = _dedup(tech_evidence)[:5]
    evidence_fund = _dedup(fund_evidence)[:5]
    sent_label = (sentiment or {}).get("label", "")
    if sent_evidence:
        evidence_fund.insert(0, sent_evidence[0])

    return {
        "blended_score": round(blended, 1),
        "blended_rating": blended_rating,
        "technical_score": round(tech_score, 1),
        "technical_confidence": tech_conf,
        "technical_signal": tech_signal,
        "fundamental_score": round(fund_score, 1),
        "fundamental_rating": fund_rating,
        "sentiment_score": (sentiment or {}).get("score", 0),
        "sentiment_label": sent_label,
        "sentiment_article_count": (sentiment or {}).get("article_count", 0),
        "market_cap_category": cat,
        "weights": {"technical": round(tech_w, 3), "fundamental": round(fund_w, 3)},
        "weight_adjustments": adjustments if adjustments else ["Standard market-cap weights"],
        "evidence": {"technical": evidence_tech[:6], "fundamental": evidence_fund[:6]},
        "source": "Quantamental fusion of technical signal, 22-section fundamental screening, and news sentiment.",
    }
