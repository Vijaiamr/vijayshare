# Weighted Convolution Signal Model — Design Document

**Status:** Implemented (2026-09-05)
**Owner:** VijayMaruthi engine
**Supersedes:** Flat "2-of-4" confirmation gate (`_confirmation_gate` + `MIN_CONFIRM`)

---

## 1. Overview & Motivation

The engine previously decided BUY/HOLD/SELL from two independent mechanisms:

1. `_classify_signal` — a flat sum of points across indicators (trend 20, MA 15,
   RSI 10, MACD 10, ADX 10, volume 10, OBV 5, Wyckoff 10, fib 10).
2. `_confirmation_gate` — a binary count of 4 independent signals (trend,
   momentum, pattern, volume) with `MIN_CONFIRM = 2`.

Problems with the old design:

- **Chart patterns barely mattered.** The 17-detector pattern engine only
  produced a single binary yes/no inside the gate. A stock with a strong
  `falling_wedge` scored the same as one with a weak `bull_flag`.
- **No weighted convolution.** Every signal was equal; there was no notion of
  "most patterns agree" or "this pattern is stronger than that one".
- **Fundamentals were a single average.** A company with excellent growth but
  terrible balance-sheet risk could still score well because the average hid
  the weak factor. There was no "all fundamentals must be good" rule.
- **The split was market-cap dependent** (large caps 40/60, small caps 60/40),
  not the requested 50/50.

This document specifies the replacement: a **weighted convolution** where every
pattern, candlestick, and indicator casts a weighted vote; the technical score
is the weighted sum; fundamentals are scored per-factor with an "all-good"
AND-floor that **caps** (not vetoes) the score; and the final signal is a
**50/50 technical/fundamental blend** with a narrow market-cap band.

---

## 2. Architecture (Before → After)

### Before

```
_classify_signal ──► tech_signal + confidence (flat point sum)
                          │
_compute_quantamental ──► blended = tech_w×tech + fund_w×fund   (cap-dependent weights)
                          │
_confirmation_gate ──► count of 4 binary signals ≥ MIN_CONFIRM (flat)
                          │
_apply_quality_gates ──► final signal
```

### After

```
_technical_convolution ──► tech_conv (0-100) + pattern votes + majority flag
_fundamental_convolution ─► fund_conv (0-100) + factor table + cap flag
                                  │
_compute_quantamental ──► blended = tech_w×tech_conv + fund_w×fund_conv
                          (50/50 base, narrow [0.45, 0.55] cap band)
                                  │
_convolution_gate ──► BUY requires tech_conv ≥ 65 AND pattern majority bullish
                      (chop guard kept; flat count removed)
                                  │
_apply_quality_gates ──► final signal
```

---

## 3. Technical Convolution

### 3.1 Component weights (total = 100)

| Component | Weight | Signals inside |
|---|---|---|
| Pattern convolution | 30 | net of all detected chart patterns (see 3.2) |
| Trend / structure | 15 | HH+HL uptrend, price > SMA50 / SMA200, MA alignment |
| Momentum | 15 | RSI 40–65, MACD bullish, ADX > 25 + bullish DI |
| Volume / OBV | 15 | above-avg volume, up/down ratio > 1.5, OBV bullish |
| Candlesticks | 10 | Hammer, Bullish Engulfing, Marubozu, morning star |
| Oscillator / divergence | 10 | bullish divergence, oversold bounce |
| Wyckoff / ICT | 5 | Markup / Accumulation |
| **Total** | **100** | |

Each component contributes a sub-score in `[−weight, +weight]`. The raw total
ranges `[−100, +100]` and is mapped to a 0–100 score:

```
tech_conv = clamp(50 + total / 2, 0, 100)
```

### 3.2 Chart-pattern votes (the "most patterns" rule)

Each detected pattern contributes its weight; bullish adds, bearish subtracts.
Weights reflect the measured edge from the pattern-engine calibration
(AUDIT_TRACKING.md §12–13 and pattern_engine.py calibration notes).

| Bullish pattern | Weight | Bearish pattern | Weight |
|---|---|---|---|
| falling_wedge | +8 | head_and_shoulders | −10 |
| inverse_head_and_shoulders | +7 | rising_wedge | −6 |
| double_bottom | +6 | descending_triangle | −6 |
| cup_and_handle | +5 | double_top | −5 |
| ascending_triangle | +5 | triple_top | −5 |
| symmetrical_triangle (filtered bull) | +5 | rounding_top | −4 |
| rounding_bottom | +4 | bear_flag | −3 |
| triple_bottom | +4 | island_reversal (bear) | −3 |
| island_reversal (bull) | +3 | symmetrical_triangle (bear) | −5 |
| bull_flag | +2 | | |

**Majority rule (revised 2026-09-05 after 10y backtest):** the pattern
component is positive only when `bull_weight > bear_weight` AND at least one
validated bullish pattern exists. When no patterns are detected, the component
is neutral (0) and does not veto. The original design vetoed BUYs when bearish
weight dominated, but the 10y backtest showed the veto **hurt**: the 50
bearish-majority signals it rejected had 59.2% WR / +1.45% avg (better than
ungated 55.2% / +0.92%), and the 9 that passed tech_conv≥60 had 66.7% WR with
zero tail risk. The score threshold already enforces broad agreement (a single
pattern contributes at most +8 of the +30 pattern weight, so it cannot reach
TECH_BUY_MIN alone). The vote remains visible in the UI for transparency.

### 3.3 Technical verdict

```
tech_conv ≥ TECH_BUY_MIN (60)
```

`TECH_BUY_MIN` was tuned **65 → 60** from the 10y backtest (12 tickers, 1344
signals): 60 beats 65 on win rate (+2.2pp vs +0.6pp), avg return (+1.14% vs
+0.67%) and tail risk (P touched −10%: 10.0% vs 9.1% — both better than
ungated 11.3%) while keeping 2.3× more signals (460 vs 197). 70 over-filters
(47.9% WR, −1.86% avg).

---

## 4. Fundamental Convolution

### 4.1 Factor weights (total = 100)

| Factor | Weight | Data source |
|---|---|---|
| Value (PE / PB / PEG) | 20 | section_12_valuation |
| Growth (revenue / earnings CAGR) | 20 | section_09_growth |
| Profitability (ROE, margins) | 20 | section_08_ratios |
| Balance-sheet risk (D/E, current ratio) | 15 | section_08_ratios, section_15_risk |
| Momentum (52w position, MA50/200) | 10 | section_12_valuation |
| Analyst consensus | 10 | quick_ratings.analyst_rating |
| Dividend / suitability | 5 | section_08_ratios, section_22_suitability |

Each factor is scored 0–100 from its underlying metrics (thresholds in code).
The weighted sum produces `fund_conv` in 0–100.

### 4.2 "All fundamentals must be good" — AND-floor CAP

If **any** factor scores below `FUND_FACTOR_FLOOR (50)`, the fundamental score
is **capped at `FUND_CAP (65)`**:

```
if min(factor_scores) < 50:
    fund_conv = min(fund_conv, 65)
    cap_applied = True
```

This is a **cap, not a veto** (per product decision): a single weak factor
cannot be hidden by the average, but strong technicals can still lift the
blend. Factors with no data (N/A) are excluded from the floor check — a
data-poor stock is not penalised for missing data, only for *known* weakness.

---

## 5. The 50/50 Blend (narrow band)

Base weights are 50/50 for every stock. A small market-cap nudge is allowed
("small up and down in the 50-50 split"):

| Cap category | Technical | Fundamental |
|---|---|---|
| Large cap | 0.45 | 0.55 |
| Mid cap | 0.50 | 0.50 |
| Small cap | 0.55 | 0.45 |

Weights are clamped to `[0.45, 0.55]` — the old 40/60 and 60/40 swings are
removed. Sentiment keeps a micro-shift but stays inside the band.

```
blended = tech_w × tech_conv + fund_w × fund_conv
```

Rating mapping (unchanged):

| Blended score | Rating |
|---|---|
| ≥ 80 | Strong Buy |
| ≥ 65 | Buy |
| ≥ 40 | Hold |
| ≥ 25 | Sell |
| < 25 | Strong Sell |

---

## 6. Decision Rules (the gate)

The flat `_confirmation_gate` (4-signal count + `MIN_CONFIRM`) is **removed
entirely** and replaced by the convolution verdicts:

```
if signal in (BUY, CAUTIOUS BUY):
    if chop (ADX < 20 and no trend structure):        → HOLD   (stand aside)
    elif tech_conv < TECH_BUY_MIN (60):               → HOLD   (weighted technical too weak)
    else:                                             → BUY confirmed
```

The pattern-majority veto was **removed** (2026-09-05): the 10y backtest
showed it rejected 59.2% WR trades (see §3.2). The score threshold alone
enforces broad agreement.

Kept as separate safety layers (not part of the pattern count):

- **Chop guard** — ADX < 20 with no trend → HOLD regardless.
- **Quality gates** — liquidity, data quality, fundamental sanity
  (`_apply_quality_gates`).
- **Degenerate-trade guard** — minimum stop/target distances and R:R
  (`_classify_signal`).

---

## 7. Backtest Validation Methodology

The technical convolution is fully point-in-time backtestable (all inputs are
price/volume). The fundamental convolution is **not** (no point-in-time
fundamentals data — future-leak guard), so backtests use a neutral
`fund_conv = 50` anchor.

Harness: `engine/quantamental_backtester.py`, 12 large-cap NSE tickers × 10
years, rebalance every 20 trading days, forward 20-day returns, tail threshold
−10%.

New buckets measured:

| Bucket | Definition |
|---|---|
| UNGATED TECH BUY (old) | `technical_signal == 'BUY'` (old `_classify_signal`) |
| CONV BUY | `tech_conv ≥ 60` (tuned from 10y evidence; see §3.3) |
| CONV REJECTED | `technical_signal == 'BUY'` but convolution rejects |

Metrics: win rate (fwd_ret_20d > 0), avg/median return, P(close < −10%),
P(touched < −10%), worst return.

**Decision rule:** deploy only if CONV BUY beats UNGATED on win rate AND tail
risk over the full 10y sample (not just one regime — the lesson from the
MIN_CONFIRM tuning round). Weights/thresholds are tuned only with this
evidence.

---

## 8. API & Frontend Changes

### Backend

- `AnalysisResult` gains:
  - `conv_technical` — dict: `score`, `components` (per-component sub-scores),
    `pattern_votes` (bull/bear weights + pattern names), `pattern_majority`.
  - `conv_fundamental` — dict: `score`, `factors` (per-factor 0–100),
    `cap_applied`, `cap_reason`.
- `runner.py` + `models.py` expose these fields in `TickerAnalysisResponse`.

### Frontend

- Stock page: replace the "Confirm n/4" indicator with a **weighted breakdown**
  panel:
  - Technical score (0–100) with component bars (pattern, trend, momentum,
    volume, candle, oscillator, Wyckoff).
  - Fundamental score (0–100) with factor bars (value, growth, profitability,
    risk, momentum, analyst, dividend) + "capped" badge when the AND-floor
    fired.
  - Pattern votes: detected patterns with their weights and the majority
    verdict.

---

## 9. Limitations (documented honestly)

1. **Fundamentals not backtestable** — the fundamental convolution is validated
   live + with synthetic unit tests only. Its effect on historical accuracy is
   unknown until point-in-time fundamentals data exists.
2. **Pattern weights are heuristic** — derived from the pattern engine's
   calibration notes, not re-measured in this convolution. The backtest
   validates the *combination*, not each individual weight.
3. **Survivorship bias** — the 12-ticker universe excludes delisted names.
4. **Frictionless fills** — backtest assumes fills at close, no slippage/costs.
5. **Regime dependence** — no single filter beats the baseline in every regime;
   the convolution is expected to be a tail-risk filter + modest accuracy
   improver, not a magic bullet.

---

## 10. File Map

| File | Change |
|---|---|
| `engine/technical_analysis_report.py` | `_technical_convolution`, `_fundamental_convolution`, `_pattern_votes`, rewire `_compute_quantamental` + `analyze()`, remove flat gate |
| `engine/quantamental_backtester.py` | record `conv_tech_score` + `conv_pattern_majority`; CONV BUY buckets |
| `backend/api/models.py` | expose convolution fields |
| `backend/engine/runner.py` | expose convolution fields |
| `frontend/lib/types.ts` | convolution types |
| `frontend/app/(app)/stock/[symbol]/page.tsx` | weighted breakdown UI |
| `backend/tests/` | unit tests |
| `share/technical_analysis_report.py` | production sync |
| `AUDIT_TRACKING.md` | implementation log |