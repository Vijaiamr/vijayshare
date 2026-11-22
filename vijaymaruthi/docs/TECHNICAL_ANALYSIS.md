# Technical Analysis — Complete Scenario Reference

> **Scope:** Every technical-analysis computation, pattern, threshold, scoring rule, gate,
> trade-level formula and backtest rule that exists in the VijayMaruthi platform — documented
> at code level so any engineer can predict, at a glance, what the engine will emit for a given
> chart. Built by direct reading of the source (not from memory). Each section cites `file:line`.
>
> **Source of truth:**
> - `engine/technical_analysis_report.py` — core analysis engine (5,772 lines), CLI entry point.
> - `backend/engine/pattern_engine.py` — geometric chart-pattern engine + trade simulator (3,335 lines).
> - `frontend/lib/patterns.ts` — TypeScript mirror of the pattern engine (browser parity).
> - `frontend/lib/indicators.ts` — 48 chart indicators for the browser candlestick chart (1,275 lines).
> - `frontend/lib/candlestick-patterns.ts` — 17 single/double/triple candle detectors (393 lines).
> - `frontend/lib/priceTargets.ts` — `computePriceTargets()` entry/targets/stop derivation.
> - `engine/analysis_health.py` — post-run NaN/sanity checks (v3).
> - `engine/sentiment_analyzer.py` — VADER + finance lexicon news sentiment (3rd pillar).
> - `engine/quantamental_backtester.py` — point-in-time signal backtester.

---

## 0. How to read this document

The platform runs **two independent technical engines that are intentionally kept in parity**:

| Engine | Language | Runtime | Primary consumer |
|---|---|---|---|
| **Core engine** (`technical_analysis_report.py`) | Python | Backend / cron | BUY/SELL/HOLD signal, quantamental fusion, reports, SQLite history |
| **Pattern engine** (`pattern_engine.py` / `patterns.ts`) | Python + TS | Backend + Browser | Chart overlays, Patterns tab, trade setups, backtests |

Parity is maintained operation-by-operation. This matters because **a rule that exists in one
engine but not the other is a bug** (see §13). The TS mirror uses `Math.floor(x+0.5)`
`_round_half_up` semantics — Python deliberately re-implements this (`pattern_engine.py:152`)
because Python's banker's rounding would disagree on integer confidence boundaries.

---

## 1. Data model

### 1.1 Candle / OHLCV

```
Candle(time:str, open:float, high:float, low:float, close:float, volume:float)   # pattern_engine.py:288
```

Frontend equivalents (`indicators.ts:1121`, `candlestick-patterns.ts:7`):

```
{ time:string; open:number; high:number; low:number; close:number; volume:number }
```

### 1.2 DetectedPattern (`pattern_engine.py:298`)

| Field | Meaning |
|---|---|
| `type` | pattern id, e.g. `head_and_shoulders` |
| `direction` | `"bullish"` \| `"bearish"` |
| `confidence` | integer 0–100 |
| `entry` / `stop_loss` / `target` | trade levels (`None` while forming) |
| `risk_reward` | computed `_calc_rr` |
| `confirmations` | human-readable confirmation strings |
| `status` | `forming` \| `active` \| `hit` \| `stopped` \| `expired` (set by `_calc_status`) |
| `confidence_breakdown` | per-factor boosts from `_calc_confidence_breakdown` |
| `entry_checklist` | measured go/no-go facts |
| `failure_risk` | **always `{}`** — honest absence (Q4, see §7.4) |
| `multi_tf_boost`, `timeframe` | MTF aggregation |
| `end_idx` | index of last structural point (drives status) |
| `neckline` / `structure` | legacy geometry for neckline patterns |
| `lines` / `markers` | generic chart polylines + point labels (all pattern types) |

### 1.3 TradeRecord (`pattern_engine.py:334`)

Adds `pattern_type`, `direction`, `confidence`, `entry_date/price`, `stop_loss`, `target`,
`exit_date/price`, `r_multiple`, `bars_held`, `result` (`win`\|`loss`\|`scratch`),
`trend_at_entry` (`uptrend`\|`downtrend`\|`neutral`), and the same breakdown/checklist fields.

---

## 2. Global constants (the "dials")

### 2.1 Pattern-engine constants (`pattern_engine.py:15-83`)

| Constant | Value | Meaning |
|---|---|---|
| `MIN_CONFIDENCE` | `85` | uniform gate — a pattern below this never emits |
| `MIN_RR` | `1.5` | continuation RR floor |
| `PEAK_EQUALITY_PCT` | `0.05` | double/triple tops+bottoms: peaks within ±5% = "equal" |
| `FLAG_POLE_MIN_PCT` | `0.05` | pole must travel ≥5% |
| `TRIANGLE_MIN_TOUCHES` | `4` | ≥2 touches per boundary |
| `CUP_MIN_BARS` | `20` | shorter cups are V-pullbacks |
| `STOP_CUSHION_PCT` | `0.01` | structural stop 1% beyond the level (was 5% — see R14) |
| `TARGET_MULT_CONTINUATION` | `2.0` | continuation target = 2.0× formation height |
| `TARGET_MULT_REVERSAL` | `1.0` | reversal target = 1.0× measured move |
| `RISING_WEDGE_TARGET_MULT` | `1.0` | experimental retest model |
| `RISING_WEDGE_ENTRY_MODE` | `"retest"` | experimental |
| `REVERSAL_MIN_RR` | `0.8` | relaxed floor for reversals (edge = win-rate) |
| `PATTERN_COOLDOWN_BARS` | `20` | min bars between same type+direction entries |
| `MIN_BARS_HELD` | `5` | exits before bar 5 are early stop-outs (R5) |

**R14 rationale (`pattern_engine.py:30-38`):** the old geometry (stop ±5%, target 1.5× height)
made `RR ≥ 1.5` algebraically unreachable — max RR was `1.5h/(h+0.05P) < 1.5`, so 8 of 10
detectors could *never* emit. The new 1% cushion + 2.0× continuation targets fixed this.

### 2.2 Family sets

```
REVERSAL_PATTERNS      = {head_and_shoulders, inverse_head_and_shoulders, double_top, double_bottom,
                          triple_top, triple_bottom, rounding_top, rounding_bottom, island_reversal}
CONTINUATION_PATTERNS  = {bull_flag, bear_flag, ascending_triangle, descending_triangle,
                          cup_and_handle, rising_wedge, symmetrical_triangle}
```

- Reversals form **against** the trend → exempt from the trend filter.
- Continuations **must** align with the trend (R10).

### 2.3 Reliability weights (`pattern_engine.py:209-243`)

Weights are **ranking priors only** — gating uses the uniform `MIN_CONFIDENCE` rule.

| Pattern | Weight | Measured note |
|---|---|---|
| `head_and_shoulders` | 0.65 | 50.0% WR, −0.42R/trade, n=30 |
| `inverse_head_and_shoulders` | 1.10 | 93.3% WR, +0.23R/trade, n=16 |
| `falling_wedge` | 1.15 | 32.5% WR, +0.48R/trade, n=72 (validated) |
| `cup_and_handle` | 0.90 | 44.4% WR, −0.11R/trade, n=22 |
| `symmetrical_triangle` | 0.90 | 27.6% WR, −0.18R/trade, n=405 |
| `triple_top` | 0.65 | 8.3% WR, −0.73R/trade, n=15 |
| `rising_wedge` | 1.10 | retest@1.0×: +0.25R/trade, n=16 (EXPERIMENTAL) |
| `bear_flag` / `bull_flag` / `descending_triangle` | 1.00 | post-Q1 populations too small |
| `double_top/bottom`, `ascending_triangle`, `triple_bottom`, `rounding_*`, `island_reversal` | 1.00 (default) | — |

### 2.4 Performance filters (`pattern_engine.py:247-254`)

| Filter | Threshold | WR boost | Confidence boost |
|---|---|---|---|
| `volume_break` | vol > 1.5× 20-bar avg | +5.3pp | +15 |
| `rr_minimum` | RR ≥ 2.0 | +4.1pp | +10 |
| `neckline_slope` | < 10° | +3.8pp | +10 (H&S/IHNS only, measured) |
| `adx_filter` | ADX > 25 | +4.5pp | +10 |
| `trend_context` | price on correct side of SMA50 | +2.9pp | +8 |
| `pattern_symmetry` | (entry−stop)/close < 0.10 | +2.2pp | +15 |

### 2.5 Timeframe multipliers (`pattern_engine.py:256-260`)

`daily 1.0`, `weekly 1.15`, `monthly 1.35`. MTF confluence: 2 TFs same type+direction → ×1.10;
3+ → ×1.15. Confidence capped at 99.

### 2.6 ScreenConfig — user-adjustable dials (`pattern_engine.py:86-123`)

Every field defaults to the hardcoded constant. `detect_patterns(..., screen_config=...)` saves
module-level constants, overrides them, and restores in `finally` — so the 17 detector
signatures stay unchanged. Slider bounds:

| Dial | Bounds |
|---|---|
| `min_confidence` | 50–100 |
| `min_rr` | 0.5–5.0 |
| `peak_equality_pct` | 0.01–0.15 |
| `flag_pole_min_pct` | 0.01–0.15 |
| `triangle_min_touches` | 2–10 |
| `cup_min_bars` | 10–60 |
| `stop_cushion_pct` | 0.005–0.05 |
| `target_mult_continuation` | 1.0–4.0 |
| `target_mult_reversal` | 0.5–3.0 |
| `reversal_min_rr` | 0.3–2.0 |
| `pattern_cooldown_bars` | 5–60 |
| `rising_wedge_target_mult` | 0.5–3.0 |

### 2.7 Experimental & low-edge gating

```
EXPERIMENTAL_PATTERNS          = {rising_wedge, triple_top, rounding_top, rounding_bottom, island_reversal}   # :1803
ENABLE_EXPERIMENTAL_PATTERNS   = False      # off until ≥ +0.10R on n≥50                                    # :1810
EXPERIMENTAL_CONFIDENCE_CAP    = 89         # probation cap: can't outrank a validated 90+ setup             # :1814
LOW_EDGE_PATTERNS              = {head_and_shoulders, symmetrical_triangle, bull_flag, cup_and_handle}       # :1827
ENABLE_LOW_EDGE_PATTERNS       = False      # measured-negative; excluded from production output             # :1833
```

- Experimental patterns: skipped in production output while the flag is off; when enabled they
  are capped at confidence 89 so they can't outrank validated setups (`pattern_engine.py:2789`).
- **`LOW_EDGE_PATTERNS`** are patterns that still pass the confidence gate but have measured
  negative expectancy (`head_and_shoulders` −0.42R n=30, `symmetrical_triangle` −0.19R n=409,
  `bull_flag` −0.56R n=9, `cup_and_handle` −0.11R n=22). `falling_wedge` is **deliberately NOT
  gated** — the larger 5y sample shows +0.48R (n=72), a genuine positive edge.
- Low-edge patterns stay in the engine for calibration/backtest but are filtered out at the
  **production call sites** (`run_pattern_backtest` `:3154`, `detect_multi_tf_patterns` `:3284`),
  not inside `detect_patterns` (so the test harness still sees them).

---

## 3. Layer 1 — Frontend chart indicators (48 output series)

All computed by `computeIndicators()` (`indicators.ts:1123`) and returned in the
`ComputedIndicators` bundle (48 fields: 4 EMAs + overlays + oscillators + volume + structural
overlays). Defaults are read from `IndicatorSettings` with fallbacks. Every series is
time-aligned via `zipTimes`.

### 3.1 Trend / overlay

| Indicator | Formula | Default params |
|---|---|---|
| EMA 9/20/50/200 | `ema()` seed = SMA of first N, then `(p−ema)·2/(N+1)+ema` | spans 9/20/50/200 |
| SMA (series) | rolling simple mean | `smaPeriod` 20 |
| Bollinger Bands | middle = SMA(period); σ = **sample** std (`/(period−1)`); upper/lower = mid ± kσ | `bbPeriod` 20, `bbStd` 2 |
| SuperTrend | ATR-based bands; `trendUp` flips when close crosses the opposite band; bands ratchet | mult 3, ATR 10 |
| Ichimoku | Tenkan(9)=HH+LL/2; Kijun(26); SenkouA=(tenkan+kijun)/2 shifted +26; SenkouB=52-HHLL/2 shifted +26 | 9/26/52/26 |
| Parabolic SAR | classic iterative AF step 0.02→max 0.2, clamped to bar extremes | step 0.02, max 0.2 |
| Keltner Channels | EMA(period) ± mult × Wilder-ATR(period) | 20 / 2 |
| Donchian Channels | highest-high / lowest-low over period; middle = midpoint | 20 |
| Envelopes | SMA(period) ± pct% | 20 / 2.5% |
| Anchored VWAP | cumulative Σ(TP·V)/ΣV, TP=(H+L+C)/3, anchored at first bar | — |
| Pivot point (chart) | classic PP/R1/S1 from **second-to-last** candle | — |

### 3.2 Momentum / oscillator

| Indicator | Formula | Default |
|---|---|---|
| RSI | Wilder smoothing (SMA seed then recursion); `avgL==0 → 100` | 14 |
| MACD | EMA(fast)−EMA(slow); signal = EMA(macd, signal); histogram | 12/26/9 |
| Stochastic %K/%D | raw %K over kPeriod, SMA-smooth, then D = SMA(K) | 14/3/3 |
| Stoch RSI | Stoch of RSI, K=SMA(3), D=SMA(K,3) | 14 |
| CCI | (TP − SMA(TP)) / (0.015 × mean-deviation) | 20 |
| Williams %R | `−100·(HH−close)/(HH−LL)` | 14 |
| CMO | `100·(upSum−downSum)/(upSum+downSum)` | 14 |
| ROC | `(close−close[n])/close[n]·100` | 12 |
| Momentum | `close − close[n]` | 10 |
| TRIX | % rate of change of triple EMA | 15 |
| Ultimate Oscillator | weighted (4·fast + 2·mid + slow)/7 of BP/TR windows | 7/14/28 |
| PPO | `(EMAfast−EMAslow)/EMAslow·100`, signal = EMA(9) | 12/26/9 |
| RVI | smoothed (C−O)/(H−L); signal = SMA(4) shifted 1 | 10 |
| Awesome Oscillator | SMA(median,5) − SMA(median,34) | 5/34 |
| DPO | close shifted back `floor(period/2)+1` − SMA(period) | 20 |
| Elder Ray | bull = H − EMA(period); bear = L − EMA(period) | 14 |
| Force Index | (C−prevC)·V, EMA-smoothed | 13 |
| Ease of Movement | ((H+L)/2 change) / box-ratio, SMA-smoothed | 14 |
| Mass Index | Σ EMA(range,9)/EMA(EMA(range,9),9) | 25 |
| Klinger | EMA(VF,34) − EMA(VF,55), signal EMA(13) | 34/55 |
| Aroon Up/Down | % of period since most recent high/low | 25 |

### 3.3 Volume / breadth / volatility

| Indicator | Formula | Default |
|---|---|---|
| OBV | cumulative ±volume by close direction | — |
| MFI | money-flow ratio over TP-weighted flow (0–100) | 14 |
| CMF | Σ(MFM·V)/ΣV where MFM = ((C−L)−(H−C))/(H−L) | 20 |
| ADX + +DI/−DI | Wilder-smoothed DX, smoothed again for ADX | 14 |
| ATR | Wilder-smoothed True Range | 14 |

### 3.4 Structural overlays (`indicators.ts`)

- **Swing highs/lows**: fractal window = 3; last 10 of each kept (`findSwings`).
- **Order Blocks** (`findOrderBlocks:291`): bullish = red candle + 2 green bars breaking its
  high; bearish = mirror. Strength = capped % move (max 10). Returns last 8.
- **Fair Value Gaps** (`findFVG:317`): bullish when `c3.low > c1.high`; bearish when
  `c3.high < c1.low`. Returns last 6.
- **Volume Profile** (`calcVolumeProfile:336`): 20 price rows; POC = max-volume bucket;
  Value Area = contiguous 70% of volume around POC. Exposes `isPOC`, `isVA`.
- **Fibonacci** (`calcFibonacci:379`, `:1226`): from 60-bar high/low; levels
  `0, .236, .382, .5, .618, .786, 1, 1.272, 1.414, 1.618`.
- **Trendlines** (`findTrendlines:398`): validated — anchor separation ≥5 bars,
  ≥1 intermediate touch within 1.5% tolerance, max slope 0.02/bar, project forward to last bar,
  top 2 per type ranked by touches then recency.
- **Patterns**: delegates to `detectPatterns(candles, swingHighs, swingLows, {regimeFilter:true, dedup:true, screenConfig})` (`indicators.ts:1238`).

---

## 4. Layer 2 — Candlestick patterns (17 detectors)

`detectCandlestickPatterns()` (`candlestick-patterns.ts:274`) scans every bar; requires ≥10
candles. Each detector returns a pattern with a `confidence` (clamped 10–99) and a static
`reliability` (0–1 from institutional research). Direction ∈ bullish/bearish/neutral.

> Count note: the file header comment says "18 formations"; the module actually exports **17**
> detectors (7 single + 6 double + 4 triple). The `DetectedCandlePattern.category` field is
> `"single" | "double" | "triple"`.

### 4.1 Single-candle

| Pattern | Rule | Base conf | Reliability |
|---|---|---|---|
| **Doji** | `body/range ≤ 0.1`; +15 if range > 0.8×avg; +10 if volume present | 50 | 0.45 |
| **Hammer** | `lowerWick ≥ 2·body` AND `upperWick ≤ 0.5·body` AND `range ≥ 0.5·avg`; +15 if lw>3·body; +10 if range>avg | 60 | 0.60 |
| **Hanging Man** | hammer-shape AND in uptrend (i≥5) | 55 | 0.55 |
| **Inverted Hammer** | `upperWick ≥ 2·body` AND `lowerWick ≤ 0.5·body` AND `range ≥ 0.5·avg` | 50 | 0.50 |
| **Shooting Star** | inverted-hammer-shape AND in uptrend (i≥5) | 55 | 0.55 |
| **Marubozu** | `body/range ≥ 0.85` AND both wicks ≤ 5% range AND `range ≥ 0.7·avg` | 65 | 0.65 |
| **Spinning Top** | `0.05 ≤ body/range ≤ 0.35` AND both wicks ≥ body | 40 | 0.40 |

### 4.2 Double-candle

| Pattern | Rule | Base conf | Reliability |
|---|---|---|---|
| **Bullish Engulfing** | prev bearish, curr bullish, curr body engulfs prev (`open≤prev.close`, `close≥prev.open`), `body₁ > body₀` | 65 | 0.63 |
| **Bearish Engulfing** | mirror of above | 65 | 0.63 |
| **Piercing Line** | prev bearish, curr bullish, gaps down, closes above prev midpoint but below prev open | 55 | 0.58 |
| **Dark Cloud Cover** | prev bullish, curr bearish, gaps up, closes below prev midpoint but above prev open | 55 | 0.58 |
| **Tweezer Top** | matching highs (`diff ≤ 2% range`), prev bullish / curr bearish | 50 | 0.48 |
| **Tweezer Bottom** | matching lows, prev bearish / curr bullish | 50 | 0.48 |

### 4.3 Triple-candle

| Pattern | Rule | Base conf | Reliability |
|---|---|---|---|
| **Morning Star** | bearish → small body (`≤0.4×body₀`) → bullish closing above prev midpoint | 70 | 0.72 |
| **Evening Star** | mirror of morning star | 70 | 0.72 |
| **Three White Soldiers** | 3 ascending bullish candles, each open higher, each close higher, avg body ≥ 0.3×range | 68 | 0.70 |
| **Three Black Crows** | mirror of three white soldiers | 68 | 0.70 |

Output helpers: `candlestickPatternColor` (green/red/grey), `candlestickPatternEmoji`,
`candlestickSummary` (counts + last-20 average confidence).

---

## 5. Layer 3 — Geometric chart patterns (17 detectors)

Dispatch: `_DETECTORS` list (`pattern_engine.py:2668`) → `detect_patterns` → `_detect_patterns_inner`.
Each detector is `f(candles, swing_highs, swing_lows) → DetectedPattern | None`.

### 5.0 Common pipeline (`_detect_patterns_inner:2778`)

For every detector result:

1. **Experimental gate** — skip if experimental & disabled; else cap confidence at 89.
2. **Confidence gate** — `confidence < MIN_CONFIDENCE (85)` → drop. (R2: uniform rule; the old
   `round(85/reliability)` produced impossible thresholds like 131 and killed detectors.)
3. **RR floor** — `_rr_floor_for(type, MIN_RR)` → reversals use `0.8`, continuations `1.5`.
4. **Regime parity (opt-in)** — continuations must not contradict SMA50 context (neutral passes).
5. **Emission dedup (opt-in)** — identical `(type, direction, rounded levels)` suppressed within
   `PATTERN_COOLDOWN_BARS`; `_EMISSION_MEMORY` capped at 4096 (clears on overflow).
6. **Populate** `confidence_breakdown`, `entry_checklist`, `failure_risk`, `status`.
7. Sort by confidence desc, **return top 3**.

Default call (calibration/sim) has both gates OFF so measured populations stay comparable;
production call sites pass `regime_filter=True, dedup=True`.

### 5.1 Head & Shoulders (`_detect_hns`)

**Anatomy:** LS–HD–RS with HD highest; a neckline through LS/RS lows. Direction bearish.

- Requires 3 swing highs (`LS, HD, RS`) with HD = max, LS/RS within `PEAK_EQUALITY_PCT`.
- Neckline from LS/RS lows; neckline slope measured (deg). Break = close **and** high below neckline.
- Score: base 30; symmetry; volume; neckline slope < 1° earns boost **only when measured**
  (Q3/D5 removed the type-only boost).
- Stop = neckline ×(1+1%); target = neckline − height×`TARGET_MULT_REVERSAL`.
- Checklist built with measured break-bar volume (Q3).

### 5.2 Inverse Head & Shoulders (`_detect_ihns`)

Mirror (bullish). **Decline semantics fixed (Q3):** the pre-pattern decline test now uses the
correct direction (previously `rs<ls` was inverted). Entry on close **and** high above neckline.

### 5.3 Double Top (`_detect_double_top`)

- Two swing highs within `PEAK_EQUALITY_PCT`; intervening trough between them.
- Height = peak − trough (must exceed min); breakout below trough confirms.
- Target = trough − height×`TARGET_MULT_REVERSAL`; stop = peak×(1+1%) or structure-based.
- Confidence from symmetry, volume, breakout %, span, trough similarity.

### 5.4 Double Bottom (`_detect_double_bottom`)

Mirror (bullish). Two equal troughs + intervening peak as neckline.

### 5.5 Bull Flag (`_detect_bull_flag`)

- **Pole** must travel ≥ `FLAG_POLE_MIN_PCT (5%)` up; then a tight, slightly-down consolidation
  channel (the flag). **Mandatory break** required (Q1 — a continuation *is* the trade); plus
  **2×ATR14 freshness** so the break is recent, not stale.
- Target = 2.0× flag height (continuation multiplier); stop below flag.

### 5.6 Bear Flag (`_detect_bear_flag`)

Mirror (bearish), same mandatory-break + freshness gates.

### 5.7 Ascending Triangle (`_detect_ascending_triangle`)

- Flat resistance + rising support; ≥ `TRIANGLE_MIN_TOUCHES` boundary touches; mandatory break
  + 2×ATR freshness. Bullish.

### 5.8 Descending Triangle (`_detect_descending_triangle`)

- Flat support + falling resistance; mandatory break + freshness. Bearish.

### 5.9 Falling Wedge (`_detect_falling_wedge`)

- Both rails falling, converging; validated pattern (weight 1.15, +0.48R/trade). Bullish reversal.
- Mandatory break + freshness.

### 5.10 Cup & Handle (`_detect_cup_handle`)

- Rounded base ≥ `CUP_MIN_BARS (20)`; a smaller pullback "handle" near the rim; breakout above rim.
  Weight 0.90. Mandatory break + freshness.

### 5.11 Symmetrical Triangle (`_detect_symmetrical_triangle`)

- Converging rails both directions; ≥4 touches; mandatory break + freshness. Weight 0.90.
- **Autopsy (2026-08-24):** every entry-model lever exhausted — retest entry fails, shorts lose
  in all height bands, best surviving cell +0.004R over n=179 (zero edge). No config adopted.

### 5.12 Rising Wedge (`_detect_rising_wedge`) — EXPERIMENTAL

- Both rails rising, converging; bearish. Uses **retest entry** (`RISING_WEDGE_ENTRY_MODE`),
  target 1.0× (`RISING_WEDGE_TARGET_MULT`). Evidence trail `pattern_engine.py:39-54`: break entry
  loses at every target (−0.29…−0.40R); retest@1.0× is the only positive config (+0.106R, n=47),
  but edge is regime-concentrated and thin — graduation deferred.

### 5.13 Triple Top (`_detect_triple_top`) — EXPERIMENTAL

- Three peaks within `PEAK_EQUALITY_PCT`, two intervening troughs; weight 0.65, n=15 (−0.73R).

### 5.14 Triple Bottom (`_detect_triple_bottom`)

- Three troughs within `PEAK_EQUALITY_PCT`; two similar intervening peaks.
- Score: base 30; trough equality (≤20); volume (15/8); breakout >2% (25) or confirmed (15);
  span ≥15 bars (10); similar peaks (10).
- Resistance = max(P1,P2) must exceed troughs by ≥2%.
- Entry = break-bar close; stop = troughs×(1−1%); target = resistance + height×1.0.
- Emits its **own measured break-bar checklist** (Q3).

### 5.15 Rounding Bottom (Saucer) (`_detect_rounding_bottom`) — EXPERIMENTAL

- Requires n≥45; 60-bar window; 6-bar segment means; left slope < −1%, right > +1%, mid flat.
- Depth ≥ 5%. Score: base 35; depth (20/12); smoothness (15/7); volume U-shape (15/7);
  breakout (25/15/5). Neckline = left high; entry on breakout close.

### 5.16 Rounding Top (Dome) (`_detect_rounding_top`) — EXPERIMENTAL

Mirror. Distribution volume confirmation. Neckline = left low.

### 5.17 Island Reversal (`_detect_island_reversal`) — EXPERIMENTAL

- Gap away (`min_gap_pct 0.4%`) → isolated range 2–15 bars → gap back in the **opposite**
  direction, second gap within last 12 bars. Direction opposes the first gap.
- Score: 40; high volume both gaps (15); clean gap >1% (10); compact island (10); price left
  island (20). Stop beyond island extreme; target = close ∓ island height×1.0.

### 5.18 Confidence breakdown (`_calc_confidence_breakdown:2689`)

Applied when a detector doesn't populate its own. Boosts: `volume_break` (vol>1.5× → +15),
`rr_minimum` (RR≥2 → +10), `adx_filter` (ADX>25 → +10), `pattern_symmetry`
((entry−stop)/close<0.10 → +15), `trend_context` (correct side of SMA50 → +8). **No** type-only
neckline boost (removed). Missing fields → `entry_checklist` + `failure_risk` filled downstream.

### 5.19 Status (`_calc_status`)

Computes `forming` / `active` / `hit` / `stopped` / `expired` from `end_idx`, entry/stop/target,
direction. **Only status is taken** — the detector's own entry remains authoritative (Q6).

---

## 6. Layer 4 — Core-engine analyzer modules

`TechnicalAnalysisPipeline` orchestrates 10 modules. `AnalysisResult` (`:109`) carries everything.

### 6.1 MetricsEngine (`:223`)

| Method | Returns |
|---|---|
| `moving_averages()` | SMA20/50/200, price-vs %, `above_*`, `golden_cross`, `death_cross`, `aligned_bullish`, `aligned_bearish` |
| `rsi()` | value, `Overbought`(>70)/`Oversold`(<30)/`Neutral`, flags |
| `macd()` | macd, signal, histogram, `crossover`, `above_zero`, `histogram_increasing`, `histogram_slope` |
| `bollinger()` | upper/mid/lower, `percent_b`, `bandwidth`, `squeeze`, `near_upper`, `near_lower` |
| `adx()` | adx, ±DI, `strength` (Very Strong>40 / Strong>25 / Moderate>20 / Weak), `di_bias` |
| `atr()` | atr, `percent_of_price`, `expanding`, `regime` (High>3% / Moderate>1.5% / Low) |
| `obv()` | `obv_trend`, above-sma20/50, divergence (3-bar price vs OBV), `price_obv_aligned` |
| `volume_analysis()` | avg_vol_20/50, last_volume, `volume_ratio_vs_20`, `status` (Above>1.2 / Below<0.8), `up_down_ratio_10d`, `consecutive_up_volume_days` |

> Note: `_classify_signal` reads `a['bb']` while `run_all` stores `result['bb']`; the signal
> scorer accesses `a.get('bb', {})` — consumers must pass the right keys (documented drift risk §13).

### 6.2 StructureAnalyzer (`:466`)

- `find_pivots(window=5)` → pivot highs/lows (strict vs prior, ≥ vs future).
- `identify_structure` → `Uptrend (HH+HL)`, `Downtrend (LH+LL)`, `Expanding / Volatile`,
  `Contracting / Consolidation`, else `Ranging`. Adds **BOS** (break of structure) and
  **CHOCH** (change of character) levels.
- `trendlines` → resistance slope (last 2 pivot highs) + support slope (last 2 pivot lows).

### 6.3 LevelFinder (`:578`)

- **Fib retracement** from last-3-pivot swing (fallback 60-bar H/L): levels
  `0, .236, .382, .5, .618, .786, .886, 1.0`, each with `distance_pct`, `near`(<3%), `closest`.
- **Fib extensions**: `1.272, 1.414, 1.618, 2.0, 2.618`.
- **Classic pivots**: PP, R1–R3, S1–S3 from last bar.
- **S/R from pivots**: last 126 trading days, clustered at 1.5% tolerance; strength
  `Strong`(≥3 touches)/`Moderate`(2)/`Weak`(1); splits into above/below price + flipped levels.

### 6.4 CandlestickDetector (`:737`)

Last 5 candles. Detects: Doji (`body%<10`), Marubozu (both wicks <5% range), Hammer/
Shooting Star (wick>60% & body<30%, on red candles), Bullish/Bearish Engulfing. Emits
`last_pattern` (comma-joined), `last_candle` bias, and per-candle detail.

### 6.5 DivergenceFinder (`:817`)

Regular bullish/bearish divergence over RSI, MACD, OBV by comparing the **last two** price
pivots vs the **last two** indicator pivots. (Note: the loop above the simplified path is dead
code — the operative comparison is the two-pivot block at `:857-876`.)

### 6.6 MTFAnalyzer (`:897`)

Resamples to **weekly** (`W`) and **monthly** (`ME`) OHLCV, computes RSI(14) + MACD
crossover per timeframe. Returns `{daily, weekly, monthly}`.

### 6.7 WyckoffICTAnalyzer (`:949`)

| Method | Logic |
|---|---|
| `find_order_blocks` | bullish OB = red candle + 3 greens; bearish = mirror. Strength by volume vs 20-avg |
| `find_fair_value_gaps` | bullish `h[i] < l[i+2]`; bearish `l[i] > h[i+2]`; exposes midpoint + size |
| `find_liquidity_sweeps` | sweep = break prior swing by 0.2%–2% then close back within range |
| `find_springs_upthrusts` | Spring = pierce support 0.5%–3% then close back above; Upthrust = mirror |
| `wyckoff_phase` | 60-bar: **Markup**(price>8%, vol>10%), **Markdown**, **Accumulation**(range<25%, vol<−15%), **Distribution**(range<25%, vol>15%), Markup/Markdown (vol drying), else Ranging |

### 6.8 GannCycler (`:1185`)

- **Gann Fan**: 1×1(45°), 2×1, 1×2, 3×1, 1×3, 4×1, 1×4 from nearest significant pivot.
- **dominant_cycles**: FFT dominant period + autocorrelation peak lag (detrended via 20-SMA).
- **Square of 9**: `(round(√P)+inc)²` for inc −8..+8.

### 6.9 OptionsStrategist (`:1333`)

- **Black-Scholes** price + greeks (delta/gamma/vega/theta); risk-free 6.5%.
- Uses nearest weekly expiry; IV from ATM call/put average (fallback 0.25); HV = 30-day,
  annualised ×√252; `iv_rank` High if IV>1.2×HV, Low if <0.8×HV.
- **Signal→strategy mapping**: BUY → Bull Call Spread + Long Call; SELL → Bear Put Spread +
  Long Put; IV>0.3 → Iron Condor; else Long Straddle.

### 6.10 FundamentalAnalyzer (`:1509`)

22-section fundamental engine (yfinance + manual overrides). Feeds `quick_ratings`,
`sections 08/09/12/15/17/22` used by the convolutions and gates.

---

## 7. Layer 5 — Signal generation

### 7.1 `_classify_signal` (`:4418`) — evidence scoring

Raw score normalised as `pct = (score + max) / (2·max) · 100`.

| Block | Max | Rules |
|---|---|---|
| Trend | 20 | Uptrend +15 / Downtrend −15 |
| MA alignment | 15 | above_20 +3, above_50 +5, above_200 +7 |
| RSI | 10 | 40–60 +5; ≤30 +8 (oversold bounce); ≥70 −3 |
| MACD | 10 | Bullish crossover +7; histogram increasing +3 |
| ADX | 10 | ADX>25 +5; di_bias Bullish +5 / Bearish −5 |
| Volume | 10 | Above Avg +5; up_down_ratio_10d>1.5 +5 |
| OBV | 5 | obv_trend Bullish +5 |
| Wyckoff | 10 | Markup/Accumulation +10; Markdown −10 |
| Fib position | 10 | closest 61.8%/78.6% +5 (support); 38.2%/23.6% −3 (resistance) |

**Bands:** `pct ≥ 65 → BUY`, `pct ≤ 35 → SELL`, else `HOLD`. Confidence = `round(pct)`.

**Trade levels (with degenerate-trade guard, 2026-09-04):**
- BUY: entry `[0.98p, p]`; targets from nearest resistance `[R, 1.03R, 1.07R]`; invalidation = nearest support.
- SELL: entry `[p, 1.02p]`; targets `[S, 0.97S, 0.93S]`; invalidation = nearest resistance.
- HOLD: entry `[0.98p, 1.02p]`; target = nearest resistance; invalidation = nearest support.
- **Floors:** `MIN_STOP_PCT 1.5%`, `MIN_TARGET_PCT 1.5%`, `MIN_RR 1.0`; ATR scales the
  floor (`max(1.5%, 1.5×ATR%)` for stops, `max(1.5%, 2×ATR%)` for targets). Prevents a 0.01%
  stop or 0.05% target from manufacturing a "guaranteed" trade.

### 7.2 Confluence gate (`:4619`)

- `MIN_CONFIRM = 2` (legacy; tuned 3→2 after a 10y OOS backtest — confirm≥3 only helped the
  2023–26 bull regime; confirm≥2 has small consistent edge + best tail risk).
- `TECH_BUY_MIN = 60` (tuned 65→60; 60 beat 65 on WR, return and tail risk with 2.3× signals).
- `FUND_FACTOR_FLOOR = 50`, `FUND_CAP = 65`.

### 7.3 `_technical_convolution` (`:4737`) — weighted blend

Total weight 100; each component scores in [−weight, +weight]; `raw_total ∈ [−100, +100]`
maps to `score = clamp(50 + total/2, 0, 100)`.

| Component | Weight | Scoring |
|---|---|---|
| **Pattern** (`_pattern_votes`) | 30 | calibrated bull/bear weights (see 7.3.1) |
| Trend | 15 | Uptrend +8 / Downtrend −8; above_50 +4; above_200 +3 else −3 |
| Momentum | 15 | RSI zone, MACD bull/bear, ADX, DI bias |
| Volume/OBV | 15 | Above/Below Avg, up/down ratio, OBV trend |
| Candlestick | 10 | +3 each bullish (Hammer, BullEng, Marubozu, Morning Star, Piercing); −3 each bearish |
| Oscillator/divergence | 10 | ±5 per divergence; RSI extremes ±3 |
| Wyckoff | 5 | Markup/Accumulation +5; Markdown −5 |

#### 7.3.1 `_pattern_votes` (`:4629`)

Runs `pattern_engine.detect_patterns` on last 120 bars. Weights:

```
BULL_W = {falling_wedge:8, inverse_head_and_shoulders:7, double_bottom:6, cup_and_handle:5,
          ascending_triangle:5, symmetrical_triangle:5, rounding_bottom:4, triple_bottom:4,
          island_reversal:3, bull_flag:2}
BEAR_W = {head_and_shoulders:10, rising_wedge:6, descending_triangle:6, double_top:5,
          triple_top:5, rounding_top:4, bear_flag:3, island_reversal:3, symmetrical_triangle:5}
```

- Bullish symmetrical_triangle counts **only** when `rr ≤ 3.5 AND atr_pct ≤ 1.0` (measured edge).
- `majority = bull_weight >= bear_weight` (**ties are neutral, never a veto**). Only
  `bear_weight > bull_weight` blocks a BUY.
- Emits full geometry (lines/markers/neckline/structure + confidence/status/levels/checklist)
  for the UI (2026-09-06).

### 7.4 `_fundamental_convolution` (`:4893`) — weighted factors + AND-floor

| Factor | Weight | Scoring (0–100) |
|---|---|---|
| Value | 20 | P/E, P/B, PEG bands (<15/25/40 → 100/70/40/10) |
| Growth | 20 | revenue & net-income CAGR 2y (>15/10/0 → 100/70/40/10) |
| Profitability | 20 | ROE, profit margin bands |
| Risk | 15 | D/E bands (<0.5/1/2); risk_rating Low/Moderate/High |
| Momentum | 10 | 52-week range position |
| Analyst | 10 | strong_buy 100 / buy 75 / hold 50 / else 25 |
| Dividend | 5 | yield bands (>2/1/0) |

`fund_conv = Σ(v·w)/Σw` over factors with data (neutral 50 if none). **AND-floor:** if any
factor with data scores `< 50`, `fund_conv = min(fund_conv, 65)` — a **cap, not a veto**.

### 7.5 `_apply_quality_gates` (`:5049`) — post-classification downgrades

| Gate | Trigger | Effect |
|---|---|---|
| **Data quality** | price NaN | `N/A`, conf 0 |
| | <60 rows | BUY→HOLD, conf ≤40 |
| **Liquidity (India)** | cap < ₹500 Cr | BUY→HOLD, conf ≤40 |
| | < ₹2,000 Cr | conf ≤60 |
| **Liquidity (US)** | cap < $300 M | BUY→HOLD, conf ≤40 |
| | < $2 B | conf ≤60 |
| **Volume** | avg20 < 20 k | BUY→HOLD, conf ≤40 |
| | < 100 k | conf ≤60 |
| **Leverage** | D/E > 10 | **AVOID**, conf ≤40 |
| | D/E > 5 | BUY→HOLD, conf ≤55 |
| **Broken fundamentals** | margin<0 & rev YoY<0 | BUY→HOLD, conf ≤45 |
| **Risk flags** | ≥3 warning flags | BUY→HOLD, conf ≤55 |
| **Valuation** | PE > 100 | BUY→HOLD, conf ≤55 |
| | PE > 60 & growth <10% | BUY→HOLD, conf ≤55 |
| **Confidence calibration** | fundamentals missing | conf −10 |

### 7.6 Health checks (`engine/analysis_health.py` v3)

`price_ok`, `sma_ok`, `atr_ok`, `adx_ok`, `div_sane`, `debt_sane`, `nan_ok` → `health_pass`.
Flags NaN counts, impossible debt, out-of-range divergences.

---

## 8. Layer 6 — Quantamental fusion (`_compute_quantamental:5348`)

Blends technical score + fundamental score (+ optional sentiment) with **market-cap-aware but
narrowly clamped weights**.

### 8.1 Base weights (`_cap_weight:5200`)

| Market cap | India | US | Tech/Fund |
|---|---|---|---|
| Large | > ₹50,000 Cr | > $10 B | 0.40 / 0.60 |
| Mid | ₹5,000–50,000 Cr | $1–10 B | 0.50 / 0.50 |
| Small | < ₹5,000 Cr | < $1 B | 0.60 / 0.40 |
| Unknown | — | — | 0.50 / 0.50 |

### 8.2 Adjustments (clamped to [0.45, 0.55])

- Wide Moat / Low Risk / Strong-Buy consensus each shift **+3% to fundamental** (−3% tech).
- **Sentiment pillar** (opt-in `--sentiment`): if `|score| ≥ 0.3` and `conf ≥ 40`, shift up to
  5% toward the aligned pillar (bullish sentiment → technical; bearish → fundamental), always
  bounded to the [0.45, 0.55] band.

### 8.3 Blend & rating

`blended = tech_score·tech_w + fund_score·fund_w` →

| Blended score | Rating |
|---|---|
| ≥ 80 | Strong Buy |
| ≥ 65 | Buy |
| ≥ 40 | Hold |
| ≥ 25 | Sell |
| < 25 | Strong Sell |

Evidence lists: up to 6 technical + up to 6 fundamental reasons (sentiment inserted at the
top of fundamental evidence when present).

---

## 9. Backtesting & simulation

### 9.1 `simulate_trades` (`pattern_engine.py:2891`)

Sliding window (50 → end); each window detects patterns; entries at `bar_idx + 2` close.

Repairs (Phase R):
- **R4 cooldown** — no same type+direction entry within `PATTERN_COOLDOWN_BARS`.
- **R5 early stop-outs** — exits before bar 5 recorded (not dropped).
- **R6 costs** — `cost_r = 0.05` charged in R units.
- **R7 gap-aware fills** — exit at worse of level/open.
- **R10 trend filter** — continuations only (reversals exempt).
- **R11 no look-ahead** — only swings confirmed by window end are used.
- **F-1** — reject signals whose entry already gapped beyond the stop (undefined/negative risk).
- **Volatility filter** — skip if `ATR14/ATR50 > 1.5`.
- **Confidence weighting** — `adjusted = min(99, round(confidence · reliability))`.

Exit logic: protective stop = **wider** of pattern stop vs a 3% buffer (direction-aware —
bullish `min(sl, 0.97·entry)`, bearish `max(sl, 1.03·entry)`; the old `min()` armed bearish
trades with a stop *below* entry → phantom stop-outs → all-zero bearish win rates). Move-to-BE
at +1R. Hold up to 120 bars.

Result classification: `win` / `loss` (`pnl < −0.5`) / `scratch` (moved-to-BE or `|pnl| ≤ 0.5`).

### 9.2 `run_pattern_backtest` (`:3097`)

Downloads years of daily bars (yfinance, auto-adjusted), builds candles, runs `simulate_trades`
with the ScreenConfig dials applied, detects patterns on the latest 60-bar window
(`regime_filter=True, dedup=True`), filters `LOW_EDGE_PATTERNS`, and returns: totals, wins,
losses, scratches, win_rate, total_r, avg_win_r, avg_loss_r, `trades`, `per_pattern`,
`detected_patterns`.

### 9.3 Multi-timeframe (`:3269`) — inert

`detect_multi_tf_patterns` aggregates daily→weekly (ISO week) and daily→monthly, applies the
timeframe multipliers, boosts confluence (×1.10 for 2 TFs, ×1.15 for 3+), sorts, returns top 5.
**Not wired to any API/UI path** (documented inert).

### 9.4 Quantamental backtester (`engine/quantamental_backtester.py`)

Point-in-time ticker backtester (default 5y, 20-day rebalance) → `BTSignal` / `BucketStats`
aggregation, forward-return computation, tail-risk thresholding, universe runner with
checkpointing (`_done_tickers`, `_append_ckpt`).

---

## 10. Scenario matrix — what fires when

| Market scenario | Expected detectors / signals |
|---|---|
| Strong uptrend, HH+HL, MA aligned, ADX>25 | `_classify_signal` BUY; trend block +15, MA +15, ADX +10; Wyckoff Markup +10 |
| Topping after advance | H&S (bear) weight 0.65; Rounding Top / Triple Top (experimental); MACD bearish crossover |
| Bottoming after decline | Inverse H&S (bull) weight 1.10; Double/Triple Bottom; Rounding Bottom |
| Sharp rally then tight pause | Bull Flag (mandatory break + freshness) |
| Sharp drop then tight pause | Bear Flag |
| Converging flat-top / rising-bottom | Ascending Triangle (bull); mandatory break |
| Converging flat-bottom / falling-top | Descending Triangle (bear) |
| Two equal highs, trough between | Double Top |
| Two equal lows, peak between | Double Bottom |
| Both rails converging, volatile | Symmetrical Triangle (weight 0.90, zero measured edge) |
| Falling converging rails | Falling Wedge (validated, +0.48R) |
| Rising converging rails | Rising Wedge (EXPERIMENTAL, retest entry) |
| Gap up, range, gap down | Island Reversal (bearish); mirror = bullish |
| Oversold RSI (<30) with bullish candle | RSI +8; oscillator +3; possible Hammer/Bull Engulfing |
| Overbought RSI (>70) | RSI −3; oscillator −3; possible Shooting Star/Bear Engulfing |
| Low-volume drift | Below Avg −3; OBV bearish −5; often HOLD |
| Volume spike on break | volume_break +15; WR boost +5.3pp |
| Thin micro-cap momentum BUY | Liquidity gate → HOLD, conf ≤40 |
| Loss-making + shrinking revenue | Fundamental gate → HOLD, conf ≤45 |
| Extreme leverage D/E>10 | Gate → AVOID |
| Wide-moat/strong-buy large cap | Quantamental weight shift +3% fundamental |

---

## 11. Trade-level formula summary

| Pattern family | Entry | Stop | Target |
|---|---|---|---|
| Continuation (flags/triangles/cup) | break-bar close | structural level ±1% | formation height × 2.0 |
| Reversal (H&S, doubles/triples, rounding, island) | break/pierce close | level ±1% | measured move × 1.0 |
| Signal (`_classify_signal`) | price ±2% band | nearest S/R, floored 1.5%/1.5×ATR | nearest S/R, floored 1.5%/2×ATR, min R:R 1.0 |

RR floor: continuations ≥1.5, reversals ≥0.8. Reliability applied downstream (ranking/sim).

---

## 12. UI/consumer surfaces

- **Stock deep-dive page** (`frontend/app/(app)/stock/[symbol]/page.tsx`) consumes engine
  patterns + `computeIndicators` / `detectCandlestickPatterns` / `computePriceTargets`.
- **Patterns tab** — geometry lines/markers/necklines + confidence/status/levels/checklist.
- **Chart** — 48 indicators, order blocks, FVGs, volume profile, fib, trendlines, patterns.
- **Reports** — `reports/<ticker>_report.txt` + `_data.json` + `_analysis.png` (ChartGenerator).
- **SQLite** — `reports/analysis_history.db` (`analysis_runs` + `metadata`).

---

## 13. Parity, drift risks & known limitations

1. **Two-engine parity** — Python `pattern_engine.py` ↔ TS `patterns.ts` must match
   operation-for-operation; `_round_half_up` exists solely to keep integer confidence
   boundaries identical. Any detector change must land in both.
2. **`symmetrical_triangle` has zero measured edge** (−0.18R, n=405) yet remains in production
   at weight 0.90; only its filtering in `_pattern_votes` (rr≤3.5 & atr≤1%) limits damage.
3. **Experimental patterns are off** (`ENABLE_EXPERIMENTAL_PATTERNS=False`) and capped at 89
   when enabled; they must not be assumed live.
4. **`failure_risk` is intentionally empty** — the old per-mode probabilities were invented and
   removed (Q4); UI must render honest absence.
5. **`detect_multi_tf_patterns` is inert** — not wired to any endpoint.
6. **DivergenceFinder dead code** — the `ph/ih` loop at `:848-854` is a no-op; only the
   two-pivot comparison is operative.
7. **Analysis-dict contract** — `analysis` is assembled at `technical_analysis_report.py:4167`
   with keys `ma, rsi, macd, bb, adx, atr, obv_raw, volume, raw, structure, trendlines,
   fib_retracement, fib_extension, pivot_points, sr_levels, candlestick, divergence, wyckoff`.
   `_classify_signal` is invoked at `:4299`, `_technical_convolution` at `:4308`, and
   `_compute_quantamental` at `:4315`; a refactor that renames these keys (e.g. `obv_raw` →
   `obv`) silently degrades every downstream score. Keys must stay in lockstep.
8. **Sparse-by-design output** — post-gates, live detections are intentionally rare (Q5 noted
   1 detection across a 12-ticker universe). Absence of a pattern is not absence of analysis.

---

*Generated from direct source reading. Line numbers reference the state of the repository at
time of writing and may shift with edits.*
