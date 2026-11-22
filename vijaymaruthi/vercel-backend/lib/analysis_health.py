"""
analysis_health.py — v3 health-check methodology for scan quality gates.

Computes per-stock health checks from an AnalysisResult + optional report text.
Shared by the backend scan pipeline, the cron scanner, and standalone validation
(so the app scan and the /tmp/nse2500_scan_v3.py validation use one source of truth).

Health checks (v3):
  price_ok   — last close is a positive number
  sma_ok     — SMA20 / SMA50 / SMA200 all present
  atr_ok     — ATR present and > 0
  adx_ok     — ADX present
  div_sane   — dividend yield is None/'N/A' or a sane 0–20%
  debt_sane  — debt-to-equity is None/'N/A' or a sane value < 10
  nan_ok     — report text contains no NaN tokens (requires report_text)

health_pass = all checks pass.
"""

import math
import re
from typing import Any, Optional


def is_nan(v: Any) -> bool:
    """True for None, NaN, or unparseable numeric values."""
    if v is None:
        return True
    try:
        return math.isnan(float(v))
    except Exception:
        return False


def _div_sane(v: Any) -> bool:
    """Dividend yield sanity: None/'N/A' or 0–20%."""
    if v in (None, "N/A", ""):
        return True
    if isinstance(v, str) and v.endswith("%"):
        try:
            return 0 <= float(v[:-1]) <= 20
        except Exception:
            return False
    try:
        return 0 <= float(v) <= 20
    except Exception:
        return False


def _debt_sane(v: Any) -> bool:
    """Debt-to-equity sanity: None/'N/A' or a numeric value < 10."""
    if v in (None, "N/A", ""):
        return True
    if isinstance(v, str):
        s = v.replace(".", "").replace("-", "")
        if not s.isdigit():
            return False
    try:
        return float(v) < 10
    except Exception:
        return False


def compute_health(result, report_text: Optional[str] = None) -> dict:
    """Compute v3 health checks from an AnalysisResult.

    Returns a dict with:
      checks            — {price_ok, sma_ok, atr_ok, adx_ok, div_sane, debt_sane, nan_ok}
      health_pass       — all checks pass
      report_nan        — NaN token count in report text
      report_len        — report text length
      sector            — sector classification
      risk_flags        — fundamental risk flags
      yoy_rev / yoy_ni  — quarterly YoY revenue / net income growth
      fund_rating       — screening rating
      quality_gates     — institutional gate reasons
      technical_signal  — pre-blend technical signal
    """
    fund = getattr(result, "fundamentals", None) or {}
    if not isinstance(fund, dict):
        fund = {}

    trend = getattr(result, "trend", None) or {}
    ma = trend.get("ma", {}) if isinstance(trend, dict) else {}

    ratios = fund.get("section_08_ratios", {}) if isinstance(fund, dict) else {}
    s17 = fund.get("section_17_quarterly_detail", {}) if isinstance(fund, dict) else {}
    qr = fund.get("quick_ratings", {}) if isinstance(fund, dict) else {}

    df = getattr(result, "df", None)
    price = None
    if df is not None and len(df):
        try:
            price = float(df["Close"].iloc[-1])
        except Exception:
            price = None

    atr = getattr(result, "atr", None) or {}
    adx = getattr(result, "adx", None) or {}

    report_text = report_text or ""
    report_nan = len(re.findall(r"\b[Nn][Aa][Nn]\b", report_text))

    checks = {
        "price_ok": price is not None and not is_nan(price) and price > 0,
        "sma_ok": all(not is_nan(ma.get(k)) for k in ("sma20", "sma50", "sma200")),
        "atr_ok": not is_nan(atr.get("atr")) and (atr.get("atr") or 0) > 0,
        "adx_ok": not is_nan(adx.get("adx")),
        "div_sane": _div_sane(ratios.get("dividend_yield")),
        "debt_sane": _debt_sane(ratios.get("debt_to_equity")),
        "nan_ok": report_nan == 0,
    }

    risk_flags = fund.get("section_15_risk", {}).get("risk_flags")

    return {
        "checks": checks,
        "health_pass": all(checks.values()),
        "report_nan": report_nan,
        "report_len": len(report_text),
        "sector": fund.get("section_14_economic_sensitivity", {}).get("sector_classification"),
        "risk_flags": risk_flags,
        "yoy_rev": s17.get("revenue_yoy_growth"),
        "yoy_ni": s17.get("net_income_yoy_growth"),
        "fund_rating": qr.get("screening_rating", "N/A"),
        "quality_gates": list(getattr(result, "quality_gates", []) or []),
        "technical_signal": getattr(result, "technical_signal", None),
    }