"""Technical-domain rules: signal classification + technical convolution.

Both are expressed as :class:`~rules.core.RuleSet`s so every contributing
condition is individually addressable and traced, while producing byte-identical
output to the legacy ``_classify_signal`` / ``_technical_convolution`` methods.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Tuple

from .core import MarketFeatures, Rule, RuleSet

# ──────────────────────────────────────────────────────────────
# classify_signal — additive evidence score (denominator fixed at 100)
# ──────────────────────────────────────────────────────────────
CLASSIFY_GROUP_MAX = {
    "trend": 20, "ma": 15, "rsi": 10, "macd": 10, "adx": 10,
    "volume": 10, "obv": 5, "wyckoff": 10, "fib": 10,
}
CLASSIFY_BUY = 65.0
CLASSIFY_SELL = 35.0

# Degenerate-trade guard constants (2026-09-04).
MIN_STOP_PCT = 1.5
MIN_TARGET_PCT = 1.5
MIN_RR = 1.0


def _macd_bull(macd: Mapping[str, Any]) -> bool:
    return bool(
        (macd.get("crossover") == "Bullish")
        or (
            bool(macd.get("histogram_increasing"))
            and isinstance(macd.get("macd"), (int, float))
            and isinstance(macd.get("signal"), (int, float))
            and macd["macd"] > macd["signal"]
        )
    )


def _fib_score(f: MarketFeatures) -> float:
    fib = f.analysis.get("fib_retracement", {}) or {}
    if not (fib and "levels" in fib):
        return 0.0
    s = 0.0
    for lbl, info in fib["levels"].items():
        if info.get("closest") and lbl in ("61.8%", "78.6%"):
            s += 5
        elif info.get("closest") and lbl in ("38.2%", "23.6%"):
            s -= 3
    return s


def _last_pattern(f: MarketFeatures) -> str:
    return str(f.sub("candlestick").get("last_pattern", ""))


CLASSIFY_RULES: List[Rule] = [
    Rule("trend_up", "technical", "trend", "Uptrend structure (+15)",
         lambda f: 15.0 if "Uptrend" in f.structure else 0.0),
    Rule("trend_down", "technical", "trend", "Downtrend structure (-15)",
         lambda f: -15.0 if "Downtrend" in f.structure else 0.0),
    Rule("ma20", "technical", "ma", "Price above SMA20 (+3)",
         lambda f: 3.0 if f.ma.get("above_20") else 0.0),
    Rule("ma50", "technical", "ma", "Price above SMA50 (+5)",
         lambda f: 5.0 if f.ma.get("above_50") else 0.0),
    Rule("ma200", "technical", "ma", "Price above SMA200 (+7)",
         lambda f: 7.0 if f.ma.get("above_200") else 0.0),
    Rule("rsi_zone", "technical", "rsi", "RSI in 40-60 (+5)",
         lambda f: 5.0 if 40 < f.rsi_value < 60 else 0.0),
    Rule("rsi_oversold", "technical", "rsi", "RSI <= 30 oversold bounce (+8)",
         lambda f: 8.0 if f.rsi_value <= 30 else 0.0),
    Rule("rsi_overbought", "technical", "rsi", "RSI >= 70 overbought (-3)",
         lambda f: -3.0 if f.rsi_value >= 70 else 0.0),
    Rule("macd_cross_bull", "technical", "macd", "MACD bullish crossover (+7)",
         lambda f: 7.0 if f.macd.get("crossover") == "Bullish" else 0.0),
    Rule("macd_hist_inc", "technical", "macd", "MACD histogram increasing (+3)",
         lambda f: 3.0 if f.macd.get("histogram_increasing") else 0.0),
    Rule("adx_strong", "technical", "adx", "ADX > 25 trending (+5)",
         lambda f: 5.0 if f.adx.get("adx", 0) > 25 else 0.0),
    Rule("adx_di_bull", "technical", "adx", "DI bias bullish (+5)",
         lambda f: 5.0 if f.adx.get("di_bias") == "Bullish" else 0.0),
    Rule("adx_di_bear", "technical", "adx", "DI bias bearish (-5)",
         lambda f: -5.0 if f.adx.get("di_bias") == "Bearish" else 0.0),
    Rule("vol_above", "technical", "volume", "Volume above average (+5)",
         lambda f: 5.0 if f.sub("volume").get("status") == "Above Avg" else 0.0),
    Rule("vol_ratio", "technical", "volume", "Up/down volume ratio > 1.5 (+5)",
         lambda f: 5.0 if f.sub("volume").get("up_down_ratio_10d", 0) > 1.5 else 0.0),
    Rule("obv_bull", "technical", "obv", "OBV trend bullish (+5)",
         lambda f: 5.0 if f.sub("obv_raw").get("obv_trend") == "Bullish" else 0.0),
    Rule("wyckoff_bull", "technical", "wyckoff", "Wyckoff Markup/Accumulation (+10)",
         lambda f: 10.0 if f.wyckoff_phase in ("Markup", "Accumulation") else 0.0),
    Rule("wyckoff_bear", "technical", "wyckoff", "Wyckoff Markdown (-10)",
         lambda f: -10.0 if f.wyckoff_phase == "Markdown" else 0.0),
    Rule("fib_zone", "technical", "fib", "Fib support/resistance zone (+5/-3)", _fib_score),
]

CLASSIFY_RULESET = RuleSet(
    "technical", "classify_signal", CLASSIFY_RULES, group_max=CLASSIFY_GROUP_MAX
)


def classify_outcome(f: MarketFeatures):
    """Return the raw :class:`~rules.core.RuleOutcome` (for tracing)."""
    return CLASSIFY_RULESET.evaluate(f)


def classify_signal(
    f: MarketFeatures,
) -> Tuple[str, int, Tuple[float, float], List[float], float]:
    """BUY/SELL/HOLD classification + trade levels (mirrors ``_classify_signal``)."""
    outcome = CLASSIFY_RULESET.evaluate(f)
    score = outcome.total
    max_score = CLASSIFY_RULESET.max_total
    pct = (score + max_score) / (2 * max_score) * 100

    if pct >= CLASSIFY_BUY:
        signal = "BUY"
    elif pct <= CLASSIFY_SELL:
        signal = "SELL"
    else:
        signal = "HOLD"
    confidence = round(pct)

    price = f.price
    a = f.analysis
    sr = a.get("sr_levels", {}) or {}
    entry_low = entry_high = None
    targets: List[float] = []
    invalidation = None

    nearest_res = None
    nearest_sup = None
    for r in reversed(sr.get("resistance", [])):
        if r["price"] > price:
            nearest_res = r["price"]
            break
    for s in reversed(sr.get("support", [])):
        if s["price"] < price:
            nearest_sup = s["price"]
            break

    if signal == "BUY":
        if nearest_res:
            targets = [nearest_res, nearest_res * 1.03, nearest_res * 1.07]
        invalidation = nearest_sup if nearest_sup else price * 0.95
        entry_low = price * 0.98
        entry_high = price
    elif signal == "SELL":
        if nearest_sup:
            targets = [nearest_sup, nearest_sup * 0.97, nearest_sup * 0.93]
        invalidation = nearest_res if nearest_res else price * 1.05
        entry_low = price
        entry_high = price * 1.02
    else:  # HOLD
        entry_low = price * 0.98
        entry_high = price * 1.02
        if nearest_res:
            targets = [nearest_res]
        invalidation = nearest_sup if nearest_sup else price * 0.93

    if not targets:
        targets = ([price * 1.03, price * 1.06, price * 1.10]
                   if signal in ("BUY", "CAUTIOUS BUY")
                   else [price * 0.97, price * 0.94, price * 0.90])
    if not invalidation:
        invalidation = price * 0.95 if signal in ("BUY", "CAUTIOUS BUY") else price * 1.05

    targets, invalidation = _degenerate_guard(signal, price, targets, invalidation, f)
    return signal, confidence, (entry_low, entry_high), targets, invalidation


def _degenerate_guard(signal, price, targets, invalidation, f: MarketFeatures):
    """Enforce min stop/target distance and min R:R so setups are tradeable."""
    atr_pct = f.atr_pct
    if atr_pct is None or not isinstance(atr_pct, (int, float)) or atr_pct <= 0:
        atr_pct = 2.0
    if signal in ("BUY", "CAUTIOUS BUY"):
        stop_floor = price * (1 - max(MIN_STOP_PCT, 1.5 * atr_pct) / 100)
        if invalidation is None or invalidation >= price or invalidation > stop_floor:
            invalidation = stop_floor
        tgt_floor = price * (1 + max(MIN_TARGET_PCT, 2.0 * atr_pct) / 100)
        if not targets or targets[0] is None or targets[0] <= price or targets[0] < tgt_floor:
            targets = [tgt_floor, tgt_floor * 1.03, tgt_floor * 1.07]
        stop_dist = price - invalidation
        tgt_dist = targets[0] - price
        if stop_dist > 0 and tgt_dist / stop_dist < MIN_RR:
            targets[0] = price + stop_dist * MIN_RR
            targets[1] = targets[0] * 1.03
            targets[2] = targets[0] * 1.07
    elif signal == "SELL":
        stop_floor = price * (1 + max(MIN_STOP_PCT, 1.5 * atr_pct) / 100)
        if invalidation is None or invalidation <= price or invalidation < stop_floor:
            invalidation = stop_floor
        tgt_floor = price * (1 - max(MIN_TARGET_PCT, 2.0 * atr_pct) / 100)
        if not targets or targets[0] is None or targets[0] >= price or targets[0] > tgt_floor:
            targets = [tgt_floor, tgt_floor * 0.97, tgt_floor * 0.93]
        stop_dist = invalidation - price
        tgt_dist = price - targets[0]
        if stop_dist > 0 and tgt_dist / stop_dist < MIN_RR:
            targets[0] = price - stop_dist * MIN_RR
            targets[1] = targets[0] * 0.97
            targets[2] = targets[0] * 0.93
    return targets, invalidation


# ──────────────────────────────────────────────────────────────
# technical_convolution — weighted component blend (total weight 100)
#   pattern 30, trend 15, momentum 15, volume 15, candlestick 10,
#   oscillator 10, wyckoff 5.  Each component clamps to +/- its weight;
#   raw total [-100,100] -> 0-100 via 50 + total/2.
# ──────────────────────────────────────────────────────────────
CONV_WEIGHTS = {
    "pattern": 30, "trend": 15, "momentum": 15, "volume": 15,
    "candlestick": 10, "oscillator": 10, "wyckoff": 5,
}


def _pattern_score(f: MarketFeatures) -> float:
    pv = f.pattern_votes or {}
    bull = float(pv.get("bull_weight", 0) or 0)
    bear = float(pv.get("bear_weight", 0) or 0)
    if bull > bear and bull > 0:
        return min(30.0, bull)
    if bear > bull:
        return -min(30.0, bear)
    return 0.0


CONVOLUTION_RULES: List[Rule] = [
    Rule("pattern", "technical", "pattern", "Weighted pattern votes", _pattern_score),
    # trend
    Rule("trend_up", "technical", "trend", "Uptrend (+8)",
         lambda f: 8.0 if "Uptrend" in f.structure else 0.0),
    Rule("trend_down", "technical", "trend", "Downtrend (-8)",
         lambda f: -8.0 if "Downtrend" in f.structure else 0.0),
    Rule("trend_above50", "technical", "trend", "Above SMA50 (+4)",
         lambda f: 4.0 if f.ma.get("above_50") else 0.0),
    Rule("trend_above200", "technical", "trend", "Above SMA200 (+3)",
         lambda f: 3.0 if f.ma.get("above_200") else -3.0),
    # momentum
    Rule("mom_rsi_zone", "technical", "momentum", "RSI 40-65 (+5)",
         lambda f: 5.0 if 40 < f.rsi_value < 65 else 0.0),
    Rule("mom_rsi_oversold", "technical", "momentum", "RSI <= 30 (+3)",
         lambda f: 3.0 if f.rsi_value <= 30 else 0.0),
    Rule("mom_rsi_overbought", "technical", "momentum", "RSI >= 70 (-3)",
         lambda f: -3.0 if f.rsi_value >= 70 else 0.0),
    Rule("mom_macd", "technical", "momentum", "MACD bullish (+6) / bearish (-6)",
         lambda f: 6.0 if _macd_bull(f.macd)
         else (-6.0 if f.macd.get("crossover") == "Bearish" else 0.0)),
    Rule("mom_adx", "technical", "momentum", "ADX > 25 (+2)",
         lambda f: 2.0 if f.adx.get("adx", 0) > 25 else 0.0),
    Rule("mom_di", "technical", "momentum", "DI bias (+/-2)",
         lambda f: 2.0 if f.adx.get("di_bias") == "Bullish"
         else (-2.0 if f.adx.get("di_bias") == "Bearish" else 0.0)),
    # volume
    Rule("vol_status", "technical", "volume", "Vol above avg (+5) / below (-3)",
         lambda f: 5.0 if f.sub("volume").get("status") == "Above Avg"
         else (-3.0 if f.sub("volume").get("status") == "Below Avg" else 0.0)),
    Rule("vol_ratio", "technical", "volume", "Up/down ratio >1.5 (+5) / <0.67 (-5)",
         lambda f: 5.0 if f.sub("volume").get("up_down_ratio_10d", 0) > 1.5
         else (-5.0 if f.sub("volume").get("up_down_ratio_10d", 0) < 0.67 else 0.0)),
    Rule("vol_obv", "technical", "volume", "OBV bullish (+5) / bearish (-5)",
         lambda f: 5.0 if f.sub("obv_raw").get("obv_trend") == "Bullish"
         else (-5.0 if f.sub("obv_raw").get("obv_trend") == "Bearish" else 0.0)),
    # candlestick
    Rule("candle_bull", "technical", "candlestick", "Bullish candle pattern (+3 each)",
         lambda f: 3.0 * sum(p in _last_pattern(f) for p in
                             ("Hammer", "Bullish Engulfing", "Marubozu",
                              "Morning Star", "Piercing Line"))),
    Rule("candle_bear", "technical", "candlestick", "Bearish candle pattern (-3 each)",
         lambda f: -3.0 * sum(p in _last_pattern(f) for p in
                              ("Shooting Star", "Bearish Engulfing", "Hanging Man",
                               "Evening Star", "Dark Cloud Cover"))),
    # oscillator / divergence
    Rule("osc_divergence", "technical", "oscillator", "Divergence (+/-5 each)",
         lambda f: sum(
             5.0 if "Bullish" in str(d.get("type", ""))
             else (-5.0 if "Bearish" in str(d.get("type", "")) else 0.0)
             for d in (f.analysis.get("divergence", []) or []) if isinstance(d, dict))),
    Rule("osc_rsi", "technical", "oscillator", "RSI extreme (+/-3)",
         lambda f: 3.0 if f.rsi_value <= 30
         else (-3.0 if f.rsi_value >= 70 else 0.0)),
    # wyckoff
    Rule("wyckoff", "technical", "wyckoff", "Wyckoff phase (+/-5)",
         lambda f: 5.0 if f.wyckoff_phase in ("Markup", "Accumulation")
         else (-5.0 if f.wyckoff_phase == "Markdown" else 0.0)),
]

CONVOLUTION_RULESET = RuleSet(
    "technical", "technical_convolution", CONVOLUTION_RULES,
    group_clamp=CONV_WEIGHTS,
)


def convolution_outcome(f: MarketFeatures):
    """Return the raw :class:`~rules.core.RuleOutcome` (for tracing)."""
    return CONVOLUTION_RULESET.evaluate(f)


def technical_convolution(f: MarketFeatures) -> Dict[str, Any]:
    """Weighted convolution of patterns, candlesticks and indicators."""
    outcome = CONVOLUTION_RULESET.evaluate(f)
    g = outcome.groups
    total = outcome.total
    pv = f.pattern_votes or {}
    vol = f.sub("volume")
    macd = f.macd
    cs = f.sub("candlestick")

    components = {
        "pattern": {
            "weight": 30, "score": round(g.get("pattern", 0.0), 1),
            "bull_weight": pv.get("bull_weight", 0.0),
            "bear_weight": pv.get("bear_weight", 0.0),
            "patterns": pv.get("patterns", []),
            "majority": pv.get("majority", True),
        },
        "trend": {
            "weight": 15, "score": round(g.get("trend", 0.0), 1),
            "structure": f.structure,
            "above_50": bool(f.ma.get("above_50")),
            "above_200": bool(f.ma.get("above_200")),
        },
        "momentum": {
            "weight": 15, "score": round(g.get("momentum", 0.0), 1),
            "rsi": f.rsi_value, "macd_bullish": _macd_bull(macd),
        },
        "volume": {
            "weight": 15, "score": round(g.get("volume", 0.0), 1),
            "above_avg": vol.get("status") == "Above Avg",
            "up_down_ratio_10d": vol.get("up_down_ratio_10d", 0),
            "obv_bullish": f.sub("obv_raw").get("obv_trend") == "Bullish",
        },
        "candlestick": {
            "weight": 10, "score": round(g.get("candlestick", 0.0), 1),
            "last_pattern": _last_pattern(f),
        },
        "oscillator": {
            "weight": 10, "score": round(g.get("oscillator", 0.0), 1),
            "divergences": len(f.analysis.get("divergence", []) or []),
        },
        "wyckoff": {
            "weight": 5, "score": round(g.get("wyckoff", 0.0), 1),
            "phase": f.wyckoff_phase,
        },
    }
    score = max(0.0, min(100.0, 50 + total / 2))
    return {
        "score": round(score, 1),
        "raw_total": round(total, 1),
        "components": components,
        "pattern_votes": pv,
        "pattern_majority": pv.get("majority", True),
    }
