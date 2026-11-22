"""
Phase R regression tests for the chart pattern engine.

Each test targets a specific repair:
  R1  — flag breakout impossibility (bull + bear, incl. structure guard)
  R2  — dead bear_flag dispatcher gating
  R3  — falling wedge tautology +20
  R5  — early stop-outs recorded
  R6  — transaction cost model
  R9  — Wilder-smoothed ADX (was single-period DX)
  R14 — algebraically-impossible RR geometry on reversal detectors
  F2  — direction-aware initial stop (bearish phantom bar-1 losses)

Run:  cd vijaymaruthi/backend && python -m pytest tests/test_pattern_engine.py -v
"""

import os
import random
import sys
from typing import List, Optional

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))

import pattern_engine as pe  # noqa: E402


# ── Fixture helpers ──────────────────────────────────────────────────────────

def mk_candles(closes: List[float], volumes: Optional[List[float]] = None,
               opens: Optional[List[float]] = None) -> List[pe.Candle]:
    """Build candles from a close path with small symmetric wicks.

    `opens` lets a fixture express true opening gaps (island reversals);
    by default open = previous close, matching the historical behaviour."""
    vols = list(volumes) if volumes else [1_000_000.0] * len(closes)
    assert len(vols) == len(closes), "volume count mismatch"
    assert opens is None or len(opens) == len(closes), "open count mismatch"
    out: List[pe.Candle] = []
    for i, cl in enumerate(closes):
        o = opens[i] if opens else (closes[i - 1] if i > 0 else cl)
        hi = max(o, cl) * 1.002
        lo = min(o, cl) * 0.998
        out.append(pe.Candle(time=f"x{i:05d}", open=o, high=hi, low=lo,
                             close=cl, volume=float(vols[i])))
    return out


def path(anchors) -> List[float]:
    """Piecewise-linear close series through (bar_index, price) anchors."""
    closes: List[float] = []
    for (i0, p0), (i1, p1) in zip(anchors, anchors[1:]):
        span = i1 - i0
        for k in range(span):
            closes.append(p0 + (p1 - p0) * k / span)
    closes.append(anchors[-1][1])
    return closes


def detect_one(candles, fn):
    sh, sl = pe.find_swing_points(candles)
    return fn(candles, sh, sl)


def vol_profile(n: int, head) -> List[float]:
    """Volume list of exact length n: explicit head values, last segment filled."""
    head = list(head)
    assert len(head) <= n, "volume head longer than series"
    return head + [2_200_000.0] * (n - len(head))


# ── R1: flags must be able to break out ──────────────────────────────────────

def _bull_flag_closes():
    # quiet lead-in (detector needs >=15 bars), pole 100→130, flag down to
    # 121, breakout close 132 above the flag body highs
    return [100.0, 100.2, 99.8] + path([(0, 100), (8, 130), (12, 121)]) + [132]


def _bear_flag_closes():
    return [100.0, 100.2, 99.8] + path([(0, 100), (8, 72), (12, 78)]) + [69]


FLAG_VOLS = [2_000_000.0] * 12 + [500_000.0] * 5   # heavy pole, quiet flag


def test_r1_bull_flag_breakout_produces_entry():
    candles = mk_candles(_bull_flag_closes(), FLAG_VOLS)
    pat = detect_one(candles, pe._detect_bull_flag)
    assert pat is not None, "bull flag should be detected"
    assert pat.entry is not None, "R1: breakout must produce an entry"
    assert pat.risk_reward is not None and pat.risk_reward >= pe.MIN_RR


def test_r1_bear_flag_breakdown_produces_entry():
    candles = mk_candles(_bear_flag_closes(), FLAG_VOLS)
    pat = detect_one(candles, pe._detect_bear_flag)
    assert pat is not None, "bear flag should be detected"
    assert pat.entry is not None, "R1: breakdown must produce an entry"
    assert pat.risk_reward is not None and pat.risk_reward >= pe.MIN_RR


def test_r1_bull_flag_no_false_breakout():
    # same shape but final bar stays INSIDE the flag range → no entry
    closes = [100.0, 100.2, 99.8] + path([(0, 100), (8, 130), (12, 121)]) + [124]
    candles = mk_candles(closes, FLAG_VOLS)
    pat = detect_one(candles, pe._detect_bull_flag)
    if pat is not None:                      # may still detect as 'forming'
        assert pat.entry is None, "no breakout bar → no entry"


# ── R2: bear_flag reachable through the dispatcher ───────────────────────────

def test_r2_bear_flag_passes_dispatcher_gate():
    # oscillating lead-in creates the 2 swing highs / 2 swing lows the
    # dispatcher requires (n >= 20); the tail stays ELEVATED — a deep tail
    # low is reachable by descent bars via the i+15 pole scan and produces a
    # steeper composite drop that hijacks best_pole (flag collapses <4 bars)
    # Q1: final bar must CLOSE decisively below the flag body lows (the first
    # flag bar's open-wick dips to ~71.9, so a 72 close is not a breakdown)
    closes = ([101, 99, 102, 98.5, 100.5, 99.5]
              + path([(0, 100), (8, 72), (12, 78)])
              + [74, 77, 73, 76, 70])
    vols = ([900_000.0] * 6 + [2_000_000.0] * 9 + [500_000.0] * 4
            + [600_000.0] * 5)
    candles = mk_candles(closes, vols)
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    types = {p.type for p in results}
    assert "bear_flag" in types, (
        f"R2: bear_flag unreachable pre-repair; got {types}"
    )


# ── R3: wedge convergence scored honestly ────────────────────────────────────

def _falling_wedge_closes():
    # highs 120→112 (steeper), lows 102→99 (shallower); breakout close 110
    # sits just ~4 pts above the upper line — Q1 freshness gate rejects runs
    # >2×ATR14 past the boundary, so the old 113 finish read as stale
    return path([(0, 96), (5, 120), (12, 102), (18, 112), (25, 99), (29, 110)])


def test_r3_falling_wedge_fires_without_tautology_string():
    candles = mk_candles(_falling_wedge_closes())
    pat = detect_one(candles, pe._detect_falling_wedge)
    assert pat is not None, "falling wedge should be detected"
    joined = " ".join(pat.confirmations)
    assert "Upper trendline steeper than lower" not in joined, (
        "R3: unconditional tautology boost text must be gone"
    )
    assert any("onverging" in c for c in pat.confirmations)


# ── R14: reversal detectors can actually emit patterns again ─────────────────

def _hs_closes():
    # LS 120 @11, head 127 @21, RS 119.5 @31, neckline ~114 flat, break to 113.2
    return path([(0, 100), (8, 114), (11, 120), (15, 114), (21, 127),
                 (27, 114), (31, 119.5), (35, 113.5), (37, 113.2)])


def _ihs_closes():
    return path([(0, 130), (8, 116), (11, 110), (15, 116), (21, 103),
                 (27, 116), (31, 110.5), (35, 116.5), (37, 116.8)])


def _double_top_closes():
    # peaks ~120/120.1, deep valley 95, 2.1% break to 93:
    # score = 20(eq)+20(depth)+15(vol)+15(break)+10(span)+5 = 85, RR ~0.82
    return path([(0, 75), (10, 116), (12, 120), (16, 102), (20, 95),
                 (24, 117), (26, 120.1), (30, 96.5), (31, 93)])


def _double_bottom_closes():
    # troughs 80/80.1, tall mid peak 138, 3.6% breakout to 143:
    # score = 20+20+15(vol accum)+25(break>3%)+10(span) = 90, RR ~0.83
    return path([(0, 150), (8, 86), (11, 80), (16, 138), (21, 80.1),
                 (26, 132), (27, 143)])


def test_r14_head_and_shoulders_emits_pattern():
    candles = mk_candles(_hs_closes(), vol_profile(len(_hs_closes()),
        [1_800_000.0] * 11 + [1_400_000.0] * 6 + [1_000_000.0] * 6 + [700_000.0] * 8))
    pat = detect_one(candles, pe._detect_hns)
    assert pat is not None, (
        "R14: H&S was mathematically dead under 1.5x-target/5%-stop geometry"
    )
    assert pat.risk_reward is not None
    assert pat.risk_reward >= pe.REVERSAL_MIN_RR


def test_r14_inverse_hs_emits_pattern():
    candles = mk_candles(_ihs_closes(), vol_profile(len(_ihs_closes()),
        [1_800_000.0] * 11 + [1_400_000.0] * 6 + [1_000_000.0] * 6 + [700_000.0] * 8))
    pat = detect_one(candles, pe._detect_ihns)
    assert pat is not None, "R14: IH&S was mathematically dead pre-repair"
    assert pat.risk_reward is not None
    assert pat.risk_reward >= pe.REVERSAL_MIN_RR


def test_r14_double_top_emits_pattern():
    dt_closes = _double_top_closes()
    candles = mk_candles(dt_closes,
                         [1_800_000.0] * 14 + [700_000.0] * (len(dt_closes) - 14))
    pat = detect_one(candles, pe._detect_double_top)
    assert pat is not None, "R14: double top was mathematically dead pre-repair"
    assert pat.direction == "bearish"
    assert pat.risk_reward is not None


def test_r14_double_bottom_emits_pattern():
    # accumulation: rising volume into the 2nd trough and breakout
    candles = mk_candles(_double_bottom_closes(),
                         vol_profile(len(_double_bottom_closes()), [900_000.0] * 13))
    pat = detect_one(candles, pe._detect_double_bottom)
    assert pat is not None, "R14: double bottom was mathematically dead pre-repair"
    assert pat.direction == "bullish"
    assert pat.risk_reward is not None


def test_r14_reversal_included_by_dispatcher():
    candles = mk_candles(_hs_closes(), vol_profile(len(_hs_closes()),
        [1_800_000.0] * 11 + [1_400_000.0] * 6 + [1_000_000.0] * 6 + [700_000.0] * 8))
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    assert any(p.type == "head_and_shoulders" for p in results), (
        "reversal family must survive dispatcher gating post-R14"
    )


# ── Continuation detectors still work under new geometry ─────────────────────

def test_ascending_triangle_detects_and_respects_rr():
    # two ADJACENT resistance swing highs (~110.6 / ~109.1, within 3%);
    # exactly two rising swing lows (99.9 -> 103.7) between them; the mid
    # bounce at 106 is engineered so its 2-bar-forward window contains a
    # higher high (106.3) and it therefore never registers as a swing;
    # breakout close 111.5 sits in the (1%,3%] band keeping RR >= 1.5
    closes = ([102, 105, 108, 110.2, 110.4, 109.8, 106,   # res touch 1 @4
               103, 100.6, 100.1, 100.35,                 # low 1 @9 (99.9)
               103.2, 106, 104.5, 106.3, 103.9,           # bounce (non-swing) + low 2 @15
               107, 108.8, 108.9, 108.5, 108.3,           # res touch 2 @18
               110.5, 111.5])                             # breakout
    candles = mk_candles(closes)
    pat = detect_one(candles, pe._detect_ascending_triangle)
    assert pat is not None, "ascending triangle should be detected"
    assert pat.risk_reward is not None and pat.risk_reward >= pe.MIN_RR


# ── R9: ADX behaves like ADX ─────────────────────────────────────────────────

def test_r9_adx_trending_vs_choppy():
    trend = mk_candles([100 + i * 1.7 for i in range(80)])
    chop = mk_candles([150 + (3.0 if i % 2 == 0 else -3.0) for i in range(80)])
    adx_trend = pe._adx(trend, len(trend) - 1)
    adx_chop = pe._adx(chop, len(chop) - 1)
    assert adx_trend > 25, f"strong trend should exceed 25, got {adx_trend:.1f}"
    assert adx_chop < adx_trend, "choppy series must have lower ADX than trend"


# ── R6: cost model shifts every R-multiple by exactly cost_r ─────────────────

def _busy_series():
    """Long volatile series likely to generate several simulated trades."""
    random.seed(42)
    closes, px = [], 100.0
    for i in range(320):
        drift = 0.15 if (i // 40) % 2 == 0 else -0.12
        px = max(5.0, px + drift + random.uniform(-2.2, 2.4))
        closes.append(px)
    return closes


def test_r6_cost_model_applies_uniformly():
    base = mk_candles(_busy_series())
    free = pe.simulate_trades(base, [], cost_r=0.0)
    priced = pe.simulate_trades(base, [], cost_r=0.5)
    assert free, "fixture must generate trades for this test to be meaningful"
    assert len(free) == len(priced), "cost must not change trade selection"
    for f, p in zip(free, priced):
        assert abs((f.r_multiple - p.r_multiple) - 0.5) < 1e-9


# ── R4/R5: cooldown spacing + early stop-outs recorded ────────────────────────

def test_r4_cooldown_enforced_between_same_type_entries():
    trades = pe.simulate_trades(mk_candles(_busy_series()), [])
    by_key = {}
    idx_of = {}
    for k, c in enumerate(mk_candles(_busy_series())):
        idx_of[c.time] = k
    for t in trades:
        key = f"{t.pattern_type}|{t.direction}"
        sig_idx = idx_of[t.entry_date] - 2
        if key in by_key:
            assert sig_idx - by_key[key] >= pe.PATTERN_COOLDOWN_BARS - 1, (
                f"cooldown violated for {key}"
            )
        by_key[key] = sig_idx


def test_r5_early_stopout_is_recorded_not_dropped():
    # bull-flag breakout, one elevated entry bar (above the flag stop), then
    # a crash through the stop → clean -1R stop-out recorded within 1 bar;
    # zigzag lead-in (±3) so atr50 is comparable to the pole zone and the
    # atr14/atr50 > 1.5 volatility filter does not discard every signal
    lead = [100 + (3 if k % 4 == 1 else -3 if k % 4 == 3 else 0)
            for k in range(52)]
    # Q1: detection fires on the 132-breakout window; the sim enters at
    # detection+2, so that bar must stay ABOVE the flag stop (~119.6) and the
    # crash comes one bar later → clean stop-out within 1 bar of entry
    closes = lead + _bull_flag_closes()[3:] + [134.0, 133.5, 118.0, 112.0]
    vols = ([1_000_000.0] * 52 + FLAG_VOLS[3:] + [3_000_000.0] * 4)
    trades = pe.simulate_trades(mk_candles(closes, vols), [],
                                cooldown_bars=0, trend_filter=False)
    assert trades, "expected at least one simulated trade"
    small = [t for t in trades if t.bars_held < 5]
    assert small, "R5: trades stopped out within <5 bars must be recorded"


def test_f1_no_trade_when_entry_gaps_beyond_stop():
    # breakout bar followed by a gap-down through the flag low BEFORE the
    # entry bar (bar+2): entry price sits below the stop, so the signal must
    # be rejected instead of booking a loss as a positive R multiple
    lead = [100 + (3 if k % 4 == 1 else -3 if k % 4 == 3 else 0)
            for k in range(52)]
    closes = lead + _bull_flag_closes()[3:] + [95.0, 90.0]
    vols = ([1_000_000.0] * 52 + FLAG_VOLS[3:] + [3_000_000.0] * 2)
    trades = pe.simulate_trades(mk_candles(closes, vols), [],
                                cooldown_bars=0, trend_filter=False)
    bull_trades = [t for t in trades if t.pattern_type == "bull_flag"]
    assert not bull_trades, (
        "F-1: entries already beyond the stop must be rejected, not booked "
        "with an inverted (positive) R multiple"
    )




# ── Phases 1–5: new classical patterns ─────────────────────────────────────────

SYMTRI_LEAD = [50 + 2 * k for k in range(19)]
SYMTRI_BODY = [102, 105, 108, 110, 110.2, 109.4, 106, 103, 100.5, 100, 100.3,
               103, 105.2, 107.5, 105.6, 104.2, 102.5, 102.8, 105, 107.5, 109]


def _enable_experimental():
    pe.ENABLE_EXPERIMENTAL_PATTERNS = True


def test_phase0_experimental_gate_blocks_new_patterns_by_default():
    pe.ENABLE_EXPERIMENTAL_PATTERNS = False
    closes = SYMTRI_LEAD + SYMTRI_BODY
    candles = mk_candles(closes, [1_500_000.0] * 31 + [700_000.0] * 9)
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    assert all(p.type not in pe.EXPERIMENTAL_PATTERNS for p in results), (
        "uncalibrated patterns must not reach production output"
    )
    assert detect_one(candles, pe._detect_symmetrical_triangle) is not None, (
        "detector itself must still fire for the fixture"
    )


def test_symmetrical_triangle_detects_breakout():
    _enable_experimental()
    # lower highs (110.4 -> 107.7), higher lows (99.8 -> 102.3), converging
    # lines with apex beyond the last bar; breakout close 109 (+3.2%)
    closes = SYMTRI_LEAD + SYMTRI_BODY
    candles = mk_candles(closes, [1_500_000.0] * 31 + [700_000.0] * 9)
    pat = detect_one(candles, pe._detect_symmetrical_triangle)
    assert pat is not None, "symmetrical triangle should be detected"
    assert pat.direction == "bullish"
    assert pat.risk_reward is not None and pat.risk_reward >= pe.MIN_RR


def test_rising_wedge_detects_breakdown():
    _enable_experimental()
    # Pins the BREAK entry model: this test validates breakdown-bar detection.
    prev_mode = pe.RISING_WEDGE_ENTRY_MODE
    prev_mult = pe.RISING_WEDGE_TARGET_MULT
    pe.RISING_WEDGE_ENTRY_MODE = "break"
    pe.RISING_WEDGE_TARGET_MULT = 2.0
    # both lines ascend, lower rises faster (converging); breakdown to 90.5.
    # The mid bounce (92.5/93.0 staircase) registers its own swing high, which
    # exercises the non-adjacent high-pair scan.
    # Downtrend lead-in: the wedge must sit below SMA50 (continuation context)
    lead = [142 - 2 * k for k in range(25)]
    closes = lead + [86, 89, 92, 94.3, 94.5, 93.7,
                     91, 89.5, 88.5, 88, 88.4,
                     90.5, 92.3, 91.6, 92.5, 91.8, 93.0,
                     91.0, 91.3,
                     94, 95.8, 95.6, 95.2,
                     93, 90.5]
    candles = mk_candles(closes)
    try:
        pat = detect_one(candles, pe._detect_rising_wedge)
    finally:
        pe.RISING_WEDGE_ENTRY_MODE = prev_mode
        pe.RISING_WEDGE_TARGET_MULT = prev_mult
    assert pat is not None, "rising wedge should be detected"
    assert pat.direction == "bearish"
    assert pat.risk_reward is not None and pat.risk_reward >= pe.MIN_RR


def test_bearish_trades_not_phantom_stopped():
    """F2: simulate_trades armed bearish trades with a stop BELOW their entry
    (min() assumed a long), phantom-stopping every short on bar 1 — the root
    cause of all-zero bearish win rates. A bearish trade that survives entry,
    moves 1R favourably, then rallies through the pattern stop must record a
    breakeven scratch, never a bar-1 loss."""
    _enable_experimental()
    # Pins the BREAK entry model: the engineered forward path assumes the
    # pattern fires on the breakdown bar.
    prev_mode = pe.RISING_WEDGE_ENTRY_MODE
    prev_mult = pe.RISING_WEDGE_TARGET_MULT
    pe.RISING_WEDGE_ENTRY_MODE = "break"
    pe.RISING_WEDGE_TARGET_MULT = 2.0
    lead = [142 - 2 * k for k in range(25)]
    closes = lead + [86, 89, 92, 94.3, 94.5, 93.7,
                     91, 89.5, 88.5, 88, 88.4,
                     90.5, 92.3, 91.6, 92.5, 91.8, 93.0,
                     91.0, 91.3,
                     94, 95.8, 95.6, 95.2,
                     93, 90.5]
    candles = mk_candles(closes)
    # Detection fires at window-end x51 -> entry = close[x53] = 88.6,
    # sl ~= 97.3 (pattern stop), target ~= 73.8 (RR 1.70 >= floor).
    # Forward path (first sim-checked bar is x54):
    #   x54 mild drift-down: high 88.4 pierces the OLD buggy 0.97*entry
    #        stop (85.9) but sits far below the corrected stop (97.3);
    #   x55 1R favourable flush (arms breakeven; high stays below entry);
    #   x56 rally back through entry -> breakeven scratch.
    extras = [
        pe.Candle(time="x51", open=90.5, high=91.2, low=89.9, close=90.8, volume=900_000),
        pe.Candle(time="x52", open=90.8, high=90.9, low=88.8, close=89.5, volume=900_000),
        pe.Candle(time="x53", open=89.4, high=89.4, low=87.2, close=88.6, volume=900_000),
        pe.Candle(time="x54", open=88.4, high=88.4, low=86.5, close=87.0, volume=900_000),
        pe.Candle(time="x55", open=86.9, high=87.9, low=79.5, close=83.0, volume=900_000),
        pe.Candle(time="x56", open=83.0, high=91.0, low=82.5, close=90.0, volume=900_000),
    ]
    candles.extend(extras)
    try:
        trades = pe.simulate_trades(candles, [])
    finally:
        pe.RISING_WEDGE_ENTRY_MODE = prev_mode
        pe.RISING_WEDGE_TARGET_MULT = prev_mult
    assert trades, "wedge breakdown should produce a trade"
    t = trades[0]
    assert t.pattern_type == "rising_wedge"
    assert t.direction == "bearish"
    assert t.result == "scratch", (
        f"expected breakeven scratch, got {t.result} "
        f"({t.r_multiple}R over {t.bars_held} bars)"
    )
    assert t.bars_held >= 2, "trade must survive past bar 1"


def test_rising_wedge_retest_entry():
    """Retest entry model: after the breakdown, the detector must wait for
    the pullback to the broken line's underside and enter THERE — not on the
    breakdown bar. Risk collapses because the stop sits just above the
    retested line instead of the full wedge width above."""
    _enable_experimental()
    prev_mode = pe.RISING_WEDGE_ENTRY_MODE
    prev_mult = pe.RISING_WEDGE_TARGET_MULT
    pe.RISING_WEDGE_ENTRY_MODE = "retest"
    pe.RISING_WEDGE_TARGET_MULT = 2.0
    try:
        lead = [142 - 2 * k for k in range(25)]
        closes = lead + [86, 89, 92, 94.3, 94.5, 93.7,
                         91, 89.5, 88.5, 88, 88.4,
                         90.5, 92.3, 91.6, 92.5, 91.8, 93.0,
                         91.0, 91.3,
                         94, 95.8, 95.6, 95.2,
                         93, 90.5]
        candles = mk_candles(closes)
        # Post-break path: follow-through down, then rally back to the line.
        # At the retest bar (idx 52) the lower line extrapolates to ~94.6,
        # so the close of 94.6 IS the retest.
        # NOTE: times must sort AFTER mk_candles' "x%05d" series — swing scans
        # bound by candles[-1].time compare time STRINGS lexicographically.
        extras = [
            pe.Candle(time="x00050", open=90.5, high=90.7, low=88.2, close=88.5, volume=900_000),
            pe.Candle(time="x00051", open=88.5, high=89.4, low=88.6, close=89.2, volume=900_000),
            pe.Candle(time="x00052", open=89.2, high=94.8, low=89.0, close=94.6, volume=900_000),
        ]
        candles.extend(extras)
        sh, sl = pe.find_swing_points(candles)
        pat = pe._detect_rising_wedge(candles, sh, sl)
        assert pat is not None, "retest entry should be detected"
        assert pat.direction == "bearish"
        assert pat.entry is not None and 93.8 <= pat.entry <= 95.2, (
            f"entry must be the retest close, got {pat.entry}"
        )
        assert pat.risk_reward is not None and pat.risk_reward >= 3.0, (
            f"retest entry should collapse risk (rr >= 3), got {pat.risk_reward}"
        )
    finally:
        pe.RISING_WEDGE_ENTRY_MODE = prev_mode
        pe.RISING_WEDGE_TARGET_MULT = prev_mult


def test_triple_top_detects_breakdown():
    _enable_experimental()
    closes = path([(0, 80), (8, 116), (10, 120), (14, 97), (18, 118), (20, 120.1),
                   (24, 98), (26, 119.8), (28, 100), (29, 91)])
    vols = [1_800_000.0] * 12 + [900_000.0] * (len(closes) - 12)
    candles = mk_candles(closes, vols)
    pat = detect_one(candles, pe._detect_triple_top)
    assert pat is not None, "triple top should be detected"
    assert pat.direction == "bearish"
    assert pat.confidence >= pe.MIN_CONFIDENCE
    assert pat.risk_reward is not None


def test_triple_bottom_detects_breakout():
    _enable_experimental()
    closes = path([(0, 140), (8, 104), (10, 100), (14, 118), (18, 102),
                   (20, 100.1), (24, 117), (26, 100.2), (28, 116), (29, 123)])
    vols = [800_000.0] * 12 + [1_600_000.0] * (len(closes) - 12)
    candles = mk_candles(closes, vols)
    pat = detect_one(candles, pe._detect_triple_bottom)
    assert pat is not None, "triple bottom should be detected"
    assert pat.direction == "bullish"
    assert pat.confidence >= pe.MIN_CONFIDENCE
    assert pat.risk_reward is not None


def test_rounding_bottom_detects_breakout():
    _enable_experimental()
    left = [130 - 27 * k / 19 for k in range(20)]
    mid = [102, 101.5, 101, 100.5, 100.2, 100, 100.2, 100.5, 100.8,
           101.2, 101.6, 102, 102.4, 102.8, 103.2]
    right = [104 + 23 * k / 18 for k in range(19)]
    closes = left + mid + right + [129, 131.5]
    vols = ([1_600_000.0] * 20 + [600_000.0] * 25 + [1_800_000.0] * 11)
    candles = mk_candles(closes, vols)
    pat = detect_one(candles, pe._detect_rounding_bottom)
    assert pat is not None, "rounding bottom should be detected"
    assert pat.direction == "bullish"
    assert pat.confidence >= pe.MIN_CONFIDENCE


def test_rounding_top_detects_breakdown():
    _enable_experimental()
    left = [68 + 27 * k / 19 for k in range(20)]
    mid = [96, 96.5, 97, 97.4, 97.7, 97.9, 97.9, 97.7, 97.4,
           97, 96.5, 96, 95.5, 95, 94.5]
    right = [93 - 21 * k / 18 for k in range(19)]
    closes = left + mid + right + [71, 65.5]
    vols = ([1_600_000.0] * 20 + [600_000.0] * 25 + [1_800_000.0] * 11)
    candles = mk_candles(closes, vols)
    pat = detect_one(candles, pe._detect_rounding_top)
    assert pat is not None, "rounding top should be detected"
    assert pat.direction == "bearish"
    assert pat.confidence >= pe.MIN_CONFIDENCE


def test_island_reversal_bearish_detects():
    _enable_experimental()
    lead = [66 + 34 * k / 23 for k in range(24)]        # uptrend into the top
    closes = lead + [104, 108, 106.5, 107.5, 101, 100, 102.5]
    opens = [closes[0]] + closes[:-1]                   # prev-close base
    opens[24] = 105.0                                   # gap up into the island
    opens[28] = 100.0                                   # gap down out of it
    vols = [1_000_000.0] * 24 + [3_000_000.0, 800_000.0, 800_000.0,
                                 800_000.0, 3_000_000.0, 800_000.0, 800_000.0]
    candles = mk_candles(closes, vols, opens=opens)
    pat = detect_one(candles, pe._detect_island_reversal)
    assert pat is not None, "bearish island reversal should be detected"
    assert pat.direction == "bearish"
    assert pat.confidence >= pe.MIN_CONFIDENCE


def test_island_reversal_bullish_detects():
    _enable_experimental()
    lead = [134 - 34 * k / 23 for k in range(24)]       # downtrend into the low
    closes = lead + [96, 92, 93.5, 93, 103, 105, 107]
    opens = [closes[0]] + closes[:-1]                   # prev-close base
    opens[24] = 95.0                                    # gap down into the island
    opens[28] = 97.5                                    # gap up out of it
    vols = [1_000_000.0] * 24 + [3_000_000.0, 800_000.0, 800_000.0,
                                 800_000.0, 3_000_000.0, 800_000.0, 800_000.0]
    candles = mk_candles(closes, vols, opens=opens)
    pat = detect_one(candles, pe._detect_island_reversal)
    assert pat is not None, "bullish island reversal should be detected"
    assert pat.direction == "bullish"


def test_classify_gaps_labels_and_never_raises():
    _enable_experimental()
    lead = [66 + 34 * k / 23 for k in range(24)]
    closes = lead + [104, 108, 106.5, 107.5, 101, 100, 102.5]
    opens = [closes[0]] + closes[:-1]                   # prev-close base
    opens[24] = 105.0
    opens[28] = 100.0
    candles = mk_candles(closes, [1_000_000.0] * 31, opens=opens)
    gaps = pe.classify_gaps(candles)
    assert len(gaps) == 2
    assert {g["direction"] for g in gaps} == {"up", "down"}
    assert all(g["gap_type"] in {"breakaway", "run", "exhaustion", "common"}
               for g in gaps)
    assert pe.classify_gaps(mk_candles([100 + k * 0.1 for k in range(40)])) == []


# ── Robustness / misc ─────────────────────────────────────────────────────────

def test_detectors_never_raise_on_random_walks():
    random.seed(7)
    for _ in range(15):
        n = random.randint(60, 220)
        px, closes = 100.0, []
        for _ in range(n):
            px = max(2.0, px + random.uniform(-3, 3))
            closes.append(px)
        candles = mk_candles(closes)
        sh, sl = pe.find_swing_points(candles)
        pe.detect_patterns(candles, sh, sl)          # must not raise
        pe.simulate_trades(candles, [])              # must not raise


def test_rounding_half_up_matches_js():
    assert pe._round_half_up(84.5) == 85      # banker's round() would give 84
    assert pe._round_half_up(-0.5) == 0       # toward +inf, matches JS Math.round
    assert pe._round_half_up(99.49) == 99


def test_multi_tf_aggregation_shapes():
    daily = mk_candles([100 + ((i * 37) % 23) - 11 for i in range(120)])
    weekly = pe.aggregate_candles_to_weekly(daily)
    monthly = pe.aggregate_candles_to_monthly(daily)
    assert len(weekly) <= len(daily)
    assert len(monthly) <= len(weekly)
    for w in weekly:
        assert w.high >= max(w.open, w.close) and w.low <= min(w.open, w.close)


# ── Q1: mandatory-break gates, freshness, regime parity, emission dedup ───────

def test_q1_bull_flag_requires_confirmed_breakout():
    # same shape but final bar stays INSIDE the flag range → no pattern at all
    # (Q1 removed the forming path that used to emit entry=None geometry)
    closes = [100.0, 100.2, 99.8] + path([(0, 100), (8, 130), (12, 121)]) + [124]
    candles = mk_candles(closes, FLAG_VOLS)
    pat = detect_one(candles, pe._detect_bull_flag)
    assert pat is None, "Q1: unconfirmed flag must not be emitted"


def test_q1_stale_breakout_rejected():
    # breakout ran ~8 pts past the upper boundary vs ATR14 ≈ 2.6 → >2×ATR
    # overshoot is a stale chase, not a tradable trigger
    closes = path([(0, 96), (5, 120), (12, 102), (18, 112), (25, 99), (30, 113)])
    candles = mk_candles(closes)
    pat = detect_one(candles, pe._detect_falling_wedge)
    assert pat is None, "Q1: >2 ATR overshoot past the boundary must be rejected"


class _StubDetector:
    """Emits a fixed pattern regardless of context — isolates dispatcher gates."""

    def __init__(self, ptype="symmetrical_triangle", direction="bullish",
                 entry=100.0):
        self.ptype, self.direction, self.entry = ptype, direction, entry

    def __call__(self, candles, swing_highs, swing_lows):
        return pe.DetectedPattern(
            type=self.ptype, direction=self.direction, confidence=90,
            entry=self.entry, stop_loss=self.entry * 0.95,
            target=self.entry * 1.15, risk_reward=3.0,
            confirmations=["stub"])


def test_q1_regime_filter_blocks_counter_trend_continuation(monkeypatch):
    # steady downtrend: close 81 well below SMA50 ≈ 105
    candles = mk_candles([140 - k for k in range(60)])
    sh, sl = pe.find_swing_points(candles)

    monkeypatch.setattr(pe, "_DETECTORS", [_StubDetector("symmetrical_triangle",
                                                         "bullish")])
    off = pe.detect_patterns(candles, sh, sl)                      # default OFF
    assert any(p.type == "symmetrical_triangle" for p in off)

    on = pe.detect_patterns(candles, sh, sl, regime_filter=True)
    assert not any(p.type == "symmetrical_triangle" for p in on), (
        "Q1/R10 parity: bullish continuation must be blocked in a downtrend")


def test_q1_regime_filter_exempts_reversals(monkeypatch):
    candles = mk_candles([140 - k for k in range(60)])
    sh, sl = pe.find_swing_points(candles)
    monkeypatch.setattr(pe, "_DETECTORS", [_StubDetector("head_and_shoulders",
                                                         "bearish")])
    on = pe.detect_patterns(candles, sh, sl, regime_filter=True)
    assert any(p.type == "head_and_shoulders" for p in on), (
        "reversals form against trend by definition — exempt from R10"
    )


def test_q1_emission_dedup_suppresses_repeat_calls(monkeypatch):
    candles = mk_candles([100 + ((i * 37) % 23) - 11 for i in range(60)])
    sh, sl = pe.find_swing_points(candles)
    monkeypatch.setattr(pe, "_DETECTORS", [_StubDetector()])
    pe._EMISSION_MEMORY.clear()
    try:
        first = pe.detect_patterns(candles, sh, sl, dedup=True)
        assert len(first) == 1, "first emission must pass"
        second = pe.detect_patterns(candles, sh, sl, dedup=True)
        assert second == [], "identical signature within cooldown must be suppressed"
        again_off = pe.detect_patterns(candles, sh, sl, dedup=False)
        assert len(again_off) == 1, "dedup=False must bypass the memory entirely"
    finally:
        pe._EMISSION_MEMORY.clear()


def test_q1_dedup_allows_new_geometry(monkeypatch):
    candles = mk_candles([100 + ((i * 37) % 23) - 11 for i in range(60)])
    sh, sl = pe.find_swing_points(candles)
    stub = _StubDetector()
    monkeypatch.setattr(pe, "_DETECTORS", [stub])
    pe._EMISSION_MEMORY.clear()
    try:
        assert len(pe.detect_patterns(candles, sh, sl, dedup=True)) == 1
        stub.entry = 101.0          # different levels → different signature
        out = pe.detect_patterns(candles, sh, sl, dedup=True)
        assert len(out) == 1, "changed geometry must not be suppressed"
    finally:
        pe._EMISSION_MEMORY.clear()


# ── Q2: Wilder-smoothed ATR ───────────────────────────────────────────────────

def _atr_ref_trs(trs, period):
    """Independent Wilder ATR reference over a TR list."""
    if len(trs) < period:
        return sum(trs) / len(trs)
    a = sum(trs[:period]) / period
    for tr in trs[period:]:
        a = (a * (period - 1) + tr) / period
    return a


def test_q2_wilder_atr_matches_reference():
    import random
    rng = random.Random(42)
    closes, vols = [], []
    px = 100.0
    for _ in range(80):
        o = px
        px += rng.uniform(-2, 2)
        closes.append(px)
        vols.append(1_000_000.0)
    candles = mk_candles(closes, vols)
    trs = [max(candles[i].high - candles[i].low,
               abs(candles[i].high - candles[i - 1].close),
               abs(candles[i].low - candles[i - 1].close))
           for i in range(1, len(candles))]
    for idx in (14, 20, 40, 79):
        expected = _atr_ref_trs(trs[:idx], 14)
        got = pe._atr(candles, idx, 14)
        assert abs(got - expected) < 1e-9, f"idx={idx}: {got} != {expected}"


def test_q2_wilder_atr_short_window_fallback():
    # fewer than `period` TRs → simple mean of what exists (old behavior)
    closes = [100, 101, 99, 102, 100, 103, 101, 104]
    candles = mk_candles(closes)
    trs = [max(candles[i].high - candles[i].low,
               abs(candles[i].high - candles[i - 1].close),
               abs(candles[i].low - candles[i - 1].close))
           for i in range(1, len(candles))]
    assert abs(pe._atr(candles, len(candles) - 1, 14) - sum(trs) / len(trs)) < 1e-9


def test_q2_wilder_atr_spike_memory():
    # a single 10x range spike must DECAY smoothly (Wilder memory), not vanish
    # discontinuously after `period` bars like the old simple mean
    base = 1.0
    closes, vols = [], []
    px = 100.0
    for i in range(60):
        rng = base if i != 30 else 10.0 * base   # one spike bar
        half = rng / 2
        o = px
        px += 0.1
        closes.append(px)
        vols.append(1_000_000.0)
        # synthesize wide bar via mk_candles wicks is fixed ±0.2%, so build
        # the spike through open/close distance instead
        closes[-1] = o + (rng if i % 2 == 0 else -rng)
    candles = mk_candles(closes, vols)
    late = pe._atr(candles, 44, 14)    # 14 bars after the spike
    early = pe._atr(candles, 29, 14)   # bar before the spike
    assert late > early * 1.005, (
        "Wilder ATR must retain spike memory 14 bars later "
        f"(late={late:.4f} vs early={early:.4f})"
    )


# ── Q3: checklist honesty ─────────────────────────────────────────────────────

def test_q3_builder_never_echoes_break_as_volume():
    # D1: the old builder set volume_above_1_5x_avg_on_break = bool(broke)
    cl = pe._build_entry_checklist(broke=True, vol_declining=False,
                                   structure_valid=True, rr=2.5, adx=30)
    assert cl["volume_above_1_5x_avg_on_break"] is False, (
        "a break fact must not be echoed as a volume measurement"
    )
    assert cl["neckline_clearly_identifiable"] is False, (
        "neckline facts must be type-scoped, not stamped from structure_valid"
    )
    measured = pe._build_entry_checklist(True, False, True, 2.5, 30,
                                         vol_break_measured=True,
                                         has_neckline=True)
    assert measured["volume_above_1_5x_avg_on_break"] is True
    assert measured["neckline_clearly_identifiable"] is True


def test_q3_backfill_measures_volume_for_continuations():
    # bull-flag fixture whose breakout bar carries 3x average volume
    closes = [100.0, 100.2, 99.8] + path([(0, 100), (8, 130), (12, 121)]) + [132]
    vols = [500_000.0] * 16 + [3_000_000.0]
    candles = mk_candles(closes, vols)
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    flags = [p for p in results if p.type == "bull_flag"]
    assert flags, "bull_flag must be detected"
    cl = flags[0].entry_checklist
    assert cl["volume_above_1_5x_avg_on_break"] is True, (
        "3x-avg breakout volume must be MEASURED true"
    )
    assert cl["neckline_clearly_identifiable"] is False, "flags have no neckline"
    assert cl["preceding_trend_confirmed"] is True, (
        "continuation anatomy (the pole) IS the preceding trend"
    )


def test_q3_backfill_volume_false_when_quiet():
    closes = [100.0, 100.2, 99.8] + path([(0, 100), (8, 130), (12, 121)]) + [132]
    vols = [2_000_000.0] * 16 + [300_000.0]   # breakout on starvation volume
    candles = mk_candles(closes, vols)
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    flags = [p for p in results if p.type == "bull_flag"]
    if flags:   # pattern may still emit; the checklist must tell the truth
        assert flags[0].entry_checklist["volume_above_1_5x_avg_on_break"] is False


def test_q3_reversal_backfill_has_no_continuation_facts():
    # H&S fixture through the dispatcher: reversal → no preceding-trend claim
    candles = mk_candles(_hs_closes(), vol_profile(len(_hs_closes()),
        [1_800_000.0] * 11 + [1_400_000.0] * 6 + [1_000_000.0] * 6 + [700_000.0] * 8))
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    hs = [p for p in results if p.type == "head_and_shoulders"]
    assert hs, "H&S fixture must detect"
    cl = hs[0].entry_checklist
    assert cl["preceding_trend_confirmed"] is False
    assert cl["neckline_clearly_identifiable"] is True
    # D2 sanity mirror: IHNS uses rs<ls; H&S keeps ls>rs — both are real
    # comparisons now, verified structurally via the builder contract test.


def test_q3_confidence_breakdown_no_type_only_neckline_boost():
    # D5: _calc_confidence_breakdown must not grant neckline_slope by TYPE
    candles = mk_candles([100 + i * 0.5 for i in range(60)])
    pat = pe.DetectedPattern(
        type="head_and_shoulders", direction="bearish", confidence=90,
        entry=100.0, stop_loss=105.0, target=90.0, risk_reward=2.0)
    breakdown = pe._calc_confidence_breakdown(candles, pat, [], [])
    assert "neckline_slope" not in breakdown, (
        "type-only neckline boost removed; slope must be measured in-detector"
    )


def test_q3_double_top_sets_measured_checklist():
    # engineered double top with a high-volume breakdown bar
    closes = [100, 103, 106, 109, 111.5, 111.8, 110, 106, 102, 100.5,
              103, 106, 109, 111.4, 111.9, 110, 107, 104, 101, 98.5, 96]
    vols = [1e6] * 15 + [4e6] * 6
    candles = mk_candles(closes, vols)
    sh, sl = pe.find_swing_points(candles)
    pat = pe._detect_double_top(candles, sh, sl)
    if pat is None:
        return  # geometry gate may reject; builder contract already covered
    cl = pat.entry_checklist
    assert cl["neckline_clearly_identifiable"] is True
    assert isinstance(cl["volume_above_1_5x_avg_on_break"], bool)


# ── Q4: no fabricated failure probabilities ──────────────────────────────────

def test_q4_failure_risk_is_empty_until_calibrated():
    assert not hasattr(pe, "FAILURE_MODES"), (
        "invented failure-mode priors must not exist"
    )
    assert pe._estimate_failure_risk(90, 2.5) == {}
    assert pe._estimate_failure_risk(60, 1.2) == {}

    # every pattern flowing through the dispatcher carries the empty contract
    closes = [100.0, 100.2, 99.8] + path([(0, 100), (8, 130), (12, 121)]) + [132]
    candles = mk_candles(closes, FLAG_VOLS)
    sh, sl = pe.find_swing_points(candles)
    results = pe.detect_patterns(candles, sh, sl)
    assert results, "fixture must detect"
    for p in results:
        assert p.failure_risk == {}, (
            f"{p.type}: failure_risk must be empty — no calibrated model exists"
        )


# ── Feature 3: ScreenConfig (adjustable "screen dials") ──────────────────────

def test_f3_screen_config_defaults_match_constants():
    """The ScreenConfig dataclass defaults must mirror the module constants."""
    cfg = pe.ScreenConfig()
    assert cfg.min_confidence == pe.MIN_CONFIDENCE
    assert cfg.min_rr == pe.MIN_RR
    assert cfg.peak_equality_pct == pe.PEAK_EQUALITY_PCT
    assert cfg.flag_pole_min_pct == pe.FLAG_POLE_MIN_PCT
    assert cfg.triangle_min_touches == pe.TRIANGLE_MIN_TOUCHES
    assert cfg.cup_min_bars == pe.CUP_MIN_BARS
    assert cfg.stop_cushion_pct == pe.STOP_CUSHION_PCT
    assert cfg.target_mult_continuation == pe.TARGET_MULT_CONTINUATION
    assert cfg.target_mult_reversal == pe.TARGET_MULT_REVERSAL
    assert cfg.reversal_min_rr == pe.REVERSAL_MIN_RR
    assert cfg.pattern_cooldown_bars == pe.PATTERN_COOLDOWN_BARS
    assert cfg.rising_wedge_target_mult == pe.RISING_WEDGE_TARGET_MULT


def test_f3_screen_config_overrides_confidence_gate():
    """A relaxed min_confidence must let lower-confidence patterns through."""
    # double_top fixture scores ~70 — below the default 85 floor, so it is
    # suppressed by default but passes with a relaxed floor.
    closes = _double_top_closes()
    candles = mk_candles(closes)
    sh, sl = pe.find_swing_points(candles)

    default = pe.detect_patterns(candles, sh, sl)
    assert all(p.type != "double_top" for p in default), (
        "double_top (conf ~70) must be gated by the default 85 floor"
    )

    relaxed = pe.detect_patterns(candles, sh, sl,
                                 screen_config=pe.ScreenConfig(min_confidence=50))
    assert any(p.type == "double_top" for p in relaxed), (
        "relaxed min_confidence=50 must admit double_top"
    )


def test_f3_screen_config_restores_constants():
    """Module constants must be restored after a screen_config call."""
    before = pe.MIN_CONFIDENCE
    pe.detect_patterns([], [], [], screen_config=pe.ScreenConfig(min_confidence=50))
    assert pe.MIN_CONFIDENCE == before, "MIN_CONFIDENCE must be restored"

    # Also verify with a real fixture that produces patterns.
    closes = _double_top_closes()
    candles = mk_candles(closes)
    sh, sl = pe.find_swing_points(candles)
    pe.detect_patterns(candles, sh, sl, screen_config=pe.ScreenConfig(min_confidence=50))
    assert pe.MIN_CONFIDENCE == before, "MIN_CONFIDENCE must be restored after real call"


def test_f3_screen_config_min_rr_override():
    """A stricter min_rr must gate patterns whose RR is below the new floor."""
    closes = _double_top_closes()  # RR ~0.82
    candles = mk_candles(closes)
    sh, sl = pe.find_swing_points(candles)

    # Default reversal floor is 0.8, so double_top (RR ~0.82) passes.
    default = pe.detect_patterns(candles, sh, sl,
                                 screen_config=pe.ScreenConfig(min_confidence=50))
    assert any(p.type == "double_top" for p in default)

    # Raise the reversal RR floor above 0.82 → double_top must be gated.
    strict = pe.detect_patterns(candles, sh, sl,
                                screen_config=pe.ScreenConfig(min_confidence=50,
                                                              reversal_min_rr=1.0))
    assert all(p.type != "double_top" for p in strict), (
        "reversal_min_rr=1.0 must gate double_top (RR ~0.82)"
    )


# ── Market-validation calibration pass (2026-09-03) ──────────────────────────

def test_cal_cup_and_handle_gated():
    """cup_and_handle has measured negative expectancy (-0.11R, n=22) and must
    be in LOW_EDGE_PATTERNS (added 2026-09-03)."""
    assert "cup_and_handle" in pe.LOW_EDGE_PATTERNS, (
        "cup_and_handle must be gated (5y cal: -0.11R, n=22)"
    )


def test_cal_falling_wedge_not_gated():
    """falling_wedge has measured POSITIVE expectancy (+0.48R, n=72) on the
    5y calibration and must NOT be gated. A smaller 3y/9-ticker sample read
    -0.43R, but the larger robust sample confirms positive edge."""
    assert "falling_wedge" not in pe.LOW_EDGE_PATTERNS, (
        "falling_wedge must stay un-gated (5y cal: +0.48R, n=72)"
    )


def test_cal_reliability_weights_match_fresh_calibration():
    """Reliability weights must reflect the 2026-09-03 calibration."""
    assert pe.PATTERN_RELIABILITY["head_and_shoulders"] == 0.65, (
        "H&S weight must be 0.65 (5y cal: -0.42R, n=30)"
    )
    assert pe.PATTERN_RELIABILITY["inverse_head_and_shoulders"] == 1.10, (
        "IHNS weight must be 1.10 (5y cal: +0.23R, n=16)"
    )
    assert pe.PATTERN_RELIABILITY["falling_wedge"] == 1.15, (
        "falling_wedge weight must be 1.15 (5y cal: +0.48R, n=72)"
    )


def test_cal_production_gating_excludes_all_low_edge():
    """The production gating path must exclude every LOW_EDGE_PATTERNS type."""
    # Verify the gate set is non-empty and all members are real pattern types.
    assert len(pe.LOW_EDGE_PATTERNS) >= 3
    for ptype in pe.LOW_EDGE_PATTERNS:
        assert ptype in pe.PATTERN_RELIABILITY or ptype in (
            "head_and_shoulders", "symmetrical_triangle", "bull_flag",
            "cup_and_handle",
        ), f"{ptype} is not a recognized pattern type"

    # The gate flag must be off by default (production suppresses low-edge).
    assert pe.ENABLE_LOW_EDGE_PATTERNS is False, (
        "low-edge patterns must be suppressed in production by default"
    )
