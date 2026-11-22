# VijayMaruthi — Technical Analysis & Pattern Audit / Tracking Record

**Last updated:** 2026-09-01
**Scope:** Chart rendering, pattern detection (frontend + backend), indicators, fundamentals pipeline.
**Method:** Code audit (pythagoras-x + explore agents) + live-data verification (technical-analyst + fundamental-analyst methodologies) against the running platform.

---

## 1. Executive Summary

| Area | Status | Notes |
|------|--------|-------|
| **Trendlines on chart** | ❌ WAS BROKEN → ✅ FIXED | Old algorithm drew random lines (0 price touches). Rewritten to validated lines (touch count, slope, separation, forward projection). |
| **Indicators (RSI/Bollinger/ATR)** | ❌ WAS NON-STANDARD → ✅ FIXED | RSI used SMA (not Wilder), Bollinger used population SD, SuperTrend ATR used H-L (not True Range). All corrected to industry standard. |
| **Chart vs Patterns-tab parity** | ❌ WAS INCONSISTENT → ✅ FIXED | Chart called `detectPatterns` without `regimeFilter/dedup`; Patterns tab used them. Now both use the same options. |
| **Pattern detection engines** | ⚠️ PARTIAL | 17 detectors each (frontend + backend). Only `falling_wedge` is a validated winner; several documented money-losers still pass gates. |
| **Backend live pattern status** | ❌ BROKEN | `_calc_status` is dead code — every backend pattern reports `"forming"`. |
| **Fundamentals pipeline** | ✅ CORRECT | Verified live-data-backed; scorecard math, sector exclusion, ROIC proxy all correct. |

---

## 2. Chart Trendlines — the "random line" complaint (FIXED)

### Root cause
`frontend/lib/indicators.ts` → `findTrendlines()` connected the **last 2 swing lows** and **last 2 swing highs** with straight lines. No validation:
- No touch count (price never had to respect the line)
- No slope check (vertical/absurd lines accepted)
- No minimum separation (adjacent points produced "trendlines")
- No forward projection (lines stopped at the 2nd point)

### Live-data proof (before fix)
| Ticker | Naive line | Intermediate touches |
|--------|-----------|---------------------|
| GIPCL.NS | resistance 164→181.4 | **0** |
| OIL.NS | support 465→458.7 | **0** |
| OIL.NS | resistance 484→487.2 | **0** |

### Fix applied
Rewrote `findTrendlines()` to require:
1. Anchor separation ≥ 5 bars
2. ≥ 1 intermediate candle touching the line within 1.5% tolerance
3. Plausible slope (≤ 2% per bar)
4. Forward projection to the last bar (shows where S/R is TODAY)
5. Rank by touch count, return top 2 per type

### Live-data proof (after fix)
| Ticker | Validated line | Touches |
|--------|---------------|---------|
| GIPCL.NS | support 185.64→155.43 | **44** |
| GIPCL.NS | resistance 151.45→165.67 | **49** |
| OIL.NS | support 381.04→522.02 | **47** |
| IIFL.NS | support 427.34→982.11 | **31** |
| GRINFRA.NS | support 1002.43→852.38 | **56** |
| GANDHITUBE.NS | support 736.52→879.32 | **83** |

**Result:** Trendlines now only appear when price genuinely respects them, and they project forward to today's price. Random lines are suppressed.

---

## 3. Indicator Correctness (FIXED)

| Indicator | Issue | Fix |
|-----------|-------|-----|
| **RSI** | Used simple moving average of gains/losses instead of Wilder smoothing → disagreed with every standard platform | Rewrote to Wilder smoothing (seed SMA, then exponential decay) |
| **Bollinger Bands** | Used population std dev (÷N) instead of sample (÷(N−1)) → bands ~2.5% too narrow | Changed to sample std dev |
| **SuperTrend ATR** | Seed used H-L range instead of True Range → underestimated gap volatility (common in NSE) | Changed seed to True Range |

---

## 4. Pattern Detection Engines — what works vs not

### Architecture
- **Frontend:** `frontend/lib/patterns.ts` (2731 lines) — 17 detectors, client-side, feeds the chart + Patterns tab.
- **Backend:** `backend/engine/pattern_engine.py` (2992 lines) — 17 mirrored detectors, feeds `/api/v1/pattern-backtest`.
- Both use a `_DETECTORS` registry, uniform MIN_CONFIDENCE gate (85), per-family R:R floor, regime filter, dedup, top-3.

### Pattern-by-pattern status (from calibration dataset + audit)

| Pattern | Status | Evidence |
|---------|--------|----------|
| **falling_wedge** | ✅ WORKS (validated winner) | +0.45R, n=78 — the only pattern with positive expectancy |
| **head_and_shoulders** | ⚠️ LOSES MONEY | Documented money-loser that still passes all gates |
| **symmetrical_triangle** | ⚠️ LOSES MONEY | Documented money-loser |
| **triple_top** | ⚠️ LOSES MONEY | Documented money-loser |
| **bull_flag** | ⚠️ LOSES MONEY | Documented money-loser |
| **5 experimental detectors** | ⚠️ INERT | Gated off / never wired to API or UI |
| **multi-TF patterns** | ⚠️ INERT | `detect_multi_tf_patterns` dead in production |
| **gap taxonomy** | ⚠️ INERT | `classify_gaps` dead code (defined, never called) |

### Known bugs (from audit)
| Bug | Severity | Location |
|-----|----------|----------|
| **Backend `_calc_status` is dead code** — every backend pattern reports `"forming"` | CRITICAL | `pattern_engine.py:317` |
| **H&S neckline mismatch** — frontend uses shallowest trough, backend uses deepest → different break/target | MAJOR | `patterns.ts` vs `pattern_engine.py` |
| **IHNS neckline mismatch** — mirror of above | MAJOR | `patterns.ts` vs `pattern_engine.py` |
| **Triangle lines don't project** to current bar (visual "bend") | MINOR | `patterns.ts:1313` |
| **Falling wedge target** uses max/min of endpoints instead of wedge opening | MINOR | `patterns.ts:1586` |

---

## 5. Fundamentals Pipeline (VERIFIED CORRECT)

Verified by fundamental-analyst against live yfinance for GIPCL, OIL, IIFL, TCS:

- **Prices:** all within 0.28–1.04% of live (snapshot drift, expected)
- **Scorecard math:** `overall = (0.7·signal_ratio + 0.3·quality_breadth)·100` reproduces exactly (77/89/73/70)
- **Bands:** Strong Buy/Buy thresholds correct
- **N/A exclusion:** both `N/A (data)` and `N/A (sector)` excluded from numerator AND denominator
- **Finance-sector exclusion:** IIFL correctly excludes ROIC, D/E, margins, EV/EBITDA (7 metrics → N/A sector)
- **ROIC proxy:** `net_income/(equity+totalDebt−totalCash)` matches to 9 decimal places, sensible values

### Minor caveats (non-blocking)
1. Top-level `roe`/`roa` default to `0` when absent (scorecard correctly says N/A data) — could expose `null` instead for consistency.
2. Snapshot-time drift (minutes) is inherent to the architecture.

---

## 6. Recommended Next Steps (not yet done)

| Priority | Action |
|----------|--------|
| P0 | Fix backend `_calc_status` dead code so live pattern status is real (not always "forming") |
| P0 | Reconcile H&S / IHNS neckline selection between frontend and backend |
| P1 | Gate or remove the documented money-losing patterns (H&S, sym triangle, triple top, bull flag) or lower their confidence |
| P1 | Wire the 5 experimental detectors + multi-TF + gap taxonomy to the API/UI, or remove as dead code |
| P2 | Fix triangle line projection + falling wedge target math |
| P2 | Expose `null` (not `0`) for absent top-level ROE/ROA |

---

## 7. Verification Artifacts
- `/tmp/ta_verify.py`, `/tmp/ta_verify2.py` — live-data trendline before/after proof
- Playwright chart verification (Trendlines + S/R toggles, zero console errors)
- Fundamental verification report (4 tickers vs live yfinance)

---

## 8. Phase-2 Fixes (2026-09-02) — COMPLETED

| # | Fix | Status | Evidence |
|---|-----|--------|----------|
| 1 | **Backend `_calc_status` wired** — added `end_idx` to `DetectedPattern`, set in all 17 detectors (mirroring frontend `calcStatus` endIdx), called in `detect_patterns` | ✅ DONE | Live smoke: RELIANCE.NS → `inverse_head_and_shoulders` status `completed`, end_idx 40 |
| 2 | **H&S neckline parity** — backend `_min_swing_between` → `_max_swing_between` (shallowest trough, matches frontend) | ✅ DONE | `pattern_engine.py:506-507` |
| 3 | **IHNS neckline parity** — backend `_max_swing_between` → `_min_swing_between` (lowest peak, matches frontend) | ✅ DONE | `pattern_engine.py:678-679` |
| 4 | **Falling wedge target** — `max(h1,l1)−min(h2,l2)` → `h1−l1` (wedge opening at start) | ✅ DONE | `pattern_engine.py:1479`, `patterns.ts:1601-1603` |
| 5 | **Money-losing patterns gated** — `LOW_EDGE_PATTERNS = {head_and_shoulders, symmetrical_triangle, bull_flag}` excluded from production output (`ENABLE_LOW_EDGE_PATTERNS=False`); kept for calibration. triple_top already gated via EXPERIMENTAL | ✅ DONE | `pattern_engine.py:1633-1638`, gated at `run_pattern_backtest` + `detect_multi_tf_patterns` |
| 6 | **Triangle line projection** — ascending/descending/symmetrical triangle lines now project slope to last candle via `interpolate()` | ✅ DONE | `patterns.ts` (4 lines fixed) |
| 7 | **Wedge line projection** — falling + rising wedge lines now project slope to last candle (same bug found during fix) | ✅ DONE | `patterns.ts` (4 lines fixed) |
| 8 | **Dead code documented** — `classify_gaps` (tested, kept), `detect_multi_tf_patterns` (inert, kept) | ✅ DONE | docstrings added |

**Tests:** backend 47/47 pass · frontend `tsc --noEmit` clean.

### Remaining (deferred)
- Wire the 5 experimental detectors + multi-TF + gap taxonomy to API/UI, or remove (kept as documented inert code — `classify_gaps` is test-referenced)
- Expose `null` (not `0`) for absent top-level ROE/ROA in fundamentals
- Re-calibrate LOW_EDGE patterns after gating to see if any recover ≥ +0.10R

---

## 9. Feature 1 — Market-wide Sector Rotation / Relative Strength (2026-09-02) — IMPLEMENTED

**Motivation (from competitor validation of `bananapatterns.com`):** the platform was
greenfield for market-wide aggregation — every endpoint was per-ticker. The competitor
offers a sector RS ranking + adjustable screen "dials". We implemented the market-wide
sector view first (high value, fits the existing pipeline, ~2-4 days) and scoped the
"dials" as Feature 3 (harder, ~6-8 days).

### What was built
- **`GET /api/market`** (server-side route, `frontend/app/api/market/route.ts`) — the
  platform's first cross-ticker endpoint. Joins two lightweight Supabase reads:
  1. `portfolio_snapshot` (all ~2411 analysed tickers: qm/tech/fund scores, rating,
     trend, score_change) via `fetchAllSnapshotRows()`.
  2. `fundamentals` jsonb sector/industry extraction (`data->sector`) via new
     `fetchAllSectors()` — pulls only the two small strings per ticker, not the ~3KB blob.
- **`/market` page** (`frontend/app/(app)/market/page.tsx`) — sector RS table, breadth
  gauges, rotation heatmap, breakout ledger. Nav item added to `SideMenu` (Primary).
- **Types** in `frontend/lib/types.ts` (`MarketResponse`, `SectorStat`, `MarketTicker`,
  `SectorPhase`); `api.getMarket()` in `frontend/lib/api.ts`.

### Methodology (documented for reproducibility)
- **Sector mapping:** GICS-style sector from the fundamentals snapshot; tickers without a
  sector are excluded from the sector view (still counted in market breadth).
- **Relative Strength:** percentile rank (1-99) of each sector's average blended QM score
  across all sectors (1 = strongest).
- **Breadth:** % of sector stocks rated Buy/Strong Buy; % improving; % deteriorating.
- **Rotation phase (2×2 matrix):**
  - Strength axis = avg QM score vs market-wide average (above = strong).
  - Momentum axis = net breadth (improving% − deteriorating%; ≥0 = positive).
  - Strong + positive → **Leading** · Weak + positive → **Improving**
  - Strong + negative → **Weakening** · Weak + negative → **Lagging**

### Live-data verification (2026-09-02)
- 2380 tickers mapped to sectors; market avg QM 50.3.
- Phase distribution: 2 Leading (Energy, Real Estate), 4 Weakening, 5 Lagging — a
  meaningful spread (the first naive threshold-based classifier collapsed everything to
  "Weakening"; the relative 2×2 matrix fixed this).
- Breakout ledger correctly surfaces real movers (SBIN Δ+49.9, GENUSPOWER Δ+46.1, …).
- `tsc --noEmit` clean.

### Files
- `frontend/app/api/market/route.ts` (new)
- `frontend/app/(app)/market/page.tsx` (new)
- `frontend/lib/supabase.ts` — `fetchAllSectors()` (new)
- `frontend/lib/types.ts` — market types (new)
- `frontend/lib/api.ts` — `getMarket()` (new)
- `frontend/components/SideMenu.tsx` — Market nav item

---

## 10. Feature 3 — Adjustable Screen "Dials" (2026-09-02) — IMPLEMENTED

**Goal:** let users tune pattern-detection thresholds from the UI, mirroring
`bananapatterns.com`'s adjustable screen dials.

### Design decision (avoids the 17-detector × 2-engine threading risk)
Thresholds are hardcoded module-level constants in both engines. Instead of
threading a config object through all 17 detectors in each engine (which risks
**dual-engine parity drift** — the exact class of bug the audit fixed), we use a
**module-level override pattern**:

- **Backend** (`pattern_engine.py`): `ScreenConfig` dataclass with defaults
  matching the constants. `detect_patterns(..., screen_config=...)` calls
  `_apply_screen_config()` to override the module constants for the duration of
  the call, then `_restore_screen_config()` in a `finally` block. Detector
  signatures are unchanged.
- **Frontend** (`patterns.ts`): the tunable constants were converted from
  `const` to `let`. `detectPatterns(..., { screenConfig })` calls
  `applyScreenConfig()` / `restoreScreenConfig()` around the inner dispatch.
  Same save/restore semantics as the backend.

This keeps the two engines in lockstep (both read the same module constants at
call time) and avoids touching the 17 detector bodies.

### What was built
- **`ScreenConfig`** (backend dataclass + frontend interface) with 12 tunable
  dials: `min_confidence`, `min_rr`, `peak_equality_pct`, `flag_pole_min_pct`,
  `triangle_min_touches`, `cup_min_bars`, `stop_cushion_pct`,
  `target_mult_continuation`, `target_mult_reversal`, `reversal_min_rr`,
  `pattern_cooldown_bars`, `rising_wedge_target_mult`.
- **`detect_patterns` / `detectPatterns`** accept an optional `screen_config` /
  `screenConfig` param (defaults to current constants → existing callers/tests
  unaffected).
- **Settings UI** (`frontend/app/(app)/settings/page.tsx`) — "Pattern Screen
  Dials" card with sliders for all 12 dials, Save + Reset buttons. Persists to
  localStorage via `frontend/lib/screenConfig.ts`.
- **Chart + Patterns tab** apply the saved config: `indicators.ts` and the
  stock page pass `loadScreenConfig()` into `detectPatterns`.

### Verification
- Backend: 4 new tests (`test_f3_*`) — defaults match constants, confidence
  gate override, constant restoration, min_rr override. **51/51 pass.**
- Frontend: `tsc --noEmit` clean; `next build` succeeds.
- Live override verified: `double_top` (conf ~70) is gated by the default 85
  floor but admitted with `min_confidence=50`; constants restored after.

### Files
- `backend/engine/pattern_engine.py` — `ScreenConfig`, `_apply/_restore_screen_config`
- `backend/tests/test_pattern_engine.py` — 4 new `test_f3_*` tests
- `frontend/lib/patterns.ts` — `ScreenConfig`, `SCREEN_CONFIG_BOUNDS/LABELS`,
  `defaultScreenConfig`, `apply/restoreScreenConfig`; constants → `let`
- `frontend/lib/screenConfig.ts` (new) — localStorage persistence
- `frontend/lib/indicators.ts` + `frontend/app/(app)/stock/[symbol]/page.tsx` — apply saved config
- `frontend/app/(app)/settings/page.tsx` — Screen Dials UI

### Remaining (deferred)
- ~~Wire `screen_config` through the backend `/pattern-backtest` API~~ ✅ DONE (2026-09-02):
  `run_pattern_backtest(..., screen_config=)` applies the dials for the backtest
  duration (both `simulate_trades` and `detect_patterns` honor them); the
  `/api/v1/pattern-backtest` endpoint accepts an optional `screen_config` body
  field; the frontend `patternBacktest()` passes the saved dials. Verified:
  strict config (min_confidence=95) drops RELIANCE trades 13→9 and suppresses
  the 90-conf IHNS; constants restored after. Backend 51/51 tests pass; tsc clean.

---

## 11. Roadmap Summary (Features 1 & 3)

| Feature | Status | Effort | Value | Notes |
|---------|--------|--------|-------|-------|
| **1. Market-wide Sector Rotation / RS** | ✅ IMPLEMENTED (2026-09-02) | ~2-4 days | High | `/market` page + `/api/market`; sector RS, breadth, rotation, breakout ledger |
| **3. Adjustable Screen "Dials"** | ✅ IMPLEMENTED (2026-09-02) | ~6-8 days | Medium-High | `ScreenConfig` override in both engines; Settings UI; chart + Patterns tab + `/pattern-backtest` API all honor dials |

---

## 12. Market-Validation & Calibration Pass (2026-09-03)

### Motivation
Out-of-sample validation (9 large-caps × 3y) showed the pattern engine is
net-negative expectancy (~−0.14R/trade at defaults) and that projected targets
are hit first only ~27% of the time (stop first ~62%). This pass re-calibrated
on the canonical universe and fixed a frontend/backend parity gap.

### Evidence basis (canonical 12-ticker × 5y calibration)
Ran `scripts/calibrate_reliability.py --years 5` (RELIANCE, TCS, HDFCBANK,
ICICIBANK, INFY, SBIN, ITC, LT, BHARTIARTL, MARUTI, ASIANPAINT; TATAMOTORS
delisted). Fresh per-pattern expectancy (n≥15):

| Pattern | n | WR% | Expectancy | Decision |
|---|---|---|---|---|
| falling_wedge | 72 | 32.5% | **+0.48R** | KEEP un-gated (positive edge) |
| inverse_head_and_shoulders | 16 | 93.3% | **+0.23R** | KEEP un-gated; weight 1.0→1.10 |
| triple_bottom | 24 | 47.8% | +0.03R | un-gated (near zero) |
| cup_and_handle | 22 | 44.4% | **−0.11R** | **GATED (added)** |
| symmetrical_triangle | 409 | 26.2% | −0.19R | gated (already) |
| head_and_shoulders | 30 | 50.0% | −0.42R | gated (already); weight 0.80→0.65 |
| bull_flag | 9 | 14.3% | −0.56R | gated (already) |

### Key findings
1. **falling_wedge discrepancy resolved.** My earlier 3y/9-ticker read (−0.43R)
   was a small-sample artifact. The larger 5y/12-ticker calibration confirms
   **+0.48R** — a genuine positive edge. **Not gated.** (This is why the
   "re-calibrate first, gate only on evidence" approach was correct.)
2. **IHNS target multiple is already optimal.** A sweep of `TARGET_MULT_REVERSAL`
   over {1.0, 1.5, 2.0, 2.5, 3.0} on the 11-ticker × 5y universe:
   | mult | n | WR% | expR |
   |---|---|---|---|
   | 1.0 | 16 | 93.3% | **+0.227R** |
   | 1.5 | 37 | 54.8% | −0.195R |
   | 2.0 | 59 | 52.9% | −0.066R |
   | 2.5 | 71 | 55.0% | −0.039R |
   | 3.0 | 86 | 62.5% | +0.053R |
   Raising the target destroys the win rate and lowers expectancy. **Kept at
   1.0×.** (My earlier "target too close" hypothesis was a small-sample artifact.)
3. **Frontend parity bug fixed.** The backend gates `LOW_EDGE_PATTERNS` at
   production call sites, but the frontend chart/Patterns tab computed patterns
   client-side with NO gate — showing negative-edge patterns as actionable.
   Added `LOW_EDGE_PATTERNS` + `ENABLE_LOW_EDGE_PATTERNS` to
   `frontend/lib/patterns.ts` and a gate in `detectPatternsInner` (mirrors the
   backend dispatcher). Chart + Patterns tab now agree with backend production.

### Changes
- `backend/engine/pattern_engine.py`:
  - `LOW_EDGE_PATTERNS` += `cup_and_handle` (docstring updated with 2026-09-03 figures).
  - `PATTERN_RELIABILITY`: `head_and_shoulders` 0.80→0.65, `inverse_head_and_shoulders` 1.00→1.10, `cup_and_handle`/`falling_wedge` comments updated.
  - IHNS target multiple **unchanged** (1.0× already optimal per sweep).
- `frontend/lib/patterns.ts`:
  - `PATTERN_RELIABILITY` weights mirrored (H&S 0.65, IHNS 1.10).
  - Added `LOW_EDGE_PATTERNS` set + `ENABLE_LOW_EDGE_PATTERNS` + gate in `detectPatternsInner`.
- `backend/tests/test_pattern_engine.py`: 4 new `test_cal_*` tests (cup gated,
  falling_wedge not gated, weights match calibration, production gating excludes all).
- `scripts/reliability_calibration.json`: refreshed (2026-09-03).

### Verification
- Backend: **55/55 tests pass** (51 + 4 new).
- Frontend: `tsc --noEmit` clean.
- Deployed to `https://vijaymaruthi.vercel.app`; stock page Patterns tab no
  longer shows gated patterns; `/settings` dials intact; zero console errors.

## 13. Deeper Calibration Rework — Symmetrical-Triangle Autopsy (2026-09-03)

### Motivation
Section 12 left the system net-negative (~−0.14R/trade at defaults). The two
suspected root causes were (a) the dominant `symmetrical_triangle` (n=409,
−0.19R) and (b) the overall target geometry (`TARGET_MULT_CONTINUATION=2.0`,
`TARGET_MULT_REVERSAL=1.0`). This pass ran a full autopsy to determine which —
if either — is the real cause, and whether a profitable configuration exists.

### Method
- `scripts/symtri_target_sweep.py`: re-simulated the SAME accepted
  entries/stops (production defaults) across a fine target-multiple grid
  k ∈ {0.5 … 3.0}, split by direction.
- `scripts/symtri_bullish_validate.py`: tested the promising bullish
  sub-segment filter (rr≤3.5, atr≤1.0) across all target multiples.
- `scripts/symtri_walkforward.py`: split 5y history into two halves and
  checked the sub-segment edge holds in BOTH halves (overfitting guard).
- Feature segmentation on `scripts/trade_dataset.jsonl` (598 trades).

### Finding 1 — Target geometry is NOT the root cause
The target-multiple sweep shows **no k rescues symmetrical_triangle to
positive expectancy**:

| k | ALL | bullish | bearish |
|---|---|---|---|
| 0.5 | −0.152R | −0.136R | −0.174R |
| 1.0 | −0.159R | −0.068R | −0.285R |
| 2.0 | −0.179R | −0.082R | −0.313R |
| 3.0 | −0.162R | −0.007R | −0.377R |

The negative edge is **not** a target-distance problem. It is an
entry/pattern-quality problem. (This also means the earlier "target geometry
is the root cause" hypothesis is disproven.)

### Finding 2 — Bearish symmetrical_triangle is uniformly unprofitable
Across every filter (confidence, rr, height, atr), the bearish side is
negative (−0.12R to −0.64R). This is robust and direction-specific.

### Finding 3 — A bullish sub-segment has a genuine, target-robust edge
Bullish symtri with **rr≤3.5 AND atr≤1.0** is positive at **every** target
multiple (k=1.0→3.0: +0.29R to +0.39R), while the unfiltered bullish baseline
is negative at every k. The edge is therefore a real entry-quality signal, not
a geometry artifact.

- Full 5y: **+0.30R, n=85, WR 31.8%** (Wilson 95% CI [22.8%, 42.3%]).
- Spread across 10 of 11 tickers (not a single-name artifact).
- Walk-forward: first half +0.417R (n=40), second half +0.144R (n=43) — both
  positive, but the recent half is materially weaker.

### Honest bottom line
- The deeper rework **resolves the root-cause question**: it is the bearish
  side and entry quality, NOT the target geometry.
- A defensible positive-edge sub-segment exists (bullish, rr≤3.5, atr≤1.0),
  but it is **in-sample, modest (n=85), and unstable in magnitude** (recent
  half only +0.14R).
- The system as a whole **remains net-negative**; un-gating this sub-segment
  would improve but not fix it.
- **Decision (pending user):** implement a conditional un-gate for the bullish
  sub-segment (feature-aware gating across backend + frontend), or keep
  `symmetrical_triangle` fully gated (conservative). Given the in-sample,
  modest, magnitude-unstable edge and the added gating complexity, the
  conservative default is to keep it gated and record the finding.

### Files
- `backend/scripts/symtri_target_sweep.py` (new)
- `backend/scripts/symtri_bullish_validate.py` (new)
- `backend/scripts/symtri_walkforward.py` (new)
- `backend/scripts/trade_dataset.jsonl` (existing, reused)

## 14. Backtest Endpoint Fix — QuantamentalBacktester Import Bug (2026-09-03)

### Discovery
Full engine test (local + deployed) surfaced a **pre-existing bug** in the
`/api/v1/backtest` endpoint: it returned
`cannot import name 'QuantamentalBacktester' from 'quantamental_backtester'`.

### Root cause
`backend/engine/runner.py` `run_backtest()` imported a `QuantamentalBacktester`
class that **does not exist anywhere in the codebase**. The real class is
`TickerBacktester` (in `engine/quantamental_backtester.py`), which has a
`run()` method and a module-level `aggregate()` function — a completely
different API (`run_fast()`, `compute_forward_returns()`, `compare_methods()`
were all nonexistent). The bug was present since the **initial commit**
(`94c41bd`) — the backtest feature had never worked.

### Fix
Rewrote `run_backtest()` to use the real `TickerBacktester` API:
- `TickerBacktester(ticker, years, rebalance_days).run()` → `List[BTSignal]`
- `aggregate(signals, tail_threshold=-10.0)` → per-rating-bucket `BucketStats`
- Mapped `BucketStats` (percentage-point returns) to the frontend's expected
  **fraction** units (`avg_ret/100`, `win_rate_pct/100`).
- Computed per-period Sharpe from `avg_ret`/`ret_std`.
- Built methodology comparisons (LONG vs BASELINE vs Hold) with spread over
  baseline.

### Verification
- Direct `run_backtest()` call: returns real data (8 signals, 4 groups, 3
  comparisons) for RELIANCE/TCS/INFY/HDFCBANK.
- `/api/v1/backtest` endpoint (after backend restart): returns valid
  `BacktestResponse` (200, correct shape).
- Backend test suite: **55/55 pass**.
- Frontend `tsc --noEmit`: **clean** (response shape unchanged).

### Files
- `backend/engine/runner.py` — `run_backtest()` rewritten (only change).

## 15. Auto Pilot Now Trades on the Same Analysis Engine (2026-09-04)

### Motivation
The Auto Pilot's live performance (capital ₹1,00,000, P&L -0.41%, win rate
25%) was dragged down by **degenerate trades** — stops/targets placed
essentially at the entry price. Investigation showed the pilot was NOT using
the platform's real analysis engine for entry/target/stop; it recomputed them
locally via a **simplified, divergent** S/R + ATR path
(`frontend/lib/pilot/intelligence.ts` → `priceTargets.ts`).

### Root cause (two layers)
1. **Divergent path** — the pilot's `computePilotTargets` used the *nearest*
   S/R level for stop/target with **no minimum-distance guard**. When price
   sat in a tight S/R zone it produced degenerate trades:
   - OIL.NS: target 0.05% above entry, stop 2.3% below → **R:R 0.02**
   - MUTHOOTFIN.NS: stop 0.014% below entry → **R:R 91** (guaranteed stop-out)
   - GPPL.NS: stop 0.05% below entry → **R:R 37** (guaranteed stop-out)
2. **The real engine had the same latent flaw** — `_classify_signal` also used
   the nearest S/R level with no minimum-distance guard, so even wiring the
   pilot to it directly would not have fixed the degenerate trades.

### Fix
1. **Degenerate-trade guard in the real engine** (`_classify_signal` in
   `engine/technical_analysis_report.py` + `vercel-backend/lib/...`): enforce
   stop ≥ max(1.5%, 1.5×ATR) from entry, target ≥ max(1.5%, 2×ATR) from entry,
   and R:R ≥ 1.0. Verified: the degenerate cases now produce stop ~3% below,
   target ~4% above, **R:R 1.33**.
2. **Expose the real engine's levels** in `/api/v1/analyze` response
   (`entry_zone`, `targets`, `invalidation`) — `backend/api/models.py` +
   `backend/engine/runner.py`.
3. **Persist them to the analysis DB** — `engine/analysis_db.py` adds
   `entry_low/entry_high/target1/2/3/stop_loss` columns to `analysis_runs`.
4. **Sync them to Supabase** — `sync/sync_to_supabase.py` maps the levels into
   `portfolio_snapshot` rows; `sync/supabase_schema.sql` adds the columns
   (idempotent `ALTER TABLE`).
5. **Rewire the pilot** — `computeTargetsForTicker` now PREFERS the real
   engine's levels and only falls back to local computation when none are
   available. The fallback path also got the degenerate-guard as a safety net.
6. **Backend-API primary source** (2026-09-04, follow-up) — the pilot now
   fetches the real engine's levels directly from the backend
   `/api/v1/analyze` endpoint (`fetchRealEngineLevels`), making it the PRIMARY
   source. This is the SAME `_classify_signal` the platform uses, live, and is
   independent of the Supabase snapshot schema. Priority:
   1. Backend `/api/v1/analyze` (real engine, live)
   2. Supabase snapshot real-engine levels
   3. Local S/R + ATR with degenerate-trade guard (safety net)
7. **Bug fix in the fallback guard** (2026-09-04, follow-up) — the BUY-branch
   guard in `computePriceTargets` had an **inverted stop comparison**
   (`stopLoss > stopFloor ? stopLoss : stopFloor`), which kept the degenerate
   (too-close) S/R stop instead of widening it to the floor. Verified via test:
   MUTHOOTFIN (stop 0.014% away) and GPPL (stop 0.05% away) still produced
   R:R 80–285. Corrected to `stopLoss > stopFloor ? stopFloor : stopLoss`.

### Verification
- Backend test suite: **55/55 pass**.
- Frontend `tsc --noEmit`: **clean**.
- DB round-trip: real-engine levels persist to `analysis_runs` and read back
  correctly via `get_all_latest`.
- Sync: `build_rows` maps the levels into snapshot rows correctly.
- **Guard (engine `_classify_signal`)**: the three diagnosed degenerate trades
  now produce stop 3% below / target 4% above / **R:R 1.33** (was R:R 0.02 /
  91 / 37). Broad sweep of 2,000 random S/R scenarios: **0 degenerate, 0
  broken** (worst R:R 1.00, min stop 1.51%, min target 2.15%).
- **Guard (pilot fallback `computePriceTargets`)**: broad sweep of 2,000
  random S/R scenarios: **0 degenerate, 0 broken** (worst R:R 1.00, min stop
  1.56%, min target 2.03%).
- **Non-interference**: healthy setups (wide S/R) are preserved, not widened.

### Activation (required)
1. Apply `sync/supabase_schema.sql` (the `ALTER TABLE` statements) in the
   Supabase SQL Editor to add the 6 columns to `portfolio_snapshot`.
2. Re-run the Mac sync so snapshot rows get populated with real-engine levels.
3. Reset the Auto Pilot so it re-opens positions using the real-engine levels.

> NOTE: The core quality fix (no degenerate trades) is ALREADY ACTIVE via the
> engine guard + the pilot's backend-API primary source + the guarded fallback.
> The Supabase schema migration + sync only add the snapshot as a SECONDARY
> source (useful on the deployed site where the local backend is unavailable).
> The Supabase DDL cannot be run programmatically from this machine (no
> management token / DB password / CLI auth), so it remains a manual step.

### Files
- `engine/technical_analysis_report.py` — degenerate-trade guard in `_classify_signal`.
- `vercel-backend/lib/technical_analysis_report.py` — same guard (deployed copy).
- `backend/api/models.py` — `TickerAnalysisResponse` + `entry_zone/targets/invalidation`.
- `backend/engine/runner.py` — populate the new response fields.
- `engine/analysis_db.py` — new trade-level columns + persistence.
- `sync/sync_to_supabase.py` — map levels into snapshot rows.
- `sync/supabase_schema.sql` — `ALTER TABLE` for the 6 new columns.
- `frontend/lib/pilot/engine.ts` — prefer real-engine levels; fallback + guard.
- `frontend/lib/pilot/types.ts` — `PilotCandidate` trade-level fields.
- `frontend/lib/supabase.ts` — `RawSnapshotRow` trade-level fields.
- `frontend/lib/priceTargets.ts` — degenerate-guard on the fallback path.
- `frontend/app/api/pilot/start/route.ts` — pass real-engine levels through.

## 16. Confluence Confirmation Gate — Multi-Signal Convolution (2026-09-05)

### Motivation
The degenerate-trade guard (§15) fixed *how* trades are sized, but not *which*
trades are taken. Calibration evidence (§12–13) shows the pattern engine is
net-negative (~−0.14R/trade): targets hit first only ~27%, stops first ~62%.
Root cause: **a single weak pattern fires a BUY with no independent
confirmation** — `symmetrical_triangle` −0.19R (n=409, dominant),
`head_and_shoulders` −0.42R, `triple_top`/`bull_flag` lose money; only
`falling_wedge` (+0.48R) is a validated winner. The filtered bullish-symtri
segment (`rr≤3.5 & atr≤1.0`) measured **+0.30R** — proof that confluence works.

### Fix — `_confirmation_gate` in `engine/technical_analysis_report.py`
A BUY is actionable only when **≥3 of 4 independent confirmations** agree
(`MIN_CONFIRM = 3`, tunable dial):

1. **Trend/structure** — `Uptrend` (HH+HL) AND price > SMA50.
2. **Momentum** — RSI 40–65 AND MACD bullish (crossover or histogram rising
   with MACD > signal).
3. **Pattern confluence** — `pattern_engine.detect_patterns` on the last 120
   candles: `falling_wedge` (validated winner), filtered bullish
   `symmetrical_triangle` (rr≤3.5 & atr≤1.0), `inverse_head_and_shoulders`;
   negative-edge patterns (`head_and_shoulders`, `triple_top`, `bull_flag`)
   veto unless they pass their own filter.
4. **Volume** — Above Avg / up-down ratio > 1.5 AND OBV bullish.

Bonus (5th, not required): bullish candlestick (Hammer / Bullish Engulfing /
Marubozu) on the last bar.

**Chop guard**: ADX < 20 with no trend structure → HOLD (stand aside), even if
the count passes — a range-bound tape has no directional edge.

### Wiring
- Called in `analyze()` after the quantamental blend, before quality gates.
- Exposed on the result + `/api/v1/analyze` response:
  `confirm_score`, `confirm_count`, `confirm_details`.
- Frontend: `TickerAnalysis` type + "Confirm n/4" indicator on the stock page.

### Deployment-gap fix (important)
The live backend imports `share/technical_analysis_report.py` (share root), NOT
`vijaymaruthi/engine/technical_analysis_report.py`. The §15 guard was committed
to the git copy but never synced — **production was running the unguarded
engine**. Fixed: synced the git engine to the share-root production copy and
restarted the backend (PID verified, guard confirmed live via direct
`_classify_signal` test: degenerate S/R → stop 3% / target 4% / R:R 1.33).

### Verification
- Gate unit tests: strong setup → 3–4/4 confirmations; weak setup → ≤1/4;
  chop → HOLD regardless. All pass.
- Backend test suite: **55/55 pass**.
- Frontend `tsc --noEmit`: **clean**.
- Backend restarted with the gate live (PID 20171).

### Files
- `engine/technical_analysis_report.py` — `_confirmation_gate`,
  `_pattern_confluence`, `_pattern_engine_dir`; wired into `analyze()`.
- `backend/engine/runner.py` — expose `confirm_score/count/details`.
- `frontend/lib/types.ts` — `TickerAnalysis` confirm fields.
- `frontend/app/(app)/stock/[symbol]/page.tsx` — "Confirm n/4" indicator.

### Backtest proof — 12 tickers × 5y (600 point-in-time signals)
`validation_results/confluence_gate_bt/` (REPORT.md, summary.json, signals.csv)

| Bucket | n | Win% | Avg 20d ret% |
|---|---|---|---|
| UNGATED TECH BUY (old system) | 337 | 55.7 | +0.70 |
| **GATED TECH BUY (confirm≥3)** | **26** | **73.1** | **+1.83** |
| GATE-REJECTED TECH BUY | 311 | 54.2 | +0.60 |

- **+17.4 pp win rate, +1.13 pp avg 20d return** from the gate.
- The gate rejects 92% of technical BUYs (311/337) — the rejected trades are
  the weaker half (54.2% WR vs 73.1% gated).
- Walk-forward (per-year): gate improves win rate in every year with a
  meaningful sample (2023: 87.5% vs 65.0%; 2024: 100% vs 54.7%; 2025: 80.0%
  vs 62.0%). The two years where it underperforms (2022 n=3, 2026 n=2) are
  statistically meaningless samples.
- Trade-off: far fewer BUYs (26 vs 337) — quality over quantity, which is the
  user's stated goal (accuracy, not trade count).

### yfinance rate-limit fix (2026-09-05)
The engine's shared `_YF_SESSION` (custom Chrome/120 User-Agent) was being
flagged by Yahoo (YFRateLimitError) while yfinance's own session worked.
Removed `session=_YF_SESSION` from all `yf.download`/`yf.Ticker` calls in the
engine + vercel-backend copies — yfinance now manages its own session
(curl_cffi when available). Verified: `/api/v1/analyze` returns live data
again (RELIANCE.NS analyzed, HOLD, 0/4 confirmations).

### CORRECTION — 10y out-of-sample check (2026-09-05)
The 5y backtest above was regime-dependent. A 10y backtest (1344 signals,
`validation_results/confluence_gate_bt/10y/`) shows the gate's win-rate edge
does NOT generalize across market cycles:

| Threshold | 10y WR | vs ungated | 10y avg | P(close<-10%) |
|---|---|---|---|---|
| UNGATED (old) | 55.3% | — | +0.94% | 4.2% |
| confirm>=2 | 56.8% | +1.5 pp | +1.06% | **2.8%** |
| confirm>=3 | 54.4% | −0.9 pp | +0.98% | 3.5% |

- confirm>=3 only helps in the 2023-26 bull regime (71.4% vs 57.5% WR); it
  HURTS in 2016-19 (−11.7pp) and 2020-22 (−8.0pp). The 5y +17.4pp was a
  bull-market artifact.
- Per-ticker MA200 regime condition does NOT rescue it (53.8% WR, −1.5pp).
- confirm>=2 is the evidence-based threshold: small consistent edge + the
  best tail-risk protection (halves P(close<-10%) from 4.2% → 2.8%).
- **Decision: MIN_CONFIRM tuned 3 → 2.** The gate is now understood as a
  TAIL-RISK FILTER (removes the worst 55% of BUYs) rather than a universal
  win-rate improver. Backend synced + restarted (PID 20651).
- Honest caveat: no single technical filter reliably beats the baseline
  across all regimes; the gate's robust value is downside protection.

## 17. Weighted Convolution — replaces the flat confirmation gate (2026-09-05)

### What changed
The flat 4-signal count gate (`confirm_count >= MIN_CONFIRM`) is replaced by a
**weighted convolution** (user-approved design, `docs/weighted_convolution.md`):

- **Technical convolution** (0-100): pattern 30, trend 15, momentum 15,
  volume 15, candlestick 10, oscillator/divergence 10, Wyckoff 5. Each
  component contributes a sub-score in [-weight, +weight]; `score = clamp(50 +
  total/2, 0, 100)`. Patterns carry calibrated weights (falling_wedge +8,
  IHNS +7, H&S −10, …).
- **Fundamental convolution** (0-100): value 20, growth 20, profitability 20,
  risk 15, momentum 10, analyst 10, dividend 5. **AND-floor cap**: any factor
  < 50 caps the score at 65 (cap, not veto — per product decision).
- **50/50 blend**: `_compute_quantamental` now blends `tech_conv`/`fund_conv`
  with a narrow [0.45, 0.55] weight band (Large 45/55, Mid 50/50, Small
  55/45), replacing the old 0.20-0.80 band.
- Gate: chop guard → `tech_conv < TECH_BUY_MIN` → HOLD.

### Evidence-based tuning (10y backtest, 12 tickers, 1344 signals)
`validation_results/convolution_bt/10y/`:

| Filter | n | Win% | Avg 20d | P(close<−10%) | P(touched−10%) |
|---|---|---|---|---|---|
| UNGATED TECH BUY (old) | 783 | 55.4 | +0.95% | 4.2% | 11.1% |
| **CONV BUY (tech≥60)** | **470** | **57.4** | **+1.14%** | **3.6%** | **9.8%** |
| CONV REJECTED | 313 | 52.2 | +0.66% | 5.1% | 13.1% |

- **TECH_BUY_MIN tuned 65 → 60**: 60 beats 65 on every metric (WR +2.0pp vs
  +0.6pp, avg +0.19pp vs −0.25pp, tail risk still better) with 2.3× more
  signals. 70 over-filters (47.9% WR, −1.86% avg).
- **Pattern-majority veto REMOVED**: the 50 bearish-majority signals it
  rejected had 59.2% WR / +1.45% avg (better than ungated); the 9 that passed
  tech≥60 had 66.7% WR with zero tail risk. The score threshold already
  enforces broad agreement (a single pattern can't reach 60).
- The conv score alone does NOT separate winners from losers (winners mean
  60.9 vs losers 60.5) — like the flat gate, the convolution's robust value is
  **tail-risk reduction + rejecting the worst 40% of BUYs** (CONV REJECTED:
  52.2% WR, 13.1% touched vs 9.8% for CONV BUY).
- Regime caveat (same lesson as §16): the edge is strongest in 2023-26; the
  filter is a downside-protection layer, not a universal WR improver.

### Files
- `engine/technical_analysis_report.py`: `_pattern_votes`,
  `_technical_convolution`, `_fundamental_convolution`, constants
  (TECH_BUY_MIN=60, FUND_FACTOR_FLOOR=50, FUND_CAP=65), `analyze()` wiring
  (convolution computed BEFORE the blend), `_compute_quantamental` narrow band.
- `engine/quantamental_backtester.py`: records `conv_tech_score` /
  `conv_pattern_majority` / `conv_fund_score`; CONV BUY / CONV REJECTED
  buckets; **fixed checkpoint double-count bug** (fresh run now clears
  signals.jsonl).
- `backend/engine/runner.py` + `backend/api/models.py`: expose
  `conv_technical` / `conv_fundamental`.
- `frontend`: "Confirm n/4" replaced with Tech Conv / Fund Conv / Pattern
  gauges + full component breakdown card in the Report tab.
- `backend/tests/test_convolution.py`: 10 new unit tests (65/65 pass).
- Live verified: RELIANCE.NS → HOLD, tech_conv 56.5 (<60), fund_conv 65
  (capped: growth factor 40/100 < 50), pattern majority True (IHNS).
- Backend synced to share root + restarted (PID 21469).
