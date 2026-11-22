"""
Chart Pattern Detection & Backtest Engine — Python port of frontend/lib/patterns.ts

Detects chart patterns from OHLCV data with multi-confirmation rules.
Simulates trades with SL/TP/breakeven logic for backtesting.
"""

import math
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# ── Constants ──

MIN_CONFIDENCE = 85
MIN_RR = 1.5
# Geometry tolerances below are DESIGN CHOICES tuned for NSE daily bars, not
# measured statistics — they define when anatomy counts, they claim no edge.
PEAK_EQUALITY_PCT = 0.05     # double/triple tops+bottoms: peaks/troughs within
                             # ±5% count as equal (classical tolerance, wide
                             # enough for NSE daily noise)
FLAG_POLE_MIN_PCT = 0.05     # flag pole must travel >=5%; smaller moves are
                             # indistinguishable from ordinary swings
TRIANGLE_MIN_TOUCHES = 4     # >=2 touches per boundary: classical minimum for
                             # a line to count as tested
CUP_MIN_BARS = 20            # shorter "cups" are V-pullbacks, not bases

# R14 repair: the old geometry (stop = level ±5%, target = 1.5× height) made
# RR ≥ 1.5 algebraically unreachable — max possible RR was 1.5h/(h+0.05P) < 1.5,
# so 8 of 10 detectors could NEVER emit a pattern. New scheme:
#   - tight structural stop cushion (1%) instead of 5%
#   - continuation targets project 2.0× formation height
#   - reversal targets use the classical 1.0× measured move and are gated on a
#     relaxed RR floor (their edge is win-rate, not large R multiples)
STOP_CUSHION_PCT = 0.01
TARGET_MULT_CONTINUATION = 2.0
# Rising wedge entry-model rework (post-F2 investigation trail):
#
# Break entry (shorting the breakdown bar), 30-ticker sweep, 5y:
#   target 1.25x -> -0.29R (n=164) | 1.5x -> -0.32R (n=243)
#   target 1.75x -> -0.40R (n=322) | 2.0x -> -0.39R (n=350)
#   -> geometry is not the problem; entry timing is.
# Retest entry (pullback to the broken line's underside), same universe:
#   target 1.0x -> +0.106R (n=47)  | 1.5x -> -0.27R (n=106)
#   target 2.0x -> -0.29R (n=137)
#   -> only positive configuration found. Holdout split (60/40):
#   IS -0.168R (n=26) vs OOS +0.402R (n=23) — directional confirmation,
#   but the edge is concentrated in the recent regime and the sample is
#   thin. Adopted as the experimental default; graduation DEFERRED until a
#   fresh calibration cycle confirms >= +0.10R with combined n >= 50.
RISING_WEDGE_TARGET_MULT = 1.0
RISING_WEDGE_ENTRY_MODE = "retest"
TARGET_MULT_REVERSAL = 1.0
REVERSAL_PATTERNS = {
    "head_and_shoulders",
    "inverse_head_and_shoulders",
    "double_top",
    "double_bottom",
    "triple_top",
    "triple_bottom",
    "rounding_top",
    "rounding_bottom",
    "island_reversal",
}
REVERSAL_MIN_RR = 0.8

# R10 repair: trend-alignment filter applies only to continuation patterns.
# Reversal patterns form AGAINST the prevailing trend by definition.
CONTINUATION_PATTERNS = {
    "bull_flag",
    "bear_flag",
    "ascending_triangle",
    "descending_triangle",
    "cup_and_handle",
    "rising_wedge",
    "symmetrical_triangle",
}

# R4 repair: minimum bars between entries of the same pattern type+direction,
# preventing one formation from generating a cluster of correlated trades.
PATTERN_COOLDOWN_BARS = 20


def _round_half_up(x: float) -> int:
    """JS-compatible rounding (halves toward +∞) for TS↔PY parity.

    Python's built-in round() uses banker's rounding; confidence thresholds sit
    exactly on integer boundaries, so the two engines could disagree."""
    return int(math.floor(x + 0.5))


def _rr_floor_for(pattern_type: str, min_rr: float) -> float:
    """Effective RR floor: reversals use the relaxed classical floor."""
    return REVERSAL_MIN_RR if pattern_type in REVERSAL_PATTERNS else min_rr


# Per-pattern reliability weights — RECALIBRATED post Phase R.
# Source: scripts/calibrate_reliability.py over 11 liquid NSE names, 5Y daily
# bars (artifact: scripts/reliability_calibration.json). Weights are RANKING
# priors only; gating uses the uniform MIN_CONFIDENCE rule in detect_patterns.
#   bear_flag:          0W/17L on target hits, n=18           -> 0.70 (zero-win guard)
#   bull_flag:          32.7% WR [22,46], -0.19R/trade, n=106 -> 0.90
#   cup_and_handle:     40.0% WR [26,56], -0.09R/trade, n=50  -> 0.90
#   falling_wedge:      34.5% WR [23,48], +0.50R/trade, n=96  -> 1.15 (validated)
#   head_and_shoulders: 0W/26L on target hits, n=28           -> 0.70 (zero-win guard)
#   asc/desc triangle, inverse H&S: n<15 samples              -> omitted (1.00 default)
# ── Phase Q Quality Pass (2026-08-24): consolidated evidence trail ────────────
# Q1 BEHAVIORAL CONSISTENCY
#   Mandatory-break + 2xATR14-freshness gates on bull/bear flag, asc/desc
#   triangle, falling wedge, cup & handle — forming paths removed (a
#   continuation pattern IS the trade). detect_patterns gained opt-in
#   regime_filter (R10 parity with simulate_trades) and dedup (emission
#   memory, 20-bar cooldown); production paths wired, sim/calibration
#   defaults untouched so measured populations stayed comparable.
# Q2 INDICATOR QUALITY
#   _atr: simple TR mean -> Wilder smoothing (SMA-14 seed + recursion,
#   deterministic short-window fallback). Measured drift on 30 NSE tickers
#   x 5y: ATR14 mean 6.6% (p95 17%, max 67% on spike bars); sim volatility-
#   filter verdict flips 0.81%. TS atr14 mirrors operation-for-operation.
#   ADX already Wilder-smoothed (R9); 2-bar fractal swings retained by design.
# Q3 CHECKLIST HONESTY
#   volume_above_1_5x_avg_on_break is MEASURED (never echoed from the break
#   fact); IHNS decline semantics fixed (rs<ls was inverted); neckline facts
#   type-scoped via _NECKLINE_PATTERNS; preceding_trend_confirmed computed
#   (continuations True, reversals until proven False); dead builder params
#   removed; type-only neckline_slope confidence boost deleted. Double/triple
#   detectors emit measured break-bar checklists of their own.
# Q4 STATISTICAL HARDENING
#   FAILURE_MODES invented probability priors deleted; _estimate_failure_risk
#   returns {} until a calibrated model exists (UI renders honest absence).
#   Constants provenance sweep complete; _round_half_up JS-parity audit PASS.
# Q5 CLOSEOUT
#   E2E smoke through run_pattern_backtest -> Pydantic API models on live
#   data: all phase contracts hold (live detections are sparse BY DESIGN
#   post-gates: 1 across a 12-ticker universe). Cross-engine parity audit
#   caught triple_top/rising_wedge weights that were derived but never wired
#   into this dict — now adopted (see entries below).
#   Calibration artifact: scripts/reliability_calibration.json — regenerated
#   at every phase checkpoint; weights stable Q2->Q5.

PATTERN_RELIABILITY: Dict[str, float] = {
    # Weights recalibrated AFTER the Q1 quality pass (mandatory-break +
    # 2xATR-freshness gates on the six continuation detectors). The gates
    # collapsed several populations because junk signals no longer fire:
    # weights measured on pre-Q1 populations were retired to defaults where
    # n < 15 (the old numbers described setups that can no longer be emitted).
    # Source: scripts/calibrate_reliability.py --experimental --years 5,
    # artifact scripts/reliability_calibration.json (2026-08-24).
    "bear_flag": 1.00,             # Q1: n=3 insufficient; was 0.65 on dead population
    "bull_flag": 1.00,             # Q1: n=10 insufficient; was 0.90 pre-gate
    "cup_and_handle": 0.90,        # 42.1% WR [23,64], -0.13R/trade, n=22
    "falling_wedge": 1.15,         # 30.2% WR [19,45], +0.45R/trade, n=78 (now evidenced)
    "head_and_shoulders": 0.80,    # WATCHLIST: 41.2% WR [22,64], -0.36R/trade, n=28
    "descending_triangle": 1.00,   # insufficient data (n=3)
    # Phases 1-5 graduates (calibrated with --experimental, n >= 15):
    # symmetrical_triangle: ST autopsy (scripts/symtri_diagnostics.py, 2026-08-24)
    # exhausted every entry-model lever on 30-ticker x 5y daily data: retest
    # entry FAILS (-0.25R, pullbacks continue through the line — opposite of
    # rising_wedge), target sweep confirms k=2.0 already optimal, shorts lose
    # in every height band (-0.17..-0.65R), extreme heights lose in every
    # direction, and the best surviving cell (bullish, 5-15% height) prints
    # +0.004R over n=179 — zero edge. Losses average -1.24R (gap-through-stop).
    # No configuration adopted: selecting bullish/mid-band post-hoc would be
    # in-sample mining (same standard applied to rising_wedge graduation).
    # Weight stays at the mechanical tier for -0.15R.
    "symmetrical_triangle": 0.90,  # 27.6% WR [23,33], -0.18R/trade, n=405
    "triple_top": 0.65,            # 8.3% WR [1,35], -0.73R/trade, n=15
    # Q5 parity audit catch: this weight was derived post-F2 but never wired
    # into the dict — the engine silently ranked triple_top at default 1.0.
    # Experimental-gated, so production is unaffected; future calibrations
    # now rank it honestly.
    "rising_wedge": 1.10,          # retest@1.0x: +0.25R/trade, n=16 (EXPERIMENTAL)
    # triple_bottom: 1.00 (default) — 47.8% WR [29,67], +0.04R/trade, n=24
}

# ── Backtest-validated performance filters (NSE 10,162 trades) ──

FILTERS = {
    "volume_break": {"threshold": 1.5, "wr_boost": 5.3, "conf_boost": 15},
    "rr_minimum": {"threshold": 2.0, "wr_boost": 4.1, "conf_boost": 10},
    "neckline_slope": {"threshold": 10, "wr_boost": 3.8, "conf_boost": 10},
    "adx_filter": {"threshold": 25, "wr_boost": 4.5, "conf_boost": 10},
    "trend_context": {"wr_boost": 2.9, "conf_boost": 8},
    "pattern_symmetry": {"threshold": 0.10, "wr_boost": 2.2, "conf_boost": 15},
}

TIMEFRAME_MULTIPLIERS = {
    "daily": 1.0,
    "weekly": 1.15,
    "monthly": 1.35,
}

ENTRY_CHECKLIST = [
    "valid_pattern_structure",
    "neckline_clearly_identifiable",
    "volume_declining_on_right_shoulder",
    "neckline_break_on_closing_basis",
    "volume_above_1_5x_avg_on_break",
    "rr_above_2_0",
    "preceding_trend_confirmed",
    "higher_timeframe_aligns",
    "adx_above_25",
    "no_major_news_next_48h",
]

# Q4 repair: the old FAILURE_MODES table assigned invented per-mode
# probabilities (0.28/0.24/...) to every pattern — H&S-specific mode names
# stamped onto cups and flags, rendered to users as color-coded probability
# bars. No calibrated failure-mode model exists, so per Q3's honesty contract
# the risk map stays EMPTY until one is built from measured outcome data.


@dataclass
class SwingPoint:
    time: str
    price: float


@dataclass
class Candle:
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class DetectedPattern:
    type: str
    direction: str  # "bullish" | "bearish"
    confidence: int
    entry: Optional[float]
    stop_loss: Optional[float]
    target: Optional[float]
    risk_reward: Optional[float]
    confirmations: List[str] = field(default_factory=list)
    status: str = "forming"
    confidence_breakdown: Dict[str, int] = field(default_factory=dict)
    entry_checklist: Dict[str, bool] = field(default_factory=dict)
    failure_risk: Dict[str, float] = field(default_factory=dict)
    multi_tf_boost: float = 1.0
    timeframe: str = "daily"


@dataclass
class TradeRecord:
    pattern_type: str
    direction: str
    confidence: int
    entry_date: str
    entry_price: float
    stop_loss: float
    target: float
    exit_date: str
    exit_price: float
    r_multiple: float
    bars_held: int
    result: str  # "win" | "loss" | "scratch"
    trend_at_entry: str  # "uptrend" | "downtrend" | "neutral"
    confidence_breakdown: Dict[str, int] = field(default_factory=dict)
    entry_checklist: Dict[str, bool] = field(default_factory=dict)
    failure_risk: Dict[str, float] = field(default_factory=dict)
    multi_tf_boost: float = 1.0
    timeframe: str = "daily"


# ── Utility Helpers ──

def _idx(candles: List[Candle], time: str) -> int:
    for i, c in enumerate(candles):
        if c.time == time:
            return i
    return -1


def _interpolate(p1: SwingPoint, p2: SwingPoint, target_time: str, candles: List[Candle]) -> Optional[float]:
    i1 = _idx(candles, p1.time)
    i2 = _idx(candles, p2.time)
    iT = _idx(candles, target_time)
    if i1 < 0 or i2 < 0 or iT < 0 or i2 == i1:
        return None
    return p1.price + ((p2.price - p1.price) * (iT - i1)) / (i2 - i1)


def _swings_between(swings: List[SwingPoint], from_time: str, to_time: str) -> List[SwingPoint]:
    return [s for s in swings if s.time >= from_time and s.time <= to_time]


def _min_swing_between(swings: List[SwingPoint], from_time: str, to_time: str) -> Optional[SwingPoint]:
    in_range = _swings_between(swings, from_time, to_time)
    return min(in_range, key=lambda s: s.price) if in_range else None


def _max_swing_between(swings: List[SwingPoint], from_time: str, to_time: str) -> Optional[SwingPoint]:
    in_range = _swings_between(swings, from_time, to_time)
    return max(in_range, key=lambda s: s.price) if in_range else None


def _avg_volume(candles: List[Candle], from_idx: int, to_idx: int) -> float:
    start = max(0, from_idx)
    end = min(to_idx, len(candles) - 1)
    if start > end:
        return 0.0
    return sum(candles[i].volume for i in range(start, end + 1)) / (end - start + 1)


def _calc_rr(entry: Optional[float], sl: Optional[float], tgt: Optional[float]) -> Optional[float]:
    if entry is None or sl is None or tgt is None or entry == sl:
        return None
    return abs((tgt - entry) / (entry - sl))


def _calc_status(candles: List[Candle], end_idx: int, entry: Optional[float],
                  stop_loss: Optional[float], target: Optional[float],
                  direction: str) -> Tuple[str, Optional[float], Optional[float]]:
    """Chronological first-hit status (R12 repair).

    The old version accumulated stop/target hits independently across all
    future bars and let target win — a trade that stopped out on bar 3 but
    touched target on bar 40 was reported 'completed'. Now the FIRST level
    touched (stop checked before target within a bar, conservatively) decides."""
    if entry is None:
        return "forming", None, None
    for i in range(end_idx + 1, len(candles)):
        c = candles[i]
        if direction == "bullish":
            if stop_loss is not None and c.low <= stop_loss:
                return "failed", None, entry
            if target is not None and c.high >= target:
                return "completed", None, entry
        else:
            if stop_loss is not None and c.high >= stop_loss:
                return "failed", None, entry
            if target is not None and c.low <= target:
                return "completed", None, entry
    return "active", None, entry


# ── Swing Point Detection (2-bar confirmation) ──

def find_swing_points(candles: List[Candle]) -> Tuple[List[SwingPoint], List[SwingPoint]]:
    highs: List[SwingPoint] = []
    lows: List[SwingPoint] = []
    for i in range(2, len(candles) - 2):
        if (candles[i].high > candles[i - 1].high and candles[i].high > candles[i - 2].high
                and candles[i].high >= candles[i + 1].high and candles[i].high >= candles[i + 2].high):
            highs.append(SwingPoint(time=candles[i].time, price=candles[i].high))
        if (candles[i].low < candles[i - 1].low and candles[i].low < candles[i - 2].low
                and candles[i].low <= candles[i + 1].low and candles[i].low <= candles[i + 2].low):
            lows.append(SwingPoint(time=candles[i].time, price=candles[i].low))
    return highs, lows


# ── Indicator Helpers ──

def _tr(candles: List[Candle], i: int) -> float:
    """True Range of bar i (requires i >= 1)."""
    return max(
        candles[i].high - candles[i].low,
        abs(candles[i].high - candles[i - 1].close),
        abs(candles[i].low - candles[i - 1].close),
    )


def _atr(candles: List[Candle], idx: int, period: int = 14) -> float:
    """Wilder-smoothed Average True Range (Q2 repair).

    The previous implementation returned a simple mean of the last `period`
    true ranges — every bar weighted equally, so a single spike kept distorting
    the average for exactly `period` bars before vanishing discontinuously.
    Wilder's recursive smoothing (seed = SMA of first `period` TRs, then
    atr = (prev*(period-1) + tr) / period) decays spikes exponentially and is
    the industry-standard definition every other tool assumes.

    Fallback: when fewer than `period` true ranges exist up to `idx`, there is
    no seed window — return the simple mean of available TRs (the old
    behavior) so short windows stay deterministic. Mirrored in TS atr14().
    """
    if idx < 1:
        return 0.0
    if idx < period:
        total = sum(_tr(candles, i) for i in range(1, idx + 1))
        return total / idx

    # Seed: simple mean of the first `period` TRs (bars 1..period), then
    # Wilder recursion forward to idx. Anchored at series start: every caller
    # passes a bounded window (<= ~61 bars), so results are reproducible.
    atr = sum(_tr(candles, i) for i in range(1, period + 1)) / period
    for i in range(period + 1, idx + 1):
        atr = (atr * (period - 1) + _tr(candles, i)) / period
    return atr


def _sma(candles: List[Candle], idx: int, period: int) -> float:
    start = idx - period + 1
    if start < 0:
        return -1.0
    return sum(candles[i].close for i in range(start, idx + 1)) / period


def _dx_from(pdm: float, mdm: float, tr: float) -> float:
    if tr <= 0:
        return 0.0
    plus_di = pdm / tr * 100
    minus_di = mdm / tr * 100
    di_sum = plus_di + minus_di
    if di_sum <= 0:
        return 0.0
    return abs(plus_di - minus_di) / di_sum * 100


def _adx(candles: List[Candle], idx: int, period: int = 14) -> float:
    """Average Directional Index with proper Wilder smoothing (R9 repair).

    The previous implementation returned single-period DX computed from simple
    averages — far noisier than true ADX. Requires ~3× period bars of history;
    returns 0.0 when insufficient data is available."""
    warmup = period * 3
    start = max(1, idx - warmup)
    if idx - start < period * 2:
        return 0.0

    tr_wild = 0.0
    pdm_wild = 0.0
    mdm_wild = 0.0
    dx_values: List[float] = []

    for i in range(start + 1, idx + 1):
        tr = max(
            candles[i].high - candles[i].low,
            abs(candles[i].high - candles[i - 1].close),
            abs(candles[i].low - candles[i - 1].close),
        )
        up_move = candles[i].high - candles[i - 1].high
        down_move = candles[i - 1].low - candles[i].low
        plus_dm = up_move if (up_move > down_move and up_move > 0) else 0.0
        minus_dm = down_move if (down_move > up_move and down_move > 0) else 0.0

        if i <= start + period:
            # Seed: simple sum over the first `period` intervals
            tr_wild += tr
            pdm_wild += plus_dm
            mdm_wild += minus_dm
            if i == start + period:
                dx_values.append(_dx_from(pdm_wild, mdm_wild, tr_wild))
        else:
            # Wilder smoothing: prev − prev/period + current
            tr_wild = tr_wild - tr_wild / period + tr
            pdm_wild = pdm_wild - pdm_wild / period + plus_dm
            mdm_wild = mdm_wild - mdm_wild / period + minus_dm
            dx_values.append(_dx_from(pdm_wild, mdm_wild, tr_wild))

    if len(dx_values) < period:
        return 0.0
    adx_val = sum(dx_values[:period]) / period
    for dx in dx_values[period:]:
        adx_val = (adx_val * (period - 1) + dx) / period
    return adx_val


def _neckline_slope_deg(t1: SwingPoint, t2: SwingPoint) -> float:
    """Approximate neckline slope in degrees from price change."""
    if t1.price == 0:
        return 0.0
    return abs((t2.price - t1.price) / t1.price) * 100


# ── Pattern Detectors ──

def _detect_hns(candles: List[Candle], swing_highs: List[SwingPoint],
                swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Head & Shoulders Top — bearish reversal pattern.

    Anatomy: Left Shoulder (peak) → Head (higher peak) → Right Shoulder (lower peak)
    Neckline connects the two pullback troughs. Break below neckline confirms.
    """
    if len(swing_highs) < 3 or len(swing_lows) < 2:
        return None

    recent_highs = swing_highs[-7:]
    recent_lows = swing_lows[-7:]

    for i in range(len(recent_highs) - 2):
        ls = recent_highs[i]
        hd = recent_highs[i + 1]
        rs = recent_highs[i + 2]

        if hd.price <= ls.price or hd.price <= rs.price:
            continue
        if not (ls.time < hd.time < rs.time):
            continue

        shoulder_avg = (ls.price + rs.price) / 2
        shoulder_diff = abs(ls.price - rs.price) / shoulder_avg
        if shoulder_diff > 0.10:
            continue

        t1 = _min_swing_between(swing_lows, ls.time, hd.time)
        t2 = _min_swing_between(swing_lows, hd.time, rs.time)
        if not t1 or not t2:
            continue
        if t1.price <= 0 or t2.price <= 0:
            continue

        neck_at_rs = _interpolate(t1, t2, rs.time, candles)
        latest = candles[-1]
        neck_at_latest = _interpolate(t1, t2, latest.time, candles)
        if neck_at_rs is None or neck_at_latest is None:
            continue

        break_idx = _idx(candles, rs.time)
        broke_below = False
        break_bar = -1
        for j in range(max(0, break_idx), len(candles)):
            nv = _interpolate(t1, t2, candles[j].time, candles)
            if nv is not None and candles[j].close < nv and candles[j].low < nv:
                broke_below = True
                break_bar = j
                break

        score = 0
        confs: List[str] = []

        sym_score = 20 * (1 - shoulder_diff / 0.10)
        score += max(0, _round_half_up(sym_score))
        if shoulder_diff < 0.03:
            confs.append("Shoulders symmetrical (±3%)")
        elif shoulder_diff < 0.05:
            confs.append("Shoulders symmetrical (±5%)")

        head_height = (hd.price - min(t1.price, t2.price)) / hd.price
        if 0.03 < head_height < 0.25:
            score += 20
            confs.append("Head height ≥3% above neckline")
        elif head_height > 0.02:
            score += 10

        ls_idx = _idx(candles, ls.time)
        hd_idx = _idx(candles, hd.time)
        rs_idx = _idx(candles, rs.time)
        ls_vol = _avg_volume(candles, max(0, ls_idx - 2), ls_idx + 2)
        hd_vol = _avg_volume(candles, max(0, hd_idx - 2), hd_idx + 2)
        rs_vol = _avg_volume(candles, max(0, rs_idx - 2), rs_idx + 2)

        if ls_vol > hd_vol > rs_vol:
            score += 20
            confs.append("Volume declining left→head→right shoulder")
        elif ls_vol > rs_vol:
            score += 8
            confs.append("Volume lower on right shoulder")

        if broke_below:
            break_pct = (neck_at_rs - candles[break_bar].close) / neck_at_rs
            if break_pct > 0.03:
                score += 20
                confs.append("Neckline break >3%")
            elif break_pct > 0.01:
                score += 12
                confs.append("Neckline break confirmed")
            else:
                score += 8
            vol_20 = _avg_volume(candles, max(0, break_bar - 20), break_bar)
            if vol_20 > 0 and candles[break_bar].volume > vol_20 * 1.5:
                score += FILTERS["volume_break"]["conf_boost"]
                confs.append("Volume >1.5× avg on break")
        else:
            pct_above = (latest.close - neck_at_latest) / neck_at_latest
            if pct_above < 0.01:
                score += 4

        slope = _neckline_slope_deg(t1, t2)
        if slope < 1.0:
            score += 10
            confs.append("Neckline nearly flat")
        elif slope < 3.0:
            score += 5

        width = rs_idx - ls_idx if ls_idx >= 0 and rs_idx >= 0 else 0
        if width >= 30:
            score += 10
            confs.append("Pattern spans 30+ bars")
        elif width >= 15:
            score += 5

        adx_val = _adx(candles, len(candles) - 1, 14)
        if adx_val > 25:
            score += FILTERS["adx_filter"]["conf_boost"]
            confs.append(f"ADX {adx_val:.0f} >25 (trending)")

        ma50 = _sma(candles, len(candles) - 1, 50)
        if ma50 > 0 and latest.close < ma50:
            score += FILTERS["trend_context"]["conf_boost"]
            confs.append("Price below MA50 (downtrend context)")

        confidence = min(_round_half_up(score), 100)
        if confidence < MIN_CONFIDENCE:
            continue

        # R14 repair: classical 1.0× measured-move target + tight 1% structural
        # stop. The old 1.5×/5% geometry made RR ≥ 1.5 algebraically impossible
        # (max achievable ≈ 1.5h/(h+0.05P) < 1.5), so this detector could never
        # emit a pattern. Reversals are gated on the relaxed floor downstream.
        pattern_height = hd.price - neck_at_rs
        measured_target = neck_at_rs - pattern_height * TARGET_MULT_REVERSAL

        entry_price = candles[break_bar].close if broke_below else None
        stop_price = max(rs.price, hd.price) * (1 + STOP_CUSHION_PCT)
        target_price = measured_target if measured_target > 0 else None
        rr = _calc_rr(entry_price, stop_price, target_price)

        conf_breakdown: Dict[str, int] = {}
        if "Shoulders symmetrical" in " ".join(confs):
            conf_breakdown["pattern_symmetry"] = FILTERS["pattern_symmetry"]["conf_boost"]
        if any("Volume >1.5×" in c for c in confs):
            conf_breakdown["volume_break"] = FILTERS["volume_break"]["conf_boost"]
        if any("ADX" in c for c in confs):
            conf_breakdown["adx_filter"] = FILTERS["adx_filter"]["conf_boost"]
        if any("neckline" in c.lower() and "flat" in c.lower() for c in confs):
            conf_breakdown["neckline_slope"] = FILTERS["neckline_slope"]["conf_boost"]
        if rr is not None and rr >= 2.0:
            conf_breakdown["rr_minimum"] = FILTERS["rr_minimum"]["conf_boost"]
        if any("downtrend" in c.lower() for c in confs):
            conf_breakdown["trend_context"] = FILTERS["trend_context"]["conf_boost"]

        pattern = DetectedPattern(
            type="head_and_shoulders", direction="bearish", confidence=confidence,
            entry=entry_price, stop_loss=stop_price, target=target_price,
            risk_reward=rr, confirmations=confs,
        )
        pattern.confidence_breakdown = conf_breakdown  # type: ignore
        pattern.entry_checklist = _build_entry_checklist(
            broke_below, ls_vol > rs_vol, True, rr, adx_val,
            vol_break_measured=any("Volume >1.5×" in c for c in confs),
            has_neckline=True,
        )  # type: ignore
        pattern.failure_risk = _estimate_failure_risk(confidence, rr)  # type: ignore
        return pattern

    return None


def _detect_ihns(candles: List[Candle], swing_highs: List[SwingPoint],
                  swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Inverse Head & Shoulders Bottom — bullish reversal pattern.

    Anatomy: Left Shoulder (trough) → Head (lower trough) → Right Shoulder (higher trough)
    Neckline connects the two bounce peaks. Break above neckline confirms.
    """
    if len(swing_highs) < 2 or len(swing_lows) < 3:
        return None

    recent_lows = swing_lows[-7:]
    recent_highs = swing_highs[-7:]

    for i in range(len(recent_lows) - 2):
        ls = recent_lows[i]
        hd = recent_lows[i + 1]
        rs = recent_lows[i + 2]

        if hd.price >= ls.price or hd.price >= rs.price:
            continue
        if not (ls.time < hd.time < rs.time):
            continue

        shoulder_avg = (ls.price + rs.price) / 2
        shoulder_diff = abs(ls.price - rs.price) / shoulder_avg
        if shoulder_diff > 0.10:
            continue

        n1 = _max_swing_between(recent_highs, ls.time, hd.time)
        n2 = _max_swing_between(recent_highs, hd.time, rs.time)
        if not n1 or not n2:
            continue

        neck_at_rs = _interpolate(n1, n2, rs.time, candles)
        latest = candles[-1]
        neck_at_latest = _interpolate(n1, n2, latest.time, candles)
        if neck_at_rs is None or neck_at_latest is None:
            continue

        break_idx = _idx(candles, rs.time)
        broke_above = False
        break_bar = -1
        for j in range(max(0, break_idx), len(candles)):
            nv = _interpolate(n1, n2, candles[j].time, candles)
            if nv is not None and candles[j].close > nv and candles[j].high > nv:
                broke_above = True
                break_bar = j
                break

        score = 0
        confs: List[str] = []

        sym_score = 20 * (1 - shoulder_diff / 0.10)
        score += max(0, _round_half_up(sym_score))
        if shoulder_diff < 0.03:
            confs.append("Shoulders symmetrical (±3%)")
        elif shoulder_diff < 0.05:
            confs.append("Shoulders symmetrical (±5%)")

        head_depth = (max(n1.price, n2.price) - hd.price) / hd.price
        if 0.03 < head_depth < 0.25:
            score += 20
            confs.append("Head depth ≥3% below neckline")
        elif head_depth > 0.02:
            score += 10

        ls_idx = _idx(candles, ls.time)
        hd_idx = _idx(candles, hd.time)
        rs_idx = _idx(candles, rs.time)
        ls_vol = _avg_volume(candles, max(0, ls_idx - 2), ls_idx + 2)
        hd_vol = _avg_volume(candles, max(0, hd_idx - 2), hd_idx + 2)
        rs_vol = _avg_volume(candles, max(0, rs_idx - 2), rs_idx + 2)
        avg_vol = _avg_volume(candles, max(0, ls_idx - 5), rs_idx + 2)

        if hd_vol > avg_vol * 1.2 or rs_vol > avg_vol * 1.2:
            score += 15
            confs.append("Volume elevated on head or right shoulder (accumulation)")

        if broke_above:
            break_pct = (candles[break_bar].close - neck_at_rs) / neck_at_rs
            if break_pct > 0.03:
                score += 25
                confs.append("Neckline break >3%")
            elif break_pct > 0.01:
                score += 15
                confs.append("Neckline break confirmed")
            else:
                score += 10
            vol_20 = _avg_volume(candles, max(0, break_bar - 20), break_bar)
            if vol_20 > 0 and candles[break_bar].volume > vol_20 * 1.5:
                score += FILTERS["volume_break"]["conf_boost"]
                confs.append("Volume >1.5× avg on break")
        else:
            pct_below = (neck_at_latest - latest.close) / neck_at_latest
            if pct_below < 0.01:
                score += 5

        slope = _neckline_slope_deg(n1, n2)
        if slope < 1.0:
            score += 10
            confs.append("Neckline nearly flat")
        elif slope < 3.0:
            score += 5

        width = rs_idx - ls_idx if ls_idx >= 0 and rs_idx >= 0 else 0
        if width >= 30:
            score += 10
            confs.append("Pattern spans 30+ bars")
        elif width >= 15:
            score += 5

        adx_val = _adx(candles, len(candles) - 1, 14)
        if adx_val > 25:
            score += FILTERS["adx_filter"]["conf_boost"]
            confs.append(f"ADX {adx_val:.0f} >25 (trending)")

        ma50 = _sma(candles, len(candles) - 1, 50)
        if ma50 > 0 and latest.close > ma50:
            score += FILTERS["trend_context"]["conf_boost"]
            confs.append("Price above MA50 (uptrend context)")

        confidence = min(_round_half_up(score), 100)
        if confidence < MIN_CONFIDENCE:
            continue

        # R14 repair (mirror of H&S fix)
        pattern_height = neck_at_rs - hd.price
        measured_target = neck_at_rs + pattern_height * TARGET_MULT_REVERSAL

        entry_price = candles[break_bar].close if broke_above else None
        stop_price = min(rs.price, hd.price) * (1 - STOP_CUSHION_PCT)
        target_price = measured_target if measured_target > 0 else None
        rr = _calc_rr(entry_price, stop_price, target_price)

        conf_breakdown: Dict[str, int] = {}
        if "Shoulders symmetrical" in " ".join(confs):
            conf_breakdown["pattern_symmetry"] = FILTERS["pattern_symmetry"]["conf_boost"]
        if any("Volume >1.5×" in c for c in confs):
            conf_breakdown["volume_break"] = FILTERS["volume_break"]["conf_boost"]
        if any("ADX" in c for c in confs):
            conf_breakdown["adx_filter"] = FILTERS["adx_filter"]["conf_boost"]
        if any("neckline" in c.lower() and "flat" in c.lower() for c in confs):
            conf_breakdown["neckline_slope"] = FILTERS["neckline_slope"]["conf_boost"]
        if rr is not None and rr >= 2.0:
            conf_breakdown["rr_minimum"] = FILTERS["rr_minimum"]["conf_boost"]
        if any("uptrend" in c.lower() for c in confs):
            conf_breakdown["trend_context"] = FILTERS["trend_context"]["conf_boost"]

        pattern = DetectedPattern(
            type="inverse_head_and_shoulders", direction="bullish", confidence=confidence,
            entry=entry_price, stop_loss=stop_price, target=target_price,
            risk_reward=rr, confirmations=confs,
        )
        pattern.confidence_breakdown = conf_breakdown  # type: ignore
        # D2 fix: the old call passed volume EXPANSION (rs biggest) into the
        # "declining" field. Report the measured truth: decline = rs < ls.
        pattern.entry_checklist = _build_entry_checklist(
            broke_above, rs_vol < ls_vol, True, rr, adx_val,
            vol_break_measured=any("Volume >1.5×" in c for c in confs),
            has_neckline=True,
        )  # type: ignore
        pattern.failure_risk = _estimate_failure_risk(confidence, rr)  # type: ignore
        return pattern

    return None


# Patterns whose anatomy defines a neckline (Q3: neckline facts are
# type-scoped — a bull flag has no neckline to identify).
_NECKLINE_PATTERNS = {
    "head_and_shoulders", "inverse_head_and_shoulders",
    "double_top", "double_bottom", "triple_top", "triple_bottom",
}


def _build_entry_checklist(broke: bool, vol_declining: bool, structure_valid: bool,
                           rr: Optional[float], adx: float, *,
                           vol_break_measured: Optional[bool] = None,
                           has_neckline: bool = False,
                           preceding_trend: bool = False) -> Dict[str, bool]:
    """Build institutional entry checklist status from pattern attributes.

    Q3 honesty contract (extends R8): every field is either a MEASURED fact or
    explicitly False. Weaker facts are never echoed into stronger claims —
    in particular a breakout says nothing about breakout volume.
    """
    return {
        "valid_pattern_structure": structure_valid,
        "neckline_clearly_identifiable": has_neckline,
        "volume_declining_on_right_shoulder": bool(vol_declining),
        "neckline_break_on_closing_basis": bool(broke),
        # D1 fix: was `bool(broke)` — a break echoed as a volume measurement.
        # Now only a real 1.5x-avg comparison sets this; None (not measured) → False.
        "volume_above_1_5x_avg_on_break": bool(vol_break_measured),
        "rr_above_2_0": rr is not None and rr >= 2.0,
        # Continuation patterns ARE the preceding trend (detector-verified
        # pole/channel); reversals must prove it separately → False until then.
        "preceding_trend_confirmed": preceding_trend,
        "higher_timeframe_aligns": False,     # unknowable from price data
        "adx_above_25": adx > 25,
        "no_major_news_next_48h": False,      # unknowable from price data
    }


def _estimate_failure_risk(confidence: int, rr: Optional[float]) -> Dict[str, float]:
    """Failure-mode probabilities — intentionally EMPTY, now with proof.

    Q4 removed invented priors. Phase FR (2026-08-24) then TESTED whether a
    calibrated model is buildable: scripts/collect_trade_dataset.py recorded
    n=598 simulated trades (99.5% anchor fidelity vs the official simulator)
    with every signal-time feature — adjusted confidence, RR at signal,
    ATR14/50 ratio, family x trend, direction. Result: NONE predict failure.
    Mann-Whitney AUC vs loss outcome: confidence 0.484, RR 0.511, ATR ratio
    0.508 (bars_held 0.680 is an outcome feature, unusable at entry). All
    bivariate cells' Wilson intervals overlap; unconditional P(loss)=0.448
    [0.409,0.487]. Any per-trade probability emitted from these features
    would be noise dressed as precision — the exact defect Q4 removed.

    Verdict: this stays {} unless a future dataset exposes a signal-time
    feature with AUC materially above 0.5 out-of-sample. Dataset + collector:
    scripts/trade_dataset.jsonl, scripts/collect_trade_dataset.py.
    """
    return {}


def _detect_double_top(candles: List[Candle], swing_highs: List[SwingPoint],
                       swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(swing_highs) < 2 or len(swing_lows) < 1:
        return None
    recent_highs = swing_highs[-5:]
    for i in range(len(recent_highs) - 1):
        p1 = recent_highs[i]
        p2 = recent_highs[i + 1]
        peak_avg = (p1.price + p2.price) / 2
        peak_diff = abs(p1.price - p2.price) / peak_avg
        if peak_diff > PEAK_EQUALITY_PCT:
            continue
        if not (p1.time < p2.time):
            continue
        valley = _min_swing_between(swing_lows, p1.time, p2.time)
        if not valley:
            continue
        valley_depth = (peak_avg - valley.price) / peak_avg
        if valley_depth < 0.02:
            continue
        valley_idx = _idx(candles, valley.time)
        broke_below = False
        break_bar = -1
        start_check = max(valley_idx, _idx(candles, p2.time))
        for j in range(start_check, len(candles)):
            if candles[j].close < valley.price and candles[j].low < valley.price:
                broke_below = True
                break_bar = j
                break
        score = 0
        confs: List[str] = []
        eq_score = 20 * (1 - peak_diff / PEAK_EQUALITY_PCT)
        score += max(0, _round_half_up(eq_score))
        if peak_diff < 0.02:
            confs.append("Peaks within ±2%")
        if valley_depth > 0.05:
            score += 20
            confs.append("Valley depth >5%")
        elif valley_depth > 0.03:
            score += 12
        v1 = _avg_volume(candles, _idx(candles, p1.time) - 2, _idx(candles, p1.time) + 2)
        v2 = _avg_volume(candles, _idx(candles, p2.time) - 2, _idx(candles, p2.time) + 2)
        if v2 < v1 * 0.9:
            score += 15
            confs.append("Volume lower on 2nd peak")
        elif v2 < v1:
            score += 8
        if broke_below:
            break_pct = (valley.price - candles[break_bar].close) / valley.price
            if break_pct > 0.03:
                score += 25
                confs.append("Breakdown >3% below valley")
            elif break_pct > 0.01:
                score += 15
                confs.append("Breakdown confirmed")
            else:
                score += 10
        else:
            latest_close = candles[-1].close
            pct_above = (latest_close - valley.price) / valley.price
            if pct_above < 0.01:
                score += 5
        i1 = _idx(candles, p1.time)
        i2_idx = _idx(candles, p2.time)
        if i1 >= 0 and i2_idx >= 0 and (i2_idx - i1) >= 10:
            score += 10
            confs.append("Pattern spans 10+ bars")
        if (peak_avg - valley.price) * 2 > 0:
            score += 5
        confidence = min(_round_half_up(score), 100)
        if confidence < MIN_CONFIDENCE:
            continue
        entry_price = candles[break_bar].close if broke_below else None
        stop_price = peak_avg * (1 + STOP_CUSHION_PCT)
        target_price = valley.price - (peak_avg - valley.price) * TARGET_MULT_REVERSAL
        rr = _calc_rr(entry_price, stop_price, target_price)
        # Q3: measured break-bar checklist (this detector knows break_bar;
        # the dispatcher's last-bar approximation would be wrong here).
        vol_20_chk = _avg_volume(candles, max(0, break_bar - 20), break_bar)
        return DetectedPattern(
            type="double_top", direction="bearish", confidence=confidence,
            entry=entry_price, stop_loss=stop_price,
            target=target_price if target_price > 0 else None,
            entry_checklist=_build_entry_checklist(
                broke_below, False, True, rr,
                _adx(candles, len(candles) - 1),
                vol_break_measured=(vol_20_chk > 0 and candles[break_bar].volume > vol_20_chk * 1.5),
                has_neckline=True),
            risk_reward=rr, confirmations=confs,
        )
    return None


def _detect_double_bottom(candles: List[Candle], swing_highs: List[SwingPoint],
                          swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(swing_lows) < 2 or len(swing_highs) < 1:
        return None
    recent_lows = swing_lows[-5:]
    for i in range(len(recent_lows) - 1):
        t1 = recent_lows[i]
        t2 = recent_lows[i + 1]
        trough_avg = (t1.price + t2.price) / 2
        trough_diff = abs(t1.price - t2.price) / trough_avg
        if trough_diff > PEAK_EQUALITY_PCT:
            continue
        if not (t1.time < t2.time):
            continue
        peak = _max_swing_between(swing_highs, t1.time, t2.time)
        if not peak:
            continue
        peak_height = (peak.price - trough_avg) / trough_avg
        if peak_height < 0.02:
            continue
        peak_idx = _idx(candles, peak.time)
        broke_above = False
        break_bar = -1
        start_check = max(peak_idx, _idx(candles, t2.time))
        for j in range(start_check, len(candles)):
            if candles[j].close > peak.price and candles[j].high > peak.price:
                broke_above = True
                break_bar = j
                break
        score = 0
        confs: List[str] = []
        eq_score = 20 * (1 - trough_diff / PEAK_EQUALITY_PCT)
        score += max(0, _round_half_up(eq_score))
        if trough_diff < 0.02:
            confs.append("Troughs within ±2%")
        if peak_height > 0.05:
            score += 20
            confs.append("Peak height >5%")
        elif peak_height > 0.03:
            score += 12
        v1 = _avg_volume(candles, _idx(candles, t1.time) - 2, _idx(candles, t1.time) + 2)
        v2 = _avg_volume(candles, _idx(candles, t2.time) - 2, _idx(candles, t2.time) + 2)
        if v2 > v1:
            score += 15
            confs.append("Volume higher on 2nd trough (accumulation)")
        if broke_above:
            break_pct = (candles[break_bar].close - peak.price) / peak.price
            if break_pct > 0.03:
                score += 25
                confs.append("Breakout >3% above peak")
            elif break_pct > 0.01:
                score += 15
                confs.append("Breakout confirmed")
            else:
                score += 10
        else:
            latest_close = candles[-1].close
            pct_below = (peak.price - latest_close) / peak.price
            if pct_below < 0.01:
                score += 5
        i1 = _idx(candles, t1.time)
        i2_idx = _idx(candles, t2.time)
        if i1 >= 0 and i2_idx >= 0 and (i2_idx - i1) >= 10:
            score += 10
            confs.append("Pattern spans 10+ bars")
        confidence = min(_round_half_up(score), 100)
        if confidence < MIN_CONFIDENCE:
            continue
        entry_price = candles[break_bar].close if broke_above else None
        stop_price = trough_avg * (1 - STOP_CUSHION_PCT)
        target_price = peak.price + (peak.price - trough_avg) * TARGET_MULT_REVERSAL
        rr = _calc_rr(entry_price, stop_price, target_price)
        # Q3: measured break-bar checklist (this detector knows break_bar;
        # the dispatcher's last-bar approximation would be wrong here).
        vol_20_chk = _avg_volume(candles, max(0, break_bar - 20), break_bar)
        return DetectedPattern(
            type="double_bottom", direction="bullish", confidence=confidence,
            entry=entry_price, stop_loss=stop_price, target=target_price,
            entry_checklist=_build_entry_checklist(
                broke_above, False, True, rr,
                _adx(candles, len(candles) - 1),
                vol_break_measured=(vol_20_chk > 0 and candles[break_bar].volume > vol_20_chk * 1.5),
                has_neckline=True),
            risk_reward=rr, confirmations=confs,
        )
    return None


def _detect_bull_flag(candles: List[Candle], swing_highs: List[SwingPoint],
                      swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(candles) < 15:
        return None
    lookback = min(60, len(candles))
    start_idx = len(candles) - lookback
    best_pole = None
    # R1 repair: pole ends before the current breakout bar — otherwise a
    # genuine breakout extends the "best pole" to the last bar, no flag
    # remains, and the detector bails on the pole_end guard.
    for i in range(start_idx, len(candles) - 5):
        for j in range(i + 3, min(i + 15, len(candles) - 1)):
            rise = (candles[j].close - candles[i].close) / candles[i].close
            if rise >= FLAG_POLE_MIN_PCT and rise < 0.5:
                if best_pole is None or rise > best_pole[2]:
                    best_pole = (i, j, rise)
    if not best_pole:
        return None
    pole_end = best_pole[1]
    if pole_end >= len(candles) - 3:
        return None
    flag_candles = candles[pole_end + 1:]
    if len(flag_candles) < 4:
        return None
    # R1 repair: the flag body excludes the current bar — today's bar is the
    # potential breakout bar. The old range included its own high, so
    # `latest_close > flag_high` was mathematically impossible and flags
    # never produced an entry. The down-slope guard also uses the body:
    # a genuine breakout bar closes ABOVE flag start and self-rejected.
    prior_flag = flag_candles[:-1]
    flag_start = flag_candles[0]
    flag_end = prior_flag[-1]
    if flag_end.close >= flag_start.close:
        return None
    flag_high = max(c.high for c in prior_flag)
    flag_low_price = min(c.low for c in prior_flag)
    latest_close = candles[-1].close
    broke_out = latest_close > flag_high
    if not broke_out:
        # Q1 quality gate: continuation patterns ARE the trade — an unconfirmed
        # flag floods the dispatcher top-3 with dormant geometry (the same
        # disease cured for symmetrical_triangle / rising_wedge).
        return None
    atr_now = _atr(candles, len(candles) - 1, 14)
    if atr_now > 0 and (latest_close - flag_high) > 2.0 * atr_now:
        return None  # stale breakout: price already ran >2 ATR past the flag
    score = 40
    confs: List[str] = []
    if best_pole[2] > 0.1:
        score += 15
        confs.append("Flagpole rise >10%")
    elif best_pole[2] > 0.07:
        score += 8
    flag_drop = (flag_start.close - flag_end.close) / flag_start.close
    if 0.02 < flag_drop < 0.15:
        score += 15
        confs.append("Flag retrace 2–15%")
    elif flag_drop <= 0.02:
        score += 5
    pole_bars = best_pole[1] - best_pole[0]
    flag_bars = len(flag_candles)
    if flag_bars <= pole_bars * 1.5:
        score += 10
        confs.append("Flag shorter than pole")
    pole_vol = _avg_volume(candles, best_pole[0], best_pole[1])
    flag_vol = _avg_volume(candles, pole_end + 1, len(candles) - 1)
    if flag_vol < pole_vol * 0.8:
        score += 15
        confs.append("Volume contracting during flag")
    elif flag_vol < pole_vol:
        score += 7
    if broke_out:
        break_pct = (latest_close - flag_high) / flag_high
        if break_pct > 0.02:
            score += 20
            confs.append("Breakout >2% above flag")
        else:
            score += 10
    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close if broke_out else None
    target = (entry_price or flag_high) + (best_pole[2] * candles[best_pole[0]].close)
    stop_price = flag_low_price * (1 - STOP_CUSHION_PCT)
    rr = _calc_rr(entry_price, stop_price, target)
    if rr is not None and rr < MIN_RR:
        return None
    return DetectedPattern(
        type="bull_flag", direction="bullish", confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target,
        risk_reward=rr, confirmations=confs,
    )


def _detect_bear_flag(candles: List[Candle], swing_highs: List[SwingPoint],
                      swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(candles) < 15:
        return None
    lookback = min(60, len(candles))
    start_idx = len(candles) - lookback
    best_pole = None
    # R1 repair (bear mirror): pole ends before the current breakdown bar.
    for i in range(start_idx, len(candles) - 5):
        for j in range(i + 3, min(i + 15, len(candles) - 1)):
            drop = (candles[i].close - candles[j].close) / candles[i].close
            if drop >= FLAG_POLE_MIN_PCT and drop < 0.5:
                if best_pole is None or drop > best_pole[2]:
                    best_pole = (i, j, drop)
    if not best_pole:
        return None
    pole_end = best_pole[1]
    if pole_end >= len(candles) - 3:
        return None
    flag_candles = candles[pole_end + 1:]
    if len(flag_candles) < 4:
        return None
    # R1 repair (bear mirror): flag body excludes the current breakout bar;
    # the up-slope guard uses the body for the same reason.
    prior_flag = flag_candles[:-1]
    flag_start = flag_candles[0]
    flag_end = prior_flag[-1]
    if flag_end.close <= flag_start.close:
        return None
    flag_low = min(c.low for c in prior_flag)
    flag_high_price = max(c.high for c in prior_flag)
    latest_close = candles[-1].close
    broke_down = latest_close < flag_low
    if not broke_down:
        # Q1 quality gate (bear mirror): mandatory breakdown only.
        return None
    atr_now = _atr(candles, len(candles) - 1, 14)
    if atr_now > 0 and (flag_low - latest_close) > 2.0 * atr_now:
        return None  # stale breakdown
    score = 40
    confs: List[str] = []
    if best_pole[2] > 0.1:
        score += 15
        confs.append("Flagpole drop >10%")
    elif best_pole[2] > 0.07:
        score += 8
    flag_rise = (flag_end.close - flag_start.close) / flag_start.close
    if 0.02 < flag_rise < 0.15:
        score += 15
        confs.append("Flag rise 2–15%")
    elif flag_rise <= 0.02:
        score += 5
    pole_bars = best_pole[1] - best_pole[0]
    flag_bars = len(flag_candles)
    if flag_bars <= pole_bars * 1.5:
        score += 10
    pole_vol = _avg_volume(candles, best_pole[0], best_pole[1])
    flag_vol = _avg_volume(candles, pole_end + 1, len(candles) - 1)
    if flag_vol < pole_vol * 0.8:
        score += 15
        confs.append("Volume contracting during flag")
    elif flag_vol < pole_vol:
        score += 7
    if broke_down:
        break_pct = (flag_low - latest_close) / flag_low
        if break_pct > 0.02:
            score += 20
            confs.append("Breakdown >2% below flag")
        else:
            score += 10
    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close if broke_down else None
    target = (entry_price or flag_low) - (best_pole[2] * candles[best_pole[0]].close)
    # Mirror consistency repair: stop anchored to the whole flag's high
    # (previously the single latest bar's high — arbitrarily tight vs bull side).
    stop_price = flag_high_price * (1 + STOP_CUSHION_PCT)
    target_price = target if target > 0 else None
    rr = _calc_rr(entry_price, stop_price, target_price)
    if rr is not None and rr < MIN_RR:
        return None
    return DetectedPattern(
        type="bear_flag", direction="bearish", confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target_price,
        risk_reward=rr, confirmations=confs,
    )


def _detect_ascending_triangle(candles: List[Candle], swing_highs: List[SwingPoint],
                               swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return None
    recent_highs = swing_highs[-6:]
    recent_lows = swing_lows[-6:]
    for hi in range(len(recent_highs) - 1):
        rh1 = recent_highs[hi]
        rh2 = recent_highs[hi + 1]
        res_avg = (rh1.price + rh2.price) / 2
        if abs(rh1.price - rh2.price) / res_avg > 0.03:
            continue
        lows_before = _swings_between(swing_lows, rh1.time, rh2.time)[-4:]
        if len(lows_before) < 2:
            continue
        for li in range(len(lows_before) - 1):
            rl1 = lows_before[li]
            rl2 = lows_before[li + 1]
            if rl2.price <= rl1.price:
                continue
            if rl2.time < rh1.time:
                continue
            support_rise = (rl2.price - rl1.price) / rl1.price
            if support_rise < 0.005:
                continue
            latest_close = candles[-1].close
            broke_out = latest_close > res_avg * 1.01
            if not broke_out:
                continue  # Q1 quality gate: confirmed breakouts only
            atr_now = _atr(candles, len(candles) - 1, 14)
            if atr_now > 0 and (latest_close - res_avg) > 2.0 * atr_now:
                continue  # stale breakout
            score = 35
            confs: List[str] = []
            res_tightness = 20 * (1 - abs(rh1.price - rh2.price) / res_avg / 0.03)
            score += max(0, _round_half_up(res_tightness))
            if abs(rh1.price - rh2.price) / res_avg < 0.015:
                confs.append("Resistance level tight (±1.5%)")
            if support_rise > 0.03:
                score += 20
                confs.append("Rising support slope >3%")
            elif support_rise > 0.015:
                score += 10
            vol_start = _avg_volume(candles, _idx(candles, rh1.time) - 2, _idx(candles, rh1.time) + 2)
            vol_end = _avg_volume(candles, max(0, len(candles) - 5), len(candles) - 1)
            if vol_end < vol_start * 0.8:
                score += 15
                confs.append("Volume declining during formation")
            elif vol_end < vol_start:
                score += 7
            if broke_out:
                break_pct = (latest_close - res_avg) / res_avg
                if break_pct > 0.03:
                    score += 20
                    confs.append("Breakout >3% above resistance")
                elif break_pct > 0.01:
                    score += 12
                    confs.append("Breakout confirmed")
                else:
                    score += 8
            total_touches = len(_swings_between(recent_highs, rh1.time, rh2.time)) + len(_swings_between(recent_lows, rl1.time, rl2.time))
            if total_touches >= 4:
                score += 10
                confs.append("4+ touches on triangle boundaries")
            confidence = min(_round_half_up(score), 100)
            if confidence < MIN_CONFIDENCE:
                continue
            entry_price = latest_close if broke_out else None
            target = (entry_price or res_avg) + (res_avg - rl1.price) * TARGET_MULT_CONTINUATION
            stop_price = rl1.price * (1 - STOP_CUSHION_PCT)
            rr = _calc_rr(entry_price, stop_price, target)
            if rr is not None and rr < MIN_RR:
                continue
            return DetectedPattern(
                type="ascending_triangle", direction="bullish", confidence=confidence,
                entry=entry_price, stop_loss=stop_price, target=target,
                risk_reward=rr, confirmations=confs,
            )
    return None


def _detect_descending_triangle(candles: List[Candle], swing_highs: List[SwingPoint],
                                swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return None
    recent_highs = swing_highs[-6:]
    recent_lows = swing_lows[-6:]
    for li in range(len(recent_lows) - 1):
        rl1 = recent_lows[li]
        rl2 = recent_lows[li + 1]
        sup_avg = (rl1.price + rl2.price) / 2
        if abs(rl1.price - rl2.price) / sup_avg > 0.03:
            continue
        highs_before = _swings_between(swing_highs, rl1.time, rl2.time)[-4:]
        if len(highs_before) < 2:
            continue
        for hi in range(len(highs_before) - 1):
            rh1 = highs_before[hi]
            rh2 = highs_before[hi + 1]
            if rh2.price >= rh1.price:
                continue
            if rh1.time < rl1.time or rh2.time > rl2.time:
                continue
            decline_pct = (rh1.price - rh2.price) / rh1.price
            if decline_pct < 0.005:
                continue
            latest_close = candles[-1].close
            broke_down = latest_close < sup_avg * 0.99
            if not broke_down:
                continue  # Q1 quality gate: confirmed breakdowns only
            atr_now = _atr(candles, len(candles) - 1, 14)
            if atr_now > 0 and (sup_avg - latest_close) > 2.0 * atr_now:
                continue  # stale breakdown
            score = 35
            confs: List[str] = []
            sup_tightness = 20 * (1 - abs(rl1.price - rl2.price) / sup_avg / 0.03)
            score += max(0, _round_half_up(sup_tightness))
            if abs(rl1.price - rl2.price) / sup_avg < 0.015:
                confs.append("Support level tight (±1.5%)")
            if decline_pct > 0.03:
                score += 20
                confs.append("Declining resistance slope >3%")
            elif decline_pct > 0.015:
                score += 10
            vol_start = _avg_volume(candles, _idx(candles, rl1.time) - 2, _idx(candles, rl1.time) + 2)
            vol_end = _avg_volume(candles, max(0, len(candles) - 5), len(candles) - 1)
            if vol_end < vol_start * 0.8:
                score += 15
                confs.append("Volume declining during formation")
            elif vol_end < vol_start:
                score += 7
            if broke_down:
                break_pct = (sup_avg - latest_close) / sup_avg
                if break_pct > 0.03:
                    score += 20
                    confs.append("Breakdown >3% below support")
                elif break_pct > 0.01:
                    score += 12
                    confs.append("Breakdown confirmed")
                else:
                    score += 8
            total_touches = len(_swings_between(recent_lows, rl1.time, rl2.time)) + len(_swings_between(recent_highs, rh1.time, rh2.time))
            if total_touches >= 4:
                score += 10
                confs.append("4+ touches on triangle boundaries")
            confidence = min(_round_half_up(score), 100)
            if confidence < MIN_CONFIDENCE:
                continue
            entry_price = latest_close if broke_down else None
            target = (entry_price or sup_avg) - (rh1.price - sup_avg) * TARGET_MULT_CONTINUATION
            stop_price = rh1.price * (1 + STOP_CUSHION_PCT)
            target_price = target if target > 0 else None
            rr = _calc_rr(entry_price, stop_price, target_price)
            if rr is not None and rr < MIN_RR:
                continue
            return DetectedPattern(
                type="descending_triangle", direction="bearish", confidence=confidence,
                entry=entry_price, stop_loss=stop_price, target=target_price,
                risk_reward=rr, confirmations=confs,
            )
    return None


def _detect_falling_wedge(candles: List[Candle], swing_highs: List[SwingPoint],
                          swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    recent_highs = swing_highs[-5:]
    recent_lows = swing_lows[-5:]
    if len(recent_highs) < 2 or len(recent_lows) < 2:
        return None
    h1 = recent_highs[-2]
    h2 = recent_highs[-1]
    l1 = recent_lows[-2]
    l2 = recent_lows[-1]
    if h2.price >= h1.price or l2.price >= l1.price:
        return None
    wedge_start = min(_idx(candles, h1.time), _idx(candles, l1.time))
    wedge_end = max(_idx(candles, h2.time), _idx(candles, l2.time))
    if wedge_start < 0 or wedge_end < 0:
        return None
    if wedge_end - wedge_start < 5:
        return None
    if _idx(candles, l2.time) <= _idx(candles, h1.time):
        return None
    upper_slope = (h2.price - h1.price) / h1.price
    lower_slope = (l2.price - l1.price) / l1.price
    if upper_slope >= lower_slope:
        return None
    latest_close = candles[-1].close
    recent_upper = _interpolate(h1, h2, candles[-1].time, candles)
    broke_out = recent_upper is not None and latest_close > recent_upper
    if not broke_out or recent_upper is None:
        return None  # Q1 quality gate: confirmed breakouts only
    atr_now = _atr(candles, len(candles) - 1, 14)
    if atr_now > 0 and (latest_close - recent_upper) > 2.0 * atr_now:
        return None  # stale breakout
    score = 30
    confs: List[str] = []
    # R3 repair: convergence scored proportionally to the actual slope gap.
    # The old code added an unconditional +20 — the guard above already
    # guarantees the upper line is steeper, so every candidate got a free
    # boost, inflating confidence past the quality gate.
    slope_gap = abs(lower_slope - upper_slope)
    if slope_gap >= 0.05:
        score += 20
        confs.append("Strongly converging trendlines")
    elif slope_gap >= 0.02:
        score += 12
        confs.append("Converging trendlines")
    else:
        score += 5
    total_touches = len(recent_highs) + len(recent_lows)
    if total_touches >= 4:
        score += 15
        confs.append("4+ swing points defining the wedge")
    elif total_touches >= 3:
        score += 8
    if wedge_end - wedge_start >= 15:
        score += 15
        confs.append("Wedge spans 15+ bars")
    vol_start = _avg_volume(candles, max(0, wedge_start - 2), wedge_start + 2)
    vol_end = _avg_volume(candles, max(0, len(candles) - 5), len(candles) - 1)
    if vol_end < vol_start * 0.7:
        score += 15
        confs.append("Volume declining during wedge")
    elif vol_end < vol_start:
        score += 7
    if broke_out and recent_upper is not None:
        break_pct = (latest_close - recent_upper) / recent_upper
        if break_pct > 0.02:
            score += 20
            confs.append("Breakout >2% above upper trendline")
        else:
            score += 10
    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close if broke_out else None
    stop_price = l2.price * (1 - STOP_CUSHION_PCT)
    target = (entry_price or h2.price) + (max(h1.price, l1.price) - min(h2.price, l2.price)) * TARGET_MULT_CONTINUATION
    rr = _calc_rr(entry_price, stop_price, target)
    if rr is not None and rr < MIN_RR:
        return None
    return DetectedPattern(
        type="falling_wedge", direction="bullish", confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target,
        risk_reward=rr, confirmations=confs,
    )


def _detect_cup_handle(candles: List[Candle], swing_highs: List[SwingPoint],
                       swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    if len(candles) < CUP_MIN_BARS:
        return None
    lookback = min(60, len(candles))
    start_search = len(candles) - lookback
    cup_bottom_idx = start_search
    cup_bottom_price = candles[start_search].low
    for i in range(start_search, len(candles)):
        if candles[i].low < cup_bottom_price:
            cup_bottom_price = candles[i].low
            cup_bottom_idx = i
    if cup_bottom_idx < start_search + lookback * 0.2 or cup_bottom_idx > start_search + lookback * 0.8:
        return None
    left_start_price = candles[start_search].close
    left_decline = (left_start_price - cup_bottom_price) / left_start_price
    if left_decline < 0.05:
        return None
    right_end_idx = len(candles) - 1
    right_rise = (candles[right_end_idx].close - cup_bottom_price) / cup_bottom_price
    if right_rise < 0.03:
        return None
    base_bars = 0
    for i in range(cup_bottom_idx - 2, cup_bottom_idx + 3):
        if 0 <= i < len(candles):
            pct_from_bottom = (candles[i].close - cup_bottom_price) / cup_bottom_price
            if pct_from_bottom < 0.02:
                base_bars += 1
    u_shape = base_bars >= 3
    handle_lookback = min(10, len(candles) - cup_bottom_idx)
    handle_start_idx = len(candles) - handle_lookback
    handle_drop = (candles[handle_start_idx].close - candles[-1].close) / candles[handle_start_idx].close
    has_handle = 0.01 < handle_drop < 0.15
    rim_price = 0.0
    rim_time = ""
    for i in range(cup_bottom_idx + 3, handle_start_idx):
        if candles[i].high > rim_price:
            rim_price = candles[i].high
            rim_time = candles[i].time
    if rim_price == 0:
        return None
    latest_close = candles[-1].close
    broke_out = latest_close > rim_price
    if not broke_out:
        return None  # Q1 quality gate: confirmed rim breakouts only
    atr_now = _atr(candles, len(candles) - 1, 14)
    if atr_now > 0 and (latest_close - rim_price) > 2.0 * atr_now:
        return None  # stale breakout
    score = 20
    confs: List[str] = []
    cup_depth = (left_start_price - cup_bottom_price) / left_start_price
    if 0.1 < cup_depth < 0.5:
        score += 20
        confs.append("Cup depth 10–50%")
    elif cup_depth > 0.05:
        score += 10
    if u_shape:
        score += 20
        confs.append("Rounded (U-shaped) bottom")
    else:
        score += 5
    if has_handle:
        score += 20
        confs.append("Handle pullback present (1–15%)")
    if lookback >= 40:
        score += 15
        confs.append("Cup spans 40+ bars (long-term formation)")
    elif lookback >= 25:
        score += 8
    left_vol = _avg_volume(candles, start_search, cup_bottom_idx - 2)
    bottom_vol = _avg_volume(candles, max(0, cup_bottom_idx - 2), cup_bottom_idx + 2)
    right_vol = _avg_volume(candles, cup_bottom_idx + 3, len(candles) - 1)
    if bottom_vol < left_vol and right_vol > bottom_vol:
        score += 15
        confs.append("Volume contraction at bottom, expansion on right side")
    elif bottom_vol < left_vol:
        score += 7
    if broke_out:
        break_pct = (latest_close - rim_price) / rim_price
        if break_pct > 0.02:
            score += 10
            confs.append("Breakout >2% above rim")
        else:
            score += 5
    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close if broke_out else None
    target = (entry_price or rim_price) + cup_depth * cup_bottom_price * TARGET_MULT_CONTINUATION
    stop_price = cup_bottom_price * (1 - STOP_CUSHION_PCT)
    rr = _calc_rr(entry_price, stop_price, target)
    if rr is not None and rr < MIN_RR:
        return None
    return DetectedPattern(
        type="cup_and_handle", direction="bullish", confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target,
        risk_reward=rr, confirmations=confs,
    )


# ── Phase 0: New-Pattern Infrastructure ────────────────────────────────────────

# Experimental gating: new patterns stay OUT of production output until they
# have been backtest-calibrated (scripts/calibrate_reliability.py). Tests and
# the calibration script enable them explicitly.
# Patterns detected but NOT yet enabled in production. Calibration verdicts
# (scripts/reliability_calibration.json, --experimental run, post-F2 repair):
#   rising_wedge   : RETEST entry model adopted (see RISING_WEDGE_ENTRY_MODE).
#                    Evidence trail: break-entry sweep -0.29..-0.40R at every
#                    target multiple; retest@1.0x +0.106R (n=47, 30-ticker
#                    sweep), holdout OOS +0.402R (n=23), official standard-
#                    universe calibration +0.25R (n=16, 55.6% WR [27,81],
#                    weight 1.10). First bearish configuration with positive
#                    calibrated expectancy. STAYS GATED one more cycle: all
#                    samples overlap the same 5y window, the holdout showed
#                    regime instability (in-sample leg negative), and the
#                    config was selected post-hoc. PRE-REGISTERED RULE: it
#                    graduates automatically if the next recalibration on
#                    fresh data prints >= +0.10R with combined n >= 50.
#   triple_top     : 8.3% WR [1,35], -0.73R, n=15 — mirror pattern
#                    (triple_bottom) works (47.8% WR) but the bearish side
#                    genuinely loses after costs.
#   rounding_top / rounding_bottom / island_reversal: insufficient trades to
#                    calibrate (n <= 3).
EXPERIMENTAL_PATTERNS = {
    "rising_wedge",
    "triple_top",
    "rounding_top",
    "rounding_bottom",
    "island_reversal",
}
ENABLE_EXPERIMENTAL_PATTERNS = False
# Probation cap: until a pattern type has been calibrated (reliability weight
# derived from honest expectancy), it cannot outrank a validated setup scoring
# 90+. Raise to 100 once its weight is in PATTERN_RELIABILITY.
EXPERIMENTAL_CONFIDENCE_CAP = 89


def _line_price_at(p1_idx: int, p1_price: float, p2_idx: int, p2_price: float,
                   target_idx: int) -> Optional[float]:
    """Price of the straight line through (p1,p2) extrapolated to target_idx."""
    if p2_idx == p1_idx:
        return None
    slope = (p2_price - p1_price) / (p2_idx - p1_idx)
    return p1_price + slope * (target_idx - p1_idx)


def _find_gaps(candles: List[Candle], min_gap_pct: float = 0.005) -> List[Dict[str, Any]]:
    """True gap list: bar body separated from prior bar's range.

    A gap up requires low > previous high; gap down requires high < previous
    low. Returns [{idx, time, direction, size_pct}] where size_pct is the gap
    distance relative to the previous close."""
    gaps: List[Dict[str, Any]] = []
    for i in range(1, len(candles)):
        prev, cur = candles[i - 1], candles[i]
        if prev.close <= 0:
            continue
        if cur.low > prev.high:
            size = (cur.low - prev.high) / prev.close
            if size >= min_gap_pct:
                gaps.append({"idx": i, "time": cur.time, "direction": "up",
                             "size_pct": size})
        elif cur.high < prev.low:
            size = (prev.low - cur.high) / prev.close
            if size >= min_gap_pct:
                gaps.append({"idx": i, "time": cur.time, "direction": "down",
                             "size_pct": size})
    return gaps


def classify_gaps(candles: List[Candle], min_gap_pct: float = 0.005) -> List[Dict[str, Any]]:
    """Gap taxonomy (chart_patterns.md §22): breakaway / run / exhaustion / common.

    Heuristic classification, documented and deterministic:
      - breakaway : first gap out of a sideways zone (prior 10-bar range < 60%
                    of ATR14-scaled trend move) OR gap that starts a fresh
                    directional stretch
      - run       : gap aligned with an established trend (10-bar momentum in
                    gap direction > 1 ATR) and not near its end
      - exhaustion: gap aligned with trend but followed by reversal within 5
                    bars, or on volume > 2x the 20-bar average
      - common    : everything else (small, counter-move, no context)
    """
    out: List[Dict[str, Any]] = []
    gaps = _find_gaps(candles, min_gap_pct)
    for g in gaps:
        i, d = g["idx"], g["direction"]
        atr = _atr(candles, i, 14)
        lookback = candles[max(0, i - 11):i]
        if len(lookback) < 5 or atr <= 0:
            g["gap_type"] = "common"
            out.append(g)
            continue
        trend_move = candles[i].close - lookback[0].close
        rng = max(c.high for c in lookback) - min(c.low for c in lookback)
        aligned = (d == "up" and trend_move > atr) or (d == "down" and trend_move < -atr)
        sideways = rng < 6 * atr and abs(trend_move) < atr
        fwd = candles[i + 1:i + 6]
        reversed_after = any(
            (c.close < candles[i].close if d == "up" else c.close > candles[i].close)
            for c in fwd) if fwd else False
        vol_spike = (candles[i].volume > 2 * _avg_volume(candles, max(0, i - 20), i - 1)
                     if i >= 2 else False)
        if sideways:
            gtype = "breakaway"
        elif aligned and reversed_after:
            gtype = "exhaustion"
        elif aligned and vol_spike and g["size_pct"] > 0.02:
            gtype = "exhaustion"
        elif aligned:
            gtype = "run"
        else:
            gtype = "common"
        g["gap_type"] = gtype
        out.append(g)
    return out


# ── Phase 1: Symmetrical Triangle (bilateral continuation) ─────────────────────

def _detect_symmetrical_triangle(candles: List[Candle], swing_highs: List[SwingPoint],
                                 swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Lower highs + higher lows between converging lines (chart_patterns.md §17).

    Bilateral: direction comes from the breakout side; the prior trend biases
    the ranking prior but the geometry itself is neutral."""
    if len(candles) < 40 or len(swing_highs) < 2 or len(swing_lows) < 2:
        return None
    rh, rl = swing_highs[-6:], swing_lows[-6:]
    # Non-adjacent high pairs (span <= 4 swings): a bounce between the two
    # defining highs always registers its own swing high, so adjacent-only
    # pairing would never see past it.
    for hi in range(len(rh) - 1):
      for hj in range(hi + 1, min(hi + 5, len(rh))):
        h1, h2 = rh[hi], rh[hj]
        if not (h1.time < h2.time) or h2.price >= h1.price:
            continue
        lows_between = _swings_between(rl, h1.time, candles[-1].time)[-3:]
        for li in range(len(lows_between) - 1):
            l1, l2 = lows_between[li], lows_between[li + 1]
            if not (l1.time < l2.time) or l2.price <= l1.price:
                continue
            if l1.time <= h1.time:
                continue  # formation must interleave: H before L
            i_h1, i_h2 = _idx(candles, h1.time), _idx(candles, h2.time)
            i_l1, i_l2 = _idx(candles, l1.time), _idx(candles, l2.time)
            if min(i_h1, i_l1) < 0 or i_h2 <= i_h1 or i_l2 <= i_l1:
                continue
            upper_start = _line_price_at(i_h1, h1.price, i_h2, h2.price, i_l1)
            lower_end = _line_price_at(i_l1, l1.price, i_l2, l2.price, i_h2)
            if upper_start is None or lower_end is None:
                continue
            # lines must not cross inside the formation, and must still be
            # open at the current bar (past-apex triangles are stale)
            if lower_end >= upper_start:
                continue
            latest_close = candles[-1].close
            n = len(candles)
            upper_now = _line_price_at(i_h1, h1.price, i_h2, h2.price, n - 1)
            lower_now = _line_price_at(i_l1, l1.price, i_l2, l2.price, n - 1)
            if upper_now is None or lower_now is None:
                continue
            if upper_now <= lower_now:
                continue  # apex already passed
            broke_up = latest_close > upper_now
            broke_down = latest_close < lower_now
            if broke_up and broke_down:
                continue
            # Bilateral patterns are only actionable on the break; report a
            # fresh one only (within 1.5 ATR of the broken line).
            if not (broke_up or broke_down):
                continue
            atr_now = _atr(candles, n - 1, 14)
            _res_ref = upper_now if broke_up else lower_now
            if atr_now > 0 and abs(latest_close - _res_ref) > 2.0 * atr_now:
                continue  # stale break

            score = 35
            confs: List[str] = []
            # Convergence is the defining property: without visible narrowing
            # this is a drifting range, not a triangle — hard gate at 15%.
            width_start = upper_start - l1.price
            width_now = upper_now - lower_now
            if width_start <= 0 or width_now <= 0:
                continue
            compression = 1 - width_now / width_start
            if compression <= 0.15:
                continue
            if compression > 0.35:
                score += 20
                confs.append("Strong line convergence")
            else:
                score += 12
            # Touches (0–15)
            touches = (len(_swings_between(swing_highs, h1.time, h2.time)) + 2
                       + len(_swings_between(swing_lows, l1.time, l2.time)) + 2)
            if touches >= 5:
                score += 15
                confs.append("5+ boundary touches")
            elif touches >= 4:
                score += 10
            # Volume contraction (0–15)
            vol_start = _avg_volume(candles, min(i_h1, i_l1), min(i_h1, i_l1) + 4)
            vol_end = _avg_volume(candles, max(0, n - 5), n - 1)
            if vol_end < vol_start * 0.75:
                score += 15
                confs.append("Volume contracting into apex")
            elif vol_end < vol_start:
                score += 7
            # Breakout (0–25) — guaranteed present (gated above)
            direction = "bullish" if broke_up else "bearish"
            res_ref = upper_now if broke_up else lower_now
            bp = abs(latest_close - res_ref) / res_ref
            if bp > 0.02:
                score += 25
                confs.append(f"Breakout {'>' if broke_up else '<'} line >2%")
            else:
                score += 15
                confs.append("Breakout confirmed")

            confidence = min(_round_half_up(score), 100)
            if confidence < MIN_CONFIDENCE:
                continue
            # Measured move: triangle height at the first touch pair
            height = abs(h1.price - l1.price)
            entry_price = latest_close if (broke_up or broke_down) else None
            if broke_down:
                target = latest_close - height * TARGET_MULT_CONTINUATION
                stop_price = upper_now * (1 + STOP_CUSHION_PCT)
            else:
                target = latest_close + height * TARGET_MULT_CONTINUATION
                stop_price = lower_now * (1 - STOP_CUSHION_PCT)
            target_price = target if target > 0 else None
            rr = _calc_rr(entry_price, stop_price, target_price)
            if rr is not None and rr < MIN_RR:
                continue
            return DetectedPattern(
                type="symmetrical_triangle", direction=direction,
                confidence=confidence, entry=entry_price,
                stop_loss=stop_price, target=target_price,
                risk_reward=rr, confirmations=confs,
            )
    return None


# ── Phase 2: Rising Wedge (bearish continuation) ───────────────────────────────

def _detect_rising_wedge(candles: List[Candle], swing_highs: List[SwingPoint],
                         swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Both trendlines rise, lower rises faster (converging); breaks down
    (chart_patterns.md §13). Mirror of the repaired falling-wedge logic.

    High pairs are scanned non-adjacently (span <= 4 swing points) and lows
    from the first high to series end: any bounce between the defining highs
    registers its own swing high, so adjacent-only pairing would never see
    the two rising lows that straddle it."""
    if len(candles) < 40 or len(swing_highs) < 2 or len(swing_lows) < 2:
        return None
    recent_highs, recent_lows = swing_highs[-6:], swing_lows[-6:]
    n = len(candles)
    latest_close = candles[-1].close
    for hi in range(len(recent_highs) - 1):
        for hj in range(hi + 1, min(hi + 5, len(recent_highs))):
            h1, h2 = recent_highs[hi], recent_highs[hj]
            if not (h1.time < h2.time) or h2.price <= h1.price:
                continue
            lows_between = _swings_between(recent_lows, h1.time, candles[-1].time)[-3:]
            for li in range(len(lows_between) - 1):
                l1, l2 = lows_between[li], lows_between[li + 1]
                if not (l1.time < l2.time) or l2.price <= l1.price:
                    continue
                if l1.time <= h1.time:
                    continue  # formation must interleave: H before L
                i_h1, i_h2 = _idx(candles, h1.time), _idx(candles, h2.time)
                i_l1, i_l2 = _idx(candles, l1.time), _idx(candles, l2.time)
                if min(i_h1, i_h2, i_l1, i_l2) < 0 or i_h2 <= i_h1 or i_l2 <= i_l1:
                    continue
                upper_slope = (h2.price - h1.price) / (i_h2 - i_h1)
                lower_slope = (l2.price - l1.price) / (i_l2 - i_l1)
                if upper_slope <= 0 or lower_slope <= 0:
                    continue
                # converging: lower line rises faster than upper
                slope_gap = lower_slope - upper_slope
                if slope_gap <= 0:
                    continue
                # at least moderate convergence required — parallel-ish lines
                # are a channel, not a wedge
                if slope_gap <= 0.2 * abs(upper_slope):
                    continue
                upper_now = _line_price_at(i_h1, h1.price, i_h2, h2.price, n - 1)
                lower_now = _line_price_at(i_l1, l1.price, i_l2, l2.price, n - 1)
                if upper_now is None or lower_now is None or lower_now >= upper_now:
                    continue
                atr_now = _atr(candles, n - 1, 14)
                if RISING_WEDGE_ENTRY_MODE == "retest":
                    # Retest entry model: never short the breakdown bar itself
                    # (sweep-verified expectancy deficit — it buys the bottom
                    # of the flush). Require a decisive close below the lower
                    # line within the last 10 bars, then enter on the pullback
                    # to the line's underside. Invalidate if the break failed
                    # (close back above the upper line).
                    break_bar, break_line = -1, None
                    for j in range(n - 2, max(0, n - 12) - 1, -1):
                        line_j = _line_price_at(i_l1, l1.price, i_l2, l2.price, j)
                        if line_j is not None and candles[j].close < line_j:
                            break_bar, break_line = j, line_j
                            break
                    if break_bar < 0 or atr_now <= 0:
                        continue
                    if (latest_close < lower_now - 0.35 * atr_now
                            or latest_close > upper_now):
                        continue  # not a retest, or the break has failed
                    broke_down = True
                    bp = (break_line - candles[break_bar].close) / break_line
                else:
                    broke_down = latest_close < lower_now
                    # Continuation patterns are the trade: only report a fresh,
                    # decisive break — dormant geometry floods the dispatcher
                    # and starves calibrated patterns of top-3 slots.
                    if not broke_down:
                        continue
                    if atr_now > 0 and (lower_now - latest_close) > 2.0 * atr_now:
                        continue  # stale break: price has already run away
                    bp = (lower_now - latest_close) / lower_now
                # Regime gate: a rising wedge is a CONTINUATION structure only
                # in a downtrend; in an uptrend the same shape is a reversal
                # warning, and shorting bull-drift breakdowns produced
                # 0W/157L in calibration. Without 50 bars of context, skip.
                sma50 = _sma(candles, n - 1, 50)
                if sma50 <= 0 or latest_close >= sma50:
                    continue

                score = 35
                confs: List[str] = []
                rel_gap = slope_gap / max(abs(upper_slope), 1e-9)
                if rel_gap > 0.5:
                    score += 20
                    confs.append("Strong trendline convergence")
                else:
                    score += 12
                    confs.append("Moderate trendline convergence")
                total_touches = (len(_swings_between(recent_highs, h1.time, h2.time)) + 2
                                 + len(lows_between))
                if total_touches >= 5:
                    score += 15
                    confs.append("5+ swing points defining the wedge")
                elif total_touches >= 4:
                    score += 10
                wedge_first = min(i_h1, i_l1)
                wedge_last = max(i_h2, i_l2)
                if wedge_last - wedge_first >= 15:
                    score += 15
                    confs.append("Wedge spans 15+ bars")
                vol_start = _avg_volume(candles, max(0, wedge_first - 2), wedge_first + 2)
                vol_end = _avg_volume(candles, max(0, n - 5), n - 1)
                if vol_end < vol_start * 0.7:
                    score += 15
                    confs.append("Volume declining during wedge")
                elif vol_end < vol_start:
                    score += 7
                if bp > 0.02:
                    score += 25
                    confs.append("Breakdown >2% below lower line")
                else:
                    score += 15
                    confs.append("Breakdown confirmed")

                confidence = min(_round_half_up(score), 100)
                if confidence < MIN_CONFIDENCE:
                    continue
                entry_price = latest_close
                height = max(upper_now, h2.price) - min(lower_now, l1.price)
                target = latest_close - height * RISING_WEDGE_TARGET_MULT
                stop_price = upper_now * (1 + STOP_CUSHION_PCT)
                target_price = target if target > 0 else None
                rr = _calc_rr(entry_price, stop_price, target_price)
                if rr is not None and rr < MIN_RR:
                    continue
                return DetectedPattern(
                    type="rising_wedge", direction="bearish", confidence=confidence,
                    entry=entry_price, stop_loss=stop_price, target=target_price,
                    risk_reward=rr, confirmations=confs,
                )
    return None


# ── Phase 3: Triple Top / Triple Bottom ────────────────────────────────────────

def _detect_triple_top(candles: List[Candle], swing_highs: List[SwingPoint],
                       swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Three equal peaks, two similar troughs between, breakdown confirms
    (chart_patterns.md §5)."""
    if len(swing_highs) < 3 or len(swing_lows) < 2:
        return None
    recent = swing_highs[-7:]
    for i in range(len(recent) - 2):
        p1, p2, p3 = recent[i], recent[i + 1], recent[i + 2]
        if not (p1.time < p2.time < p3.time):
            continue
        peak_avg = (p1.price + p2.price + p3.price) / 3
        if max(abs(p.price - peak_avg) / peak_avg for p in (p1, p2, p3)) > PEAK_EQUALITY_PCT:
            continue
        t1 = _min_swing_between(swing_lows, p1.time, p2.time)
        t2 = _min_swing_between(swing_lows, p2.time, p3.time)
        if not t1 or not t2:
            continue
        support = min(t1.price, t2.price)
        if (peak_avg - support) / peak_avg < 0.02:
            continue
        i_p3 = _idx(candles, p3.time)
        broke_below, break_bar = False, -1
        for j in range(max(i_p3, _idx(candles, t2.time)), len(candles)):
            if candles[j].close < support and candles[j].low < support:
                broke_below, break_bar = True, j
                break

        score = 30
        confs: List[str] = []
        eq = 20 * (1 - max(abs(p.price - peak_avg) / peak_avg for p in (p1, p2, p3))
                   / PEAK_EQUALITY_PCT)
        score += max(0, _round_half_up(eq))
        v1 = _avg_volume(candles, _idx(candles, p1.time) - 2, _idx(candles, p1.time) + 2)
        v3 = _avg_volume(candles, i_p3 - 2, i_p3 + 2)
        if v3 < v1 * 0.8:
            score += 15
            confs.append("Volume lower on 3rd peak")
        elif v3 < v1:
            score += 8
        if broke_below:
            bp = (support - candles[break_bar].close) / support
            if bp > 0.02:
                score += 25
                confs.append("Breakdown >2% below support")
            else:
                score += 15
                confs.append("Breakdown confirmed")
        else:
            latest_close = candles[-1].close
            if (latest_close - support) / support < 0.01:
                score += 5
        i_p1 = _idx(candles, p1.time)
        if i_p3 - i_p1 >= 15:
            score += 10
            confs.append("Pattern spans 15+ bars")
        trough_sim = abs(t1.price - t2.price) / max(t1.price, 1e-9)
        if trough_sim < 0.03:
            score += 10
            confs.append("Intervening troughs at similar level")

        confidence = min(_round_half_up(score), 100)
        if confidence < MIN_CONFIDENCE:
            continue
        entry_price = candles[break_bar].close if broke_below else None
        stop_price = peak_avg * (1 + STOP_CUSHION_PCT)
        target_price = support - (peak_avg - support) * TARGET_MULT_REVERSAL
        rr = _calc_rr(entry_price, stop_price, target_price)
        # Q3: measured break-bar checklist (this detector knows break_bar;
        # the dispatcher's last-bar approximation would be wrong here).
        vol_20_chk = _avg_volume(candles, max(0, break_bar - 20), break_bar)
        return DetectedPattern(
            type="triple_top", direction="bearish", confidence=confidence,
            entry=entry_price, stop_loss=stop_price,
            target=target_price if target_price > 0 else None,
            entry_checklist=_build_entry_checklist(
                broke_below, False, True, rr,
                _adx(candles, len(candles) - 1),
                vol_break_measured=(vol_20_chk > 0 and candles[break_bar].volume > vol_20_chk * 1.5),
                has_neckline=True),
            risk_reward=rr, confirmations=confs,
        )
    return None


def _detect_triple_bottom(candles: List[Candle], swing_highs: List[SwingPoint],
                          swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Three equal troughs, two similar peaks between, breakout confirms
    (chart_patterns.md §6)."""
    if len(swing_lows) < 3 or len(swing_highs) < 2:
        return None
    recent = swing_lows[-7:]
    for i in range(len(recent) - 2):
        t1, t2, t3 = recent[i], recent[i + 1], recent[i + 2]
        if not (t1.time < t2.time < t3.time):
            continue
        trough_avg = (t1.price + t2.price + t3.price) / 3
        if max(abs(t.price - trough_avg) / trough_avg for t in (t1, t2, t3)) > PEAK_EQUALITY_PCT:
            continue
        m1 = _max_swing_between(swing_highs, t1.time, t2.time)
        m2 = _max_swing_between(swing_highs, t2.time, t3.time)
        if not m1 or not m2:
            continue
        resistance = max(m1.price, m2.price)
        if (resistance - trough_avg) / trough_avg < 0.02:
            continue
        i_t3 = _idx(candles, t3.time)
        broke_above, break_bar = False, -1
        for j in range(max(i_t3, _idx(candles, m2.time)), len(candles)):
            if candles[j].close > resistance and candles[j].high > resistance:
                broke_above, break_bar = True, j
                break

        score = 30
        confs: List[str] = []
        eq = 20 * (1 - max(abs(t.price - trough_avg) / trough_avg for t in (t1, t2, t3))
                   / PEAK_EQUALITY_PCT)
        score += max(0, _round_half_up(eq))
        v1 = _avg_volume(candles, _idx(candles, t1.time) - 2, _idx(candles, t1.time) + 2)
        v3 = _avg_volume(candles, i_t3 - 2, i_t3 + 2)
        if v3 > v1 * 1.1:
            score += 15
            confs.append("Volume higher on 3rd bottom (accumulation)")
        elif v3 > v1:
            score += 8
        if broke_above:
            bp = (candles[break_bar].close - resistance) / resistance
            if bp > 0.02:
                score += 25
                confs.append("Breakout >2% above resistance")
            else:
                score += 15
                confs.append("Breakout confirmed")
        else:
            latest_close = candles[-1].close
            if (resistance - latest_close) / resistance < 0.01:
                score += 5
        i_t1 = _idx(candles, t1.time)
        if i_t3 - i_t1 >= 15:
            score += 10
            confs.append("Pattern spans 15+ bars")
        peak_sim = abs(m1.price - m2.price) / max(m1.price, 1e-9)
        if peak_sim < 0.03:
            score += 10
            confs.append("Intervening peaks at similar level")

        confidence = min(_round_half_up(score), 100)
        if confidence < MIN_CONFIDENCE:
            continue
        entry_price = candles[break_bar].close if broke_above else None
        stop_price = trough_avg * (1 - STOP_CUSHION_PCT)
        target_price = resistance + (resistance - trough_avg) * TARGET_MULT_REVERSAL
        rr = _calc_rr(entry_price, stop_price, target_price)
        # Q3: measured break-bar checklist (this detector knows break_bar;
        # the dispatcher's last-bar approximation would be wrong here).
        vol_20_chk = _avg_volume(candles, max(0, break_bar - 20), break_bar)
        return DetectedPattern(
            type="triple_bottom", direction="bullish", confidence=confidence,
            entry=entry_price, stop_loss=stop_price,
            target=target_price if target_price > 0 else None,
            entry_checklist=_build_entry_checklist(
                broke_above, False, True, rr,
                _adx(candles, len(candles) - 1),
                vol_break_measured=(vol_20_chk > 0 and candles[break_bar].volume > vol_20_chk * 1.5),
                has_neckline=True),
            risk_reward=rr, confirmations=confs,
        )
    return None


# ── Phase 4: Rounding Top / Rounding Bottom ────────────────────────────────────

def _rounding_shape(closes: List[float], seg: int = 6) -> Optional[List[float]]:
    """Segment-mean curve used by both rounding detectors; returns per-segment
    mean closes or None if too few bars."""
    means = []
    for k in range(0, len(closes) - seg + 1, seg):
        means.append(sum(closes[k:k + seg]) / seg)
    return means if len(means) >= 5 else None


def _detect_rounding_bottom(candles: List[Candle], swing_highs: List[SwingPoint],
                            swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Smooth U-shaped saucer after a decline; volume U confirms
    (chart_patterns.md §8)."""
    n = len(candles)
    if n < 45:
        return None
    window = candles[-60:]
    closes = [c.close for c in window]
    means = _rounding_shape(closes)
    if means is None:
        return None
    third = len(means) // 3
    left, mid, right = means[:third], means[third:2 * third], means[2 * third:]
    left_slope = (left[-1] - left[0]) / max(abs(left[0]), 1e-9)
    right_slope = (right[-1] - right[0]) / max(abs(right[0]), 1e-9)
    mid_slope = (mid[-1] - mid[0]) / max(abs(mid[0]), 1e-9)
    if left_slope > -0.01 or right_slope < 0.01 or abs(mid_slope) > 0.02:
        return None
    bottom = min(means)
    left_high = max(window[:20], key=lambda c: c.high).high
    depth = (left_high - bottom) / left_high
    if depth < 0.05:
        return None

    score = 35
    confs: List[str] = []
    if depth > 0.12:
        score += 20
        confs.append("Saucer depth >12%")
    elif depth > 0.08:
        score += 12
    # smoothness: segment means mostly monotonic down-then-up
    turns = sum(1 for a, b in zip(means, means[1:]) if (b - a) * (means[-1] - means[0]) < 0)
    if turns <= 2:
        score += 15
        confs.append("Smooth arc (few direction changes)")
    elif turns <= 4:
        score += 7
    vol_start = _avg_volume(candles, n - 60, n - 45)
    vol_mid = _avg_volume(candles, n - 30, n - 16)
    vol_end = _avg_volume(candles, n - 8, n - 1)
    if vol_end > vol_mid * 1.2 and vol_mid < vol_start:
        score += 15
        confs.append("Volume U-shape (contracting then expanding)")
    elif vol_end > vol_mid:
        score += 7
    neckline = left_high
    latest_close = candles[-1].close
    broke_out = latest_close > neckline
    if broke_out:
        bp = (latest_close - neckline) / neckline
        if bp > 0.02:
            score += 25
            confs.append("Breakout >2% above neckline")
        else:
            score += 15
            confs.append("Breakout confirmed")
    else:
        if (neckline - latest_close) / neckline < 0.02:
            score += 5

    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close if broke_out else None
    stop_price = bottom * (1 - STOP_CUSHION_PCT)
    target_price = neckline + (neckline - bottom) * TARGET_MULT_REVERSAL
    rr = _calc_rr(entry_price, stop_price, target_price)
    return DetectedPattern(
        type="rounding_bottom", direction="bullish", confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target_price,
        risk_reward=rr, confirmations=confs,
    )


def _detect_rounding_top(candles: List[Candle], swing_highs: List[SwingPoint],
                         swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Smooth dome after an advance; distribution volume confirms
    (chart_patterns.md §7). Mirror of the saucer logic."""
    n = len(candles)
    if n < 45:
        return None
    window = candles[-60:]
    closes = [c.close for c in window]
    means = _rounding_shape(closes)
    if means is None:
        return None
    third = len(means) // 3
    left, mid, right = means[:third], means[third:2 * third], means[2 * third:]
    left_slope = (left[-1] - left[0]) / max(abs(left[0]), 1e-9)
    right_slope = (right[-1] - right[0]) / max(abs(right[0]), 1e-9)
    mid_slope = (mid[-1] - mid[0]) / max(abs(mid[0]), 1e-9)
    if left_slope < 0.01 or right_slope > -0.01 or abs(mid_slope) > 0.02:
        return None
    dome = max(means)
    left_low = min(window[:20], key=lambda c: c.low).low
    height = (dome - left_low) / max(left_low, 1e-9)
    if height < 0.05:
        return None

    score = 35
    confs: List[str] = []
    if height > 0.12:
        score += 20
        confs.append("Dome height >12%")
    elif height > 0.08:
        score += 12
    turns = sum(1 for a, b in zip(means, means[1:]) if (b - a) * (means[-1] - means[0]) < 0)
    if turns <= 2:
        score += 15
        confs.append("Smooth arc (few direction changes)")
    elif turns <= 4:
        score += 7
    vol_start = _avg_volume(candles, n - 60, n - 45)
    vol_mid = _avg_volume(candles, n - 30, n - 16)
    vol_end = _avg_volume(candles, n - 8, n - 1)
    if vol_end > vol_mid * 1.2 and vol_mid < vol_start:
        score += 15
        confs.append("Volume expanding on the downside (distribution)")
    elif vol_end > vol_mid:
        score += 7
    neckline = left_low
    latest_close = candles[-1].close
    broke_down = latest_close < neckline
    if broke_down:
        bp = (neckline - latest_close) / neckline
        if bp > 0.02:
            score += 25
            confs.append("Breakdown >2% below neckline")
        else:
            score += 15
            confs.append("Breakdown confirmed")
    else:
        if (latest_close - neckline) / neckline < 0.02:
            score += 5

    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close if broke_down else None
    stop_price = dome * (1 + STOP_CUSHION_PCT)
    target_price = neckline - (dome - neckline) * TARGET_MULT_REVERSAL
    rr = _calc_rr(entry_price, stop_price, target_price)
    return DetectedPattern(
        type="rounding_top", direction="bearish", confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target_price,
        risk_reward=rr, confirmations=confs,
    )


# ── Phase 5: Island Reversal ────────────────────────────────────────────────────

def _detect_island_reversal(candles: List[Candle], swing_highs: List[SwingPoint],
                            swing_lows: List[SwingPoint]) -> Optional[DetectedPattern]:
    """Gap away, isolated range, gap back — trapped traders unwind
    (chart_patterns.md §10). Direction opposes the first gap."""
    n = len(candles)
    if n < 30:
        return None
    gaps = _find_gaps(candles, min_gap_pct=0.004)
    best: Optional[Tuple[int, int, str]] = None
    for a in range(len(gaps)):
        for b in range(a + 1, len(gaps)):
            g1, g2 = gaps[a], gaps[b]
            if g2["direction"] != g1["direction"]:
                island_len = g2["idx"] - g1["idx"]
                if 2 <= island_len <= 15 and g2["idx"] >= n - 12:
                    best = (g1["idx"], g2["idx"],
                            "bearish" if g1["direction"] == "up" else "bullish")
    if not best:
        return None
    gi1, gi2, direction = best
    island = candles[gi1:gi2]
    isl_high = max(c.high for c in island)
    isl_low = min(c.low for c in island)
    isl_height = isl_high - isl_low

    score = 40
    confs: List[str] = []
    base_vol = _avg_volume(candles, max(0, gi1 - 20), gi1 - 1) if gi1 >= 2 else 0
    gap_vol = (candles[gi1].volume + candles[gi2].volume) / 2
    if base_vol > 0 and gap_vol > base_vol * 1.2:
        score += 15
        confs.append("High volume on both gaps")
    # gap sizes relative to price
    g1_size = abs(candles[gi1].low - candles[gi1 - 1].high) / candles[gi1 - 1].close \
        if direction == "bearish" else abs(candles[gi1 - 1].low - candles[gi1].high) / candles[gi1 - 1].close
    if g1_size > 0.01:
        score += 10
        confs.append("Clean separation gap >1%")
    if isl_height / max(isl_high, 1e-9) < 0.05:
        score += 10
        confs.append("Compact island")
    latest_close = candles[-1].close
    if direction == "bearish":
        confirmed = latest_close < isl_low
        if confirmed:
            score += 20
            confs.append("Price left the island to the downside")
    else:
        confirmed = latest_close > isl_high
        if confirmed:
            score += 20
            confs.append("Price left the island to the upside")

    confidence = min(_round_half_up(score), 100)
    if confidence < MIN_CONFIDENCE:
        return None
    entry_price = latest_close
    if direction == "bearish":
        stop_price = isl_high * (1 + STOP_CUSHION_PCT)
        target_price = latest_close - isl_height * TARGET_MULT_REVERSAL
    else:
        stop_price = isl_low * (1 - STOP_CUSHION_PCT)
        target_price = latest_close + isl_height * TARGET_MULT_REVERSAL
    target_price = target_price if target_price > 0 else None
    rr = _calc_rr(entry_price, stop_price, target_price)
    return DetectedPattern(
        type="island_reversal", direction=direction, confidence=confidence,
        entry=entry_price, stop_loss=stop_price, target=target_price,
        risk_reward=rr, confirmations=confs,
    )



# ── Main Detection Function ──

_DETECTORS = [
    _detect_hns,
    _detect_ihns,
    _detect_double_top,
    _detect_double_bottom,
    _detect_bull_flag,
    _detect_bear_flag,
    _detect_ascending_triangle,
    _detect_descending_triangle,
    _detect_falling_wedge,
    _detect_cup_handle,
    _detect_symmetrical_triangle,
    _detect_rising_wedge,
    _detect_triple_top,
    _detect_triple_bottom,
    _detect_rounding_top,
    _detect_rounding_bottom,
    _detect_island_reversal,
]


def _calc_confidence_breakdown(candles: List[Candle], pattern: 'DetectedPattern',
                               swing_highs: List[SwingPoint],
                               swing_lows: List[SwingPoint]) -> Dict[str, int]:
    """Build institutional confidence breakdown for any pattern type."""
    conf: Dict[str, int] = {}
    close = candles[-1].close if candles else 0
    vol = candles[-1].volume if candles else 0
    avg_vol = sum(c.volume for c in candles[-20:]) / min(20, len(candles)) if candles else 1
    adx = _adx(candles, len(candles) - 1) if len(candles) > 14 else 20

    # Volume confirmation
    if vol > avg_vol * FILTERS["volume_break"]["threshold"]:
        conf["volume_break"] = FILTERS["volume_break"]["conf_boost"]

    # R:R check
    if pattern.risk_reward is not None and pattern.risk_reward >= FILTERS["rr_minimum"]["threshold"]:
        conf["rr_minimum"] = FILTERS["rr_minimum"]["conf_boost"]

    # ADX trend strength
    if adx > FILTERS["adx_filter"]["threshold"]:
        conf["adx_filter"] = FILTERS["adx_filter"]["conf_boost"]

    # Pattern symmetry (price range / close)
    if pattern.entry is not None and pattern.stop_loss is not None:
        sym_range = abs(pattern.entry - pattern.stop_loss)
        if close > 0 and sym_range / close < FILTERS["pattern_symmetry"]["threshold"]:
            conf["pattern_symmetry"] = FILTERS["pattern_symmetry"]["conf_boost"]

    # Trend context
    ma50 = _sma(candles, len(candles) - 1, 50) if len(candles) >= 50 else close
    if ma50 > 0:
        if (pattern.direction == "bullish" and close > ma50) or \
           (pattern.direction == "bearish" and close < ma50):
            conf["trend_context"] = FILTERS["trend_context"]["conf_boost"]

    # Q3/D5 repair: the type-only neckline_slope boost was removed. It granted
    # +conf to four pattern TYPES without measuring any slope ("R8" comment
    # overstated what was fixed). H&S/IHNS still earn the boost inside their
    # own breakdowns when the measured slope is actually < 1 degree.

    return conf


# ── Q1.4: cross-call emission memory (opt-in via detect_patterns(dedup=True)) ──
# Keyed on (type, direction, rounded levels); value = last emission time.
# Production polls this engine repeatedly — without suppression the same
# confirmed geometry re-floods output every request until price moves 20 bars
# of context away. Mirrors simulate_trades' R4 cooldown semantics.
_EMISSION_MEMORY: Dict[Tuple[str, str, int, int, int], str] = {}
_EMISSION_MEMORY_CAP = 4096


def _emission_signature(p: DetectedPattern) -> Tuple[str, str, int, int, int]:
    def _r(x: Optional[float]) -> int:
        return int(round(x * 100)) if x is not None else -1
    return (p.type, p.direction, _r(p.entry), _r(p.stop_loss), _r(p.target))


def detect_patterns(candles: List[Candle], swing_highs: List[SwingPoint],
                    swing_lows: List[SwingPoint],
                    regime_filter: bool = False,
                    dedup: bool = False) -> List[DetectedPattern]:
    """Dispatch all detectors and return the top-3 ranked patterns.

    Q1 opt-in quality gates (default OFF so historical calibrations and the
    trade simulator keep their measured populations):
      regime_filter — R10 parity: continuation patterns must not contradict
        the SMA50 trend context (reversals exempt by definition).
      dedup — suppress re-emission of identical (type, direction, levels)
        signatures within PATTERN_COOLDOWN_BARS across repeated calls.
    """
    if not candles:
        return []
    results: List[DetectedPattern] = []
    for detect in _DETECTORS:
        try:
            pattern = detect(candles, swing_highs, swing_lows)
            if pattern:
                # Uncalibrated patterns stay out of production output until the
                # reliability calibration has run over them; while on probation
                # they also cannot outrank validated setups.
                if (pattern.type in EXPERIMENTAL_PATTERNS
                        and not ENABLE_EXPERIMENTAL_PATTERNS):
                    continue
                if pattern.type in EXPERIMENTAL_PATTERNS:
                    pattern.confidence = min(pattern.confidence,
                                             EXPERIMENTAL_CONFIDENCE_CAP)
                # R2 repair: uniform quality gate. Dividing MIN_CONFIDENCE by
                # reliability weights < 1 produced impossible thresholds
                # (bear_flag: round(85/0.65) = 131 > max score 100 → dead code).
                # Reliability is applied downstream (ranking / sim confidence).
                if pattern.confidence < MIN_CONFIDENCE:
                    continue
                # R14 repair: per-family RR floor.
                rr_floor = _rr_floor_for(pattern.type, MIN_RR)
                if pattern.risk_reward is not None and pattern.risk_reward < rr_floor:
                    continue

                # Q1/R10 parity: continuation patterns must align with trend
                # context — mirrors simulate_trades semantics (entry vs SMA50;
                # neutral passes) so live signals carry the filter whose
                # effect the calibration actually measured.
                if regime_filter and pattern.type in CONTINUATION_PATTERNS:
                    ma50 = _sma(candles, len(candles) - 1, 50)
                    close_now = candles[-1].close
                    if ma50 > 0:
                        if close_now < ma50 and pattern.direction == "bullish":
                            continue
                        if close_now > ma50 and pattern.direction == "bearish":
                            continue

                # Q1.4: emission dedup (opt-in). Suppress identical geometry
                # re-emitted within the cooldown window across calls.
                if dedup:
                    sig = _emission_signature(pattern)
                    last_time = _EMISSION_MEMORY.get(sig)
                    fresh = True
                    if last_time is not None:
                        time_to_idx = {c.time: k for k, c in enumerate(candles)}
                        prev_idx = time_to_idx.get(last_time)
                        cur_idx = len(candles) - 1
                        if prev_idx is not None and 0 <= cur_idx - prev_idx < PATTERN_COOLDOWN_BARS:
                            fresh = False
                    if fresh:
                        _EMISSION_MEMORY[sig] = candles[-1].time
                        if len(_EMISSION_MEMORY) > _EMISSION_MEMORY_CAP:
                            # bounded memory: worst case one duplicate slips
                            # through after a clear — acceptable vs unbounded growth
                            _EMISSION_MEMORY.clear()
                    else:
                        continue

                # Ensure enhanced fields are populated (some detectors don't fill them)
                if not pattern.confidence_breakdown:
                    pattern.confidence_breakdown = _calc_confidence_breakdown(
                        candles, pattern, swing_highs, swing_lows)
                if not pattern.entry_checklist:
                    adx = _adx(candles, len(candles) - 1)
                    # Q3 honesty: post-Q1 every gated continuation emits on the
                    # CURRENT bar, so volume-on-break is measurable here without
                    # plumbing; older/unlocated breaks stay unmeasured (False).
                    vol_break: Optional[bool] = None
                    if pattern.type in CONTINUATION_PATTERNS and len(candles) >= 2:
                        vol20 = (sum(c.volume for c in candles[-21:-1])
                                 / min(20, len(candles) - 1))
                        vol_break = bool(
                            vol20 > 0 and candles[-1].volume >
                            vol20 * FILTERS["volume_break"]["threshold"])
                    pattern.entry_checklist = _build_entry_checklist(
                        broke=False, vol_declining=False, structure_valid=True,
                        rr=pattern.risk_reward, adx=adx,
                        vol_break_measured=vol_break,
                        has_neckline=pattern.type in _NECKLINE_PATTERNS,
                        preceding_trend=pattern.type in CONTINUATION_PATTERNS)
                if not pattern.failure_risk:
                    pattern.failure_risk = _estimate_failure_risk(
                        pattern.confidence, pattern.risk_reward)

                results.append(pattern)
        except Exception:
            continue
    results.sort(key=lambda p: p.confidence, reverse=True)
    return results[:3]


# ── Trade Simulation ──

MIN_BARS_HELD = 5  # exits before bar 5 are reported as early stop-outs (R5),
                   # not silently dropped; threshold separates them in stats


def simulate_trades(candles: List[Candle], patterns: List[DetectedPattern],
                    min_confidence: int = 60, min_rr: float = 1.5,
                    trend_filter: bool = True,
                    cost_r: float = 0.05,
                    cooldown_bars: int = PATTERN_COOLDOWN_BARS) -> List[TradeRecord]:
    """Sliding-window pattern trade simulation.

    Repairs applied (Phase R):
      R4  — cooldown between same-type entries (kills correlated duplicates)
      R5  — early stop-outs are recorded, not silently dropped
      R6  — transaction costs charged in R units (cost_r)
      R7  — gap-aware fills (exit at the worse of level/open)
      R10 — trend filter applies to continuation patterns only
      R11 — only swings fully confirmed by window end are used (no look-ahead)
    """
    trades: List[TradeRecord] = []
    swing_highs, swing_lows = find_swing_points(candles)
    time_to_idx = {c.time: k for k, c in enumerate(candles)}

    # Detect patterns across sliding windows
    all_patterns: List[Tuple[DetectedPattern, int]] = []
    for i in range(50, len(candles)):
        window = candles[max(0, i - 60):i + 1]
        window_times = {c.time for c in window}
        # R11 repair: a swing needs its 2 confirmation bars; swings whose
        # confirmations fall after the window end leaked future information.
        wh = [h for h in swing_highs if time_to_idx.get(h.time, -1) <= i - 2
              and h.time in window_times]
        wl = [l for l in swing_lows if time_to_idx.get(l.time, -1) <= i - 2
              and l.time in window_times]
        try:
            pats = detect_patterns(window, wh, wl)
            for p in pats:
                if p.confidence >= min_confidence:
                    all_patterns.append((p, i))
        except Exception:
            continue

    used_bars: set = set()
    last_signal_by_key: Dict[str, int] = {}
    for pat, bar_idx in all_patterns:
        if bar_idx in used_bars:
            continue
        # R4 repair: cooldown per pattern type+direction so one formation
        # cannot generate a cluster of overlapping correlated trades.
        key = f"{pat.type}|{pat.direction}"
        prev_signal = last_signal_by_key.get(key)
        if prev_signal is not None and bar_idx - prev_signal < cooldown_bars:
            continue
        entry_idx = bar_idx + 2
        if entry_idx + 1 >= len(candles):
            continue
        entry_price = candles[entry_idx].close
        # F-1 repair: reject signals whose entry price has already gapped
        # beyond the stop — the pattern's risk unit is undefined/negative
        # there and a loss would print as a positive R multiple.
        sl0 = pat.stop_loss
        if sl0 is not None:
            if pat.direction == "bullish" and entry_price <= sl0:
                continue
            if pat.direction == "bearish" and entry_price >= sl0:
                continue
        sl = pat.stop_loss
        tgt = pat.target
        # R14 repair: per-family RR floor (reversals use the relaxed classical
        # floor — their edge is win-rate, not large R multiples).
        rr_floor = _rr_floor_for(pat.type, min_rr)
        rr = _calc_rr(entry_price, sl, tgt)
        if rr is None or rr < rr_floor:
            continue

        # Volatility filter
        atr14 = _atr(candles, entry_idx, 14)
        atr50 = _atr(candles, entry_idx, 50)
        if atr50 > 0 and atr14 / atr50 > 1.5:
            continue

        # Trend filter
        ma50 = _sma(candles, entry_idx, 50)
        if trend_filter and ma50 > 0:
            if entry_price > ma50:
                trend = "uptrend"
            elif entry_price < ma50:
                trend = "downtrend"
            else:
                trend = "neutral"
        else:
            trend = "neutral"

        # R10 repair: continuation patterns must align with trend; reversal
        # patterns form against the prevailing trend by definition and are exempt.
        if trend_filter and pat.type in CONTINUATION_PATTERNS:
            if pat.direction == "bullish" and trend == "downtrend":
                continue
            if pat.direction == "bearish" and trend == "uptrend":
                continue

        # Confidence weighting
        weight = PATTERN_RELIABILITY.get(pat.type, 1.0)
        adjusted_confidence = min(99, _round_half_up(pat.confidence * weight))
        if adjusted_confidence < min_confidence:
            continue

        # Hold trade
        exit_idx = entry_idx
        exit_price = entry_price
        hit_sl = False
        hit_target = False
        moved_to_be = False
        # Initial protective stop: the WIDER of pattern stop vs a 3% buffer,
        # giving every trade at least 3% of initial risk room. This must be
        # direction-aware: min() assumed a long (stop below entry) and armed
        # bearish trades with a stop BELOW their entry price, phantom-stopping
        # every short on bar 1 — the root cause of all-zero bearish win rates
        # in earlier calibrations.
        if pat.direction == "bullish":
            stop_level = min(sl, entry_price * 0.97)
        else:
            stop_level = max(sl, entry_price * 1.03)

        for j in range(entry_idx + 1, min(entry_idx + 120, len(candles))):
            high = candles[j].high
            low = candles[j].low

            if not moved_to_be:
                if pat.direction == "bullish":
                    move_r = (high - entry_price) / (entry_price - sl)
                else:
                    move_r = (entry_price - low) / (sl - entry_price)
                if move_r >= 1.0:
                    moved_to_be = True

            if pat.direction == "bullish":
                eff_sl = entry_price if moved_to_be else stop_level
                if low <= eff_sl:
                    hit_sl = True
                    exit_idx = j
                    exit_price = min(eff_sl, candles[j].open)  # R7: gap-aware fill
                    break
                if high >= tgt:
                    hit_target = True
                    exit_idx = j
                    exit_price = max(tgt, candles[j].open)     # R7: gap-aware fill
                    break
            else:
                eff_sl = entry_price if moved_to_be else stop_level
                if high >= eff_sl:
                    hit_sl = True
                    exit_idx = j
                    exit_price = max(eff_sl, candles[j].open)  # R7: gap-aware fill
                    break
                if low <= tgt:
                    hit_target = True
                    exit_idx = j
                    exit_price = min(tgt, candles[j].open)     # R7: gap-aware fill
                    break
            exit_idx = j
            exit_price = candles[j].close

        bars_held = exit_idx - entry_idx

        if pat.direction == "bullish":
            pnl = (exit_price - entry_price) / (entry_price - sl)
        else:
            pnl = (entry_price - exit_price) / (sl - entry_price)
        pnl -= cost_r  # R6 repair: transaction costs charged in R units

        if hit_sl:
            result = "scratch" if moved_to_be else "loss"
        elif hit_target:
            result = "win"
        elif pnl > 0:
            result = "win"
        elif pnl < -0.5:
            result = "loss"
        else:
            result = "scratch"

        trades.append(TradeRecord(
            pattern_type=pat.type,
            direction=pat.direction,
            confidence=adjusted_confidence,
            entry_date=candles[entry_idx].time,
            entry_price=entry_price,
            stop_loss=sl,
            target=tgt,
            exit_date=candles[exit_idx].time,
            exit_price=exit_price,
            r_multiple=_round_half_up(pnl * 100) / 100,
            bars_held=bars_held,
            result=result,
            trend_at_entry=trend,
            confidence_breakdown=pat.confidence_breakdown,
            entry_checklist=pat.entry_checklist,
            failure_risk=pat.failure_risk,
            multi_tf_boost=pat.multi_tf_boost,
            timeframe=pat.timeframe,
        ))
        used_bars.add(bar_idx)
        last_signal_by_key[key] = bar_idx

    return trades


# ── Full Backtest Pipeline ──

def run_pattern_backtest(ticker: str, years: int = 3, min_confidence: int = 60,
                         min_rr: float = 1.5, trend_filter: bool = True) -> Dict[str, Any]:
    import yfinance as yf
    from datetime import datetime, timedelta

    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365)

    df = yf.download(ticker, start=start_date.strftime("%Y-%m-%d"),
                     end=end_date.strftime("%Y-%m-%d"), progress=False, auto_adjust=True)

    if df is None or df.empty or len(df) < 100:
        return {"error": f"Insufficient data for {ticker} ({len(df) if df is not None else 0} bars)"}

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    candles: List[Candle] = []
    for date_idx, row in df.iterrows():
        if pd.isna(row.get('Open')) or pd.isna(row.get('High')) or pd.isna(row.get('Low')) or pd.isna(row.get('Close')):
            continue
        date_str = date_idx.strftime('%Y-%m-%d') if hasattr(date_idx, 'strftime') else str(date_idx)[:10]
        candles.append(Candle(
            time=date_str,
            open=float(row['Open']),
            high=float(row['High']),
            low=float(row['Low']),
            close=float(row['Close']),
            volume=float(row.get('Volume', 0)),
        ))

    if len(candles) < 100:
        return {"error": f"Insufficient clean candles for {ticker} ({len(candles)} bars)"}

    final_trades = simulate_trades(candles, [], min_confidence=min_confidence,
                                   min_rr=min_rr, trend_filter=trend_filter)

    # Detect patterns on the latest window for current state
    swing_highs, swing_lows = find_swing_points(candles)
    latest_window = candles[-60:]
    wh = [h for h in swing_highs if any(c.time == h.time for c in latest_window)]
    wl = [l for l in swing_lows if any(c.time == l.time for c in latest_window)]
    try:
        # Q1: production signal path opts into regime parity + emission dedup
        detected_patterns = detect_patterns(latest_window, wh, wl,
                                            regime_filter=True, dedup=True)
    except Exception:
        detected_patterns = []

    # Build summary
    wins = [t for t in final_trades if t.result == "win"]
    losses = [t for t in final_trades if t.result == "loss"]
    scratches = [t for t in final_trades if t.result == "scratch"]
    total_trades = len(final_trades)
    win_rate = round(len(wins) / total_trades * 100, 1) if total_trades > 0 else 0.0
    total_r = sum(t.r_multiple for t in final_trades)
    avg_win_r = round(sum(t.r_multiple for t in wins) / len(wins), 2) if wins else 0.0
    avg_loss_r = round(sum(t.r_multiple for t in losses) / len(losses), 2) if losses else 0.0

    # Per-pattern breakdown
    per_pattern: Dict[str, Dict[str, Any]] = {}
    for t in final_trades:
        if t.pattern_type not in per_pattern:
            per_pattern[t.pattern_type] = {"wins": 0, "losses": 0, "scratches": 0, "total_r": 0.0}
        pp = per_pattern[t.pattern_type]
        if t.result == "win":
            pp["wins"] += 1
        elif t.result == "loss":
            pp["losses"] += 1
        else:
            pp["scratches"] += 1
        pp["total_r"] += t.r_multiple

    for ptype, pp in per_pattern.items():
        pt = pp["wins"] + pp["losses"] + pp["scratches"]
        pp["count"] = pt
        pp["win_rate"] = round(pp["wins"] / pt * 100, 1) if pt > 0 else 0
        pp["avg_r"] = round(pp["total_r"] / pt, 2) if pt > 0 else 0

    return {
        "ticker": ticker,
        "total_trades": total_trades,
        "wins": len(wins),
        "losses": len(losses),
        "scratches": len(scratches),
        "win_rate": win_rate,
        "total_r": round(total_r, 2),
        "avg_win_r": avg_win_r,
        "avg_loss_r": avg_loss_r,
        "trades": final_trades,
        "per_pattern": per_pattern,
        "detected_patterns": detected_patterns,
    }


# ── Multi-Timeframe Candle Aggregation ──

def aggregate_candles_to_weekly(daily_candles: List[Candle]) -> List[Candle]:
    """Aggregate daily candles into weekly OHLCV bars (Mon-Fri groups)."""
    if not daily_candles:
        return []
    from datetime import datetime
    weekly: Dict[str, List[Candle]] = {}
    for c in daily_candles:
        try:
            dt = datetime.strptime(c.time, "%Y-%m-%d")
            iso_cal = dt.isocalendar()
            week_key = f"{iso_cal[0]}-W{iso_cal[1]:02d}"
        except (ValueError, TypeError):
            week_key = c.time[:7]
        if week_key not in weekly:
            weekly[week_key] = []
        weekly[week_key].append(c)
    result: List[Candle] = []
    for week_key in sorted(weekly.keys()):
        bars = weekly[week_key]
        result.append(Candle(
            time=week_key,
            open=bars[0].open,
            high=max(b.high for b in bars),
            low=min(b.low for b in bars),
            close=bars[-1].close,
            volume=sum(b.volume for b in bars),
        ))
    return result


def aggregate_candles_to_monthly(daily_candles: List[Candle]) -> List[Candle]:
    """Aggregate daily candles into monthly OHLCV bars."""
    if not daily_candles:
        return []
    monthly: Dict[str, List[Candle]] = {}
    for c in daily_candles:
        month_key = c.time[:7]
        if month_key not in monthly:
            monthly[month_key] = []
        monthly[month_key].append(c)
    result: List[Candle] = []
    for month_key in sorted(monthly.keys()):
        bars = monthly[month_key]
        result.append(Candle(
            time=month_key,
            open=bars[0].open,
            high=max(b.high for b in bars),
            low=min(b.low for b in bars),
            close=bars[-1].close,
            volume=sum(b.volume for b in bars),
        ))
    return result


# ── Multi-Timeframe Pattern Detection ──

def detect_multi_tf_patterns(daily_candles: List[Candle]) -> List[DetectedPattern]:
    """Run pattern detection across daily, weekly, and monthly timeframes.

    Boosts confidence when patterns appear on 2+ timeframes.
    From Cross-TF Report: monthly WR 54.5% vs daily 43.3%.
    """
    daily_sh, daily_sl = find_swing_points(daily_candles)
    # Q1: the daily leg is a production signal path — opt into both gates.
    # Weekly/monthly legs keep defaults: SMA50 regime semantics on aggregated
    # bars are uncalibrated; enabling filters there would be unevidenced.
    daily_patterns = detect_patterns(daily_candles, daily_sh, daily_sl,
                                     regime_filter=True, dedup=True)

    weekly_candles = aggregate_candles_to_weekly(daily_candles)
    weekly_sh, weekly_sl = find_swing_points(weekly_candles)
    weekly_patterns = detect_patterns(weekly_candles, weekly_sh, weekly_sl)

    monthly_candles = aggregate_candles_to_monthly(daily_candles)
    monthly_sh, monthly_sl = find_swing_points(monthly_candles)
    monthly_patterns = detect_patterns(monthly_candles, monthly_sh, monthly_sl)

    all_patterns: List[DetectedPattern] = []

    for p in daily_patterns:
        p.timeframe = "daily"  # type: ignore
        p.multi_tf_boost = 1.0  # type: ignore
        all_patterns.append(p)

    for p in weekly_patterns:
        p.timeframe = "weekly"  # type: ignore
        tf_mult = TIMEFRAME_MULTIPLIERS["weekly"]
        p.confidence = min(99, _round_half_up(p.confidence * tf_mult))
        p.multi_tf_boost = tf_mult  # type: ignore
        all_patterns.append(p)

    for p in monthly_patterns:
        p.timeframe = "monthly"  # type: ignore
        tf_mult = TIMEFRAME_MULTIPLIERS["monthly"]
        p.confidence = min(99, _round_half_up(p.confidence * tf_mult))
        p.multi_tf_boost = tf_mult  # type: ignore
        all_patterns.append(p)

    for p in all_patterns:
        confluence_count = 1
        for other in all_patterns:
            if other is p:
                continue
            if other.type == p.type and other.direction == p.direction:
                confluence_count += 1
        if confluence_count >= 3:
            boost = 1.15
        elif confluence_count >= 2:
            boost = 1.10
        else:
            boost = 1.0
        p.confidence = min(99, _round_half_up(p.confidence * boost))
        p.multi_tf_boost = boost  # type: ignore

    all_patterns.sort(key=lambda p: p.confidence, reverse=True)
    return all_patterns[:5]
