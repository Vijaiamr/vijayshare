# Python Engineering Tracker

## Current Status

**Overall Status:** Completed

**Last Updated:** 2026-10-14

**Current Focus:** Deterministic analyzer application (`analysis_app/`) — pinned snapshot + composite state machine (regime × setup × position), exposed via CLI, FastAPI and a frontend page; byte-identical outputs verified by SHA-256.

---

## Executive Summary

The backend pattern engine (`backend/engine/pattern_engine.py`) now mirrors the frontend (`frontend/lib/patterns.ts`) for pattern lifecycle reporting. All 17 detectors set `end_idx` (the index of the last structural point of the formation), and `detect_patterns` now computes the live status (`forming` / `active` / `completed` / `failed`) via the previously-dead `_calc_status` helper. Two parity bugs were fixed (H&S/IHNS neckline selection), the falling-wedge target formula was corrected, three measured-negative-expectancy patterns are gated out of production output, and two dead-code paths are documented. All 47 tests pass; a live smoke test on RELIANCE.NS shows a real `completed` status with `end_idx` set.

---

## Work Completed

### [TASK-001] Add `end_idx` field to DetectedPattern

**Status:** Completed

**What I found:**
`DetectedPattern` had no way to report where a formation ends, so the frontend's `calcStatus` could not be mirrored server-side.

**Why it mattered:**
Without `end_idx`, the backend could never compute a live pattern status — every pattern defaulted to `"forming"` forever.

**What I changed:**
Added `end_idx: Optional[int] = None` to the `DetectedPattern` dataclass (after `timeframe: str = "daily"`).

**Validation:**
- Unit test: PASS (all 47 tests)
- Regression test: PASS

**Result:**
Patterns now carry their structural end index.

---

### [TASK-002] Set `end_idx` in all 17 detectors

**Status:** Completed

**What I found:**
None of the 17 `DetectedPattern(...)` constructions set `end_idx`.

**Why it mattered:**
The status computation needs a reference point; without it the wiring in TASK-003 would be a no-op.

**What I changed:**
Set `end_idx` in every detector, mirroring the frontend semantics:
- H&S / IHNS: `rs_idx` (right shoulder index — frontend `rsIdx`)
- double_top / double_bottom: `i2_idx` (second peak/trough — frontend `idx(candles, p2/t2.time)`)
- bull_flag / bear_flag: `_idx(candles, flag_end.time)` (frontend `idx(candles, flagEnd.time)`)
- ascending_triangle: `_idx(candles, rh2.time)`; descending_triangle: `_idx(candles, rl2.time)`
- falling_wedge: `_idx(candles, l2.time)`; cup_and_handle: `_idx(candles, rim_time)`
- symmetrical_triangle: `max(i_h2, i_l2)`; rising_wedge: `wedge_last`
- triple_top: `max(i_p3, _idx(candles, t2.time))`; triple_bottom: `max(i_t3, _idx(candles, m2.time))`
- rounding_bottom / rounding_top / island_reversal: `len(candles) - 1`

**Validation:**
- Unit test: PASS (all 47 tests)
- Grep check: 17 `end_idx=` occurrences, one per construction

**Result:**
Every emitted pattern now knows where its formation ends.

---

### [TASK-003] Wire `_calc_status` into `detect_patterns`

**Status:** Completed

**What I found:**
`_calc_status` existed (line ~321) but was never called — every pattern reported `"forming"`.

**Why it mattered:**
The frontend shows live statuses; the backend was stuck at "forming" for all patterns.

**What I changed:**
Before `results.append(pattern)`, when `pattern.end_idx is not None`, call `_calc_status(candles, pattern.end_idx, pattern.entry, pattern.stop_loss, pattern.target, pattern.direction)` and assign only the returned status to `pattern.status`. The trigger/entry values returned by `_calc_status` are deliberately NOT applied — the detector's own entry is authoritative.

**Validation:**
- Unit test: PASS (all 47 tests)
- Smoke test: RELIANCE.NS IHNS reports `completed` (target hit before stop after right shoulder)

**Result:**
Live statuses now flow through the dispatcher.

---

### [TASK-004] Fix H&S / IHNS neckline parity

**Status:** Completed

**What I found:**
Backend H&S used `_min_swing_between` (lowest low) for the neckline troughs; the frontend uses `maxSwingBetween` (highest low). IHNS was inverted: backend used `_max_swing_between` (highest high) where the frontend uses `minSwingBetween` (lowest high).

**Why it mattered:**
Neckline placement changes entry/stop/target geometry and confidence — the two engines disagreed on the same chart.

**What I changed:**
- H&S (lines ~502-503): `_min_swing_between` → `_max_swing_between`
- IHNS (lines ~674-675): `_max_swing_between` → `_min_swing_between`

**Validation:**
- Unit test: PASS (test_r14_head_and_shoulders_emits_pattern, test_r14_inverse_hs_emits_pattern)
- Source inspection: PASS

**Result:**
Neckline selection now matches the frontend.

---

### [TASK-005] Fix falling-wedge target math

**Status:** Completed

**What I found:**
The falling-wedge target used `max(h1.price, l1.price) - min(h2.price, l2.price)` — mixing the wedge start and end points, distorting the projected move.

**Why it mattered:**
The wedge opening should be measured at the start (`h1 - l1`); the old formula produced inconsistent targets.

**What I changed:**
`target = (entry_price or h2.price) + (h1.price - l1.price) * TARGET_MULT_CONTINUATION`

**Validation:**
- Unit test: PASS (test_r3_falling_wedge_fires_without_tautology_string)
- Source inspection: PASS (old formula gone)

**Result:**
Falling-wedge targets now use the start-of-wedge opening.

---

### [TASK-006] Gate money-losing patterns from production output

**Status:** Completed (with documented deviation)

**What I found:**
Three pattern types have measured NEGATIVE expectancy (head_and_shoulders -0.36R, symmetrical_triangle -0.18R, bull_flag -0.19R) yet still pass the confidence gate and reach production output.

**Why it mattered:**
Shipping known-negative-expectancy signals to users is a product/trust problem.

**What I changed:**
Added `LOW_EDGE_PATTERNS` + `ENABLE_LOW_EDGE_PATTERNS = False` constants. **Deviation from instruction:** the gate is applied at the production call sites (`run_pattern_backtest` and `detect_multi_tf_patterns`) rather than inside `detect_patterns`, because 9 tests use `detect_patterns` directly as the test harness and expect H&S / sym-tri / bull_flag to flow through it. The instruction's mandatory requirement (all 47 tests pass, fix changes not tests) is incompatible with gating inside `detect_patterns`. The gate's stated purpose — "excluded from production output" — is fully achieved at the call sites. Calibration/backtest paths (`simulate_trades`, collection scripts) intentionally remain ungated so the patterns can be re-calibrated.

**Validation:**
- Unit test: PASS (all 47 tests)
- Smoke test: `run_pattern_backtest('RELIANCE.NS')` returns only IHNS in `detected_patterns`; backtest trades still include sym-tri/H&S (calibration path intact)

**Result:**
Production output excludes the three low-edge patterns; calibration data still flows.

---

### [TASK-007] Document dead code

**Status:** Completed

**What I found:**
`classify_gaps` and `detect_multi_tf_patterns` are not wired to any production output path.

**Why it mattered:**
Future maintainers could mistake them for live paths.

**What I changed:**
- `classify_gaps` docstring: added "Utility — tested but not wired to production output."
- `detect_multi_tf_patterns` docstring: added "Inert — not wired to any API/UI path."

**Validation:**
- Unit test: PASS (test_classify_gaps_labels_and_never_raises, test_multi_tf_aggregation_shapes)

**Result:**
Dead-code status is now explicit.

---

### [TASK-008] Extract market-analysis decision logic into a code-defined rule engine

**Status:** Completed

**What I found:**
Every market-analysis *decision* — signal classification, the technical and
fundamental weighted convolutions, quality gates, quantamental fusion and
pattern gating — was hardcoded as `if/else` + magic-number blocks inside the
~5,800-line `technical_analysis_report.py`. The logic was untestable in
isolation (needed a full network/pipeline run), unsafe to change (no regression
net), and physically duplicated across 4 copies that silently drifted.

**Why it mattered:**
The decision logic is the product's core value and its highest-risk surface.
Without an extraction + regression net, any tuning risked silent behavioural
regressions across the live backend, the Vercel deploy and the Pi bundle.

**What I changed:**
- New pure-function package `engine/rules/`: `core.py` (Rule/RuleSet/RuleOutcome/
  DecisionTrace/MarketFeatures), `technical.py` (classify + convolution),
  `fundamental.py`, `gates.py`, `quantamental.py`, `pattern_gates.py`.
- Rewired `technical_analysis_report.py` so `_classify_signal`,
  `_technical_convolution`, `_fundamental_convolution`, `_apply_quality_gates`
  and `_compute_quantamental` delegate to the rules (public API unchanged);
  added a guarded `rules` import (`_ENGINE_HOME` on `sys.path`, `HAS_RULES`).
- Emitted `analysis['rule_trace']` (fired rules + group totals) for observability.
- Golden-master harness: `backend/tests/fixtures/` (6 synthetic + 12 real-OHLCV
  cases, offline via `df_override` + stubbed `FundamentalAnalyzer`),
  `backend/scripts/snapshot_golden.py`, 18 committed snapshots, and
  `backend/tests/test_rule_engine_golden.py` (exact-equality gate).
- `backend/tests/test_rules_parity.py` (108 checks) proving each rule function
  equals the method it replaced.
- `scripts/sync_engine.py` to propagate the engine + `rules/` package to the
  deploy copies with sha256 + import verification.

**Validation:**
- Full suite: **192 passed** (65 pre-existing + 19 golden + 108 parity).
- Golden determinism: SHA-256 stable across runs.
- Production copy: the share-root engine reproduces all 18 golden masters exactly
  (`HAS_RULES == True`); `sync_engine.py --check` reports 0 drift across all 24
  engine/rules files in the 3 deploy targets.

**Result:**
Market-analysis decisions are now code-defined, individually testable, and
regression-locked. Behaviour is byte-identical to the pre-refactor engine.

---

### [TASK-009] Deterministic analyzer application (`analysis_app/`)

**Status:** Completed

**What I found:**
The engine is pure *given fixed inputs*, but its inputs were not fixed: OHLCV
came from live `yfinance`, fundamentals from live calls, and several code paths
read the wall clock (`datetime.now()` at the fundamentals cache TTL, `saved_at`,
`generated_at`, and the report `Date` line). Results were therefore
irreproducible run-to-run, and there was no way to analyze the full NSE universe
deterministically.

**Why it mattered:**
Reproducibility is a prerequisite for trustworthy backtesting, audit and
regression testing. Without it, "the same stock gave a different answer" could
never be ruled out.

**What I changed:**
- New top-level package `analysis_app/`:
  - `determinism.py` — `canonical_json`, `sha256_*`, frozen `Clock`,
    `derive_run_id`, `BUILDER_VERSION`.
  - `datasource.py` — `PinnedDataSource` + `build_snapshot` + providers
    (`yfinance_ohlcv`, `csv_dir_ohlcv`, `reports_fundamentals`, `derive_info`).
  - `indicators.py` — self-contained pure `sma`, Wilder `atr`/`adx`.
  - `state_machine.py` — composite **regime × setup × position** state machine
    + per-bar `position_timeline` (stop-before-target within a bar).
  - `analyzer.py` — `analyze_ticker` / `analyze_universe` (pinned pipeline +
    state machine).
  - `report.py` — `write_run` / `verify_run` (manifest, per-stock JSON,
    ranking/states CSV, HTML, `run.sha256`).
  - `cli.py` — `freeze` / `analyze` / `verify` / `report`.
  - `api.py` — FastAPI router `/api/v1/deterministic/*`.
- Engine seams (canonical `engine/technical_analysis_report.py`):
  `FundamentalAnalyzer(..., now=None)` + `_clock_now()`;
  `TechnicalAnalysisPipeline(..., now=None, fundamental_analyzer_cls=None)`;
  `ReportBuilder(..., now=None)`. Backward compatible.
- Frontend: `/deterministic` page + `api.deterministic.*` client + types + nav.
- Docs: `docs/DETERMINISTIC_ANALYZER.md`; PROJECT_MAP/FEATURES updated.

**Validation:**
- `python -m pytest analysis_app/tests -q` → **23 passed**.
- End-to-end: two runs over the same snapshot produce **byte-identical**
  artifacts (`run.sha256` equal); `verify_run` detects tampering.
- Backend suite still **192 passed**; frontend suite still **130 passed**.
- `sync_engine.py --check` → 0 drift across all 24 engine/rules files.
- **Real full-NSE run** (2026-10-14): snapshot 2,696 tickers / 1,651,860 OHLCV
  rows / 2,696 fundamentals (`snapshot_sha=e56494f10db7…`); `analyze` in ~48 s →
  run_id `49e68a4f3ab5178a`, 2,432 analyzed / 264 errors (all "insufficient
  data"), `run_sha256=7d99a45470d6…` identical across repeated runs.
- **Run-identity fix:** `run_id` now derives from the *effective* (post-`--limit`)
  universe, so a limited run and a full run no longer collide on the same id;
  regression test `test_limit_changes_run_identity` added.

**Result:**
A deterministic, reproducible analysis application: pinned snapshot + frozen
clock + injected fundamentals ⇒ identical inputs always yield identical outputs,
exposed via CLI, REST API and a frontend page. Verified end-to-end on the real
full-NSE universe.

---

### [TASK-004] Expand `frontend/lib/indicators.ts` with 22 Phase D indicators

**Status:** Completed

**What I found:**
`ComputedIndicators` and `computeIndicators` only exposed the Phase A/B set (ema/bollinger/rsi/macd/swings/ichimoku/superTrend/orderBlocks/fvgs/volumeProfile/fibonacci/trendlines/patterns/adx/stoch/cci/obv/psar/vwap/atr/williamsR). The `IndicatorSettings` contract in `components/chart/types.ts` had already been expanded with 30 new fields (smaPeriod … williamsPeriod), but none were consumed. `williamsR` was still hard-wired to `rsiPeriod` instead of the new dedicated `williamsPeriod`.

**Why it mattered:**
The chart's indicator menu and pane definitions already list the new indicators (mfi, stochrsi, ao, roc, mom, trix, uo, ppo, rvi, cmo, fi, eom, mass, klinger, dpo, er, cmf, keltner, donchian, aroon, envelopes), but `computeIndicators` returned none of them — the panes would render empty.

**What I changed:**
- Added 22 point interfaces (SMAPoint … CMFPoint) and 22 fields to `ComputedIndicators`.
- Added 22 helper functions in the existing style (plain loops, `{ time: "", … }` placeholders, warm-up guards returning only valid points, no NaN/Infinity):
  `smaSeries`, `keltnerChannels`, `donchianChannels`, `aroon`, `mfi`, `stochRsi`, `awesomeOscillator`, `roc`, `momentum`, `trix`, `ultimateOscillator`, `ppo`, `rvi`, `cmo`, `forceIndex`, `easeOfMovement`, `massIndex`, `klinger`, `dpo`, `elderRay`, `envelopes`, `cmf`.
- Wired all 22 into `computeIndicators` with per-indicator warm-up offsets via the existing `zipTimes` helper; added the 30 Phase D settings defaults.
- Corrected `williamsR` to use `s.williamsPeriod` (was `s.rsiPeriod`).

**Validation:**
- TypeScript: `npx tsc --noEmit` — 0 errors in `lib/indicators.ts` (5 pre-existing errors remain in ChartBuilder.ts / ChartToolbar.tsx / InteractiveChart.tsx, all about `types.ts` contracts untouched by this task).
- Runtime smoke test (300-bar synthetic OHLCV, run via `npx tsx`, then removed): all 22 new indicators + atr/williamsR/volumeProfile/fibonacci PASS — correct warm-up point counts, all values finite, no nulls, plausible ranges (RSI/MFI/StochRSI/UO 0–100, CMO −100..100, Aroon 0–100), last point time-aligned to the final candle, first point times are real dates.

**Result:**
`computeIndicators` now returns all 22 Phase D indicators plus the verified existing set. Signature unchanged; no other file touched.

---

## Issues Found

| ID | Severity | Component | Issue | Status |
|---|---|---|---|---|
| BUG-001 | HIGH | pattern_engine.py | `_calc_status` never called — all statuses stuck at "forming" | Fixed |
| BUG-002 | HIGH | pattern_engine.py | H&S neckline used min swing low (frontend: max) | Fixed |
| BUG-003 | HIGH | pattern_engine.py | IHNS neckline used max swing high (frontend: min) | Fixed |
| BUG-004 | MEDIUM | pattern_engine.py | Falling-wedge target mixed start/end wedge points | Fixed |
| BUG-005 | MEDIUM | pattern_engine.py | Negative-expectancy patterns reached production output | Fixed (gated at call sites) |
| BUG-006 | LOW | pattern_engine.py | `end_idx` missing from all 17 detectors | Fixed |

---

## Testing Record

### Unit Tests

- Full suite: 47/47 PASS (`python3 -m pytest tests/test_pattern_engine.py -v`)

### Integration Tests

- `run_pattern_backtest('RELIANCE.NS', years=1)` — PASS: detected_patterns = [IHNS completed, end_idx=40]; 13 trades; per_pattern includes sym-tri (9) + H&S (3) + IHNS (1) in backtest (calibration path intact)

### Regression Tests

- All 47 tests pass after every change batch

---

## Mathematical Validation

- **Falling-wedge target:** verified source uses `(h1.price - l1.price) * TARGET_MULT_CONTINUATION`; old `max(h1,l1) - min(h2,l2)` formula removed.
- **Neckline parity:** verified H&S uses `_max_swing_between(swing_lows, ...)` and IHNS uses `_min_swing_between(recent_highs, ...)`, matching frontend `maxSwingBetween` / `minSwingBetween`.
- **Status semantics:** `_calc_status` returns `forming` (no entry), `failed` (stop hit first), `completed` (target hit first), `active` (neither). RELIANCE.NS IHNS = `completed` — target reached after right shoulder before stop.

---

## Performance Findings

- No performance regression: the `_calc_status` wiring adds a single O(n) scan per emitted pattern (n ≤ 60 bars in the production window). Negligible.
- The LOW_EDGE gate is a list comprehension over ≤3 patterns at the call site. Negligible.

---

## Remaining Work

- [ ] None identified. All 7 instruction items implemented; 47/47 tests green.

---

## Risks / Concerns

- The LOW_EDGE gate placement deviates from the literal instruction (call sites instead of inside `detect_patterns`). This was required to keep all 47 tests green (9 tests use `detect_patterns` as the harness and expect the gated types). The gate's intent — production exclusion — is fully met. If a future test suite is written to expect the gate inside `detect_patterns`, the gate can be moved inward.
- The smoke test in the instructions used GIPCL.NS, which currently produces no patterns in its 60-bar window (data-dependent). RELIANCE.NS was used instead to demonstrate live statuses.

---

## Next Recommended Action

- Run a fresh reliability calibration over the three LOW_EDGE patterns; if any shows >= +0.10R with adequate sample, remove it from `LOW_EDGE_PATTERNS` (or flip `ENABLE_LOW_EDGE_PATTERNS` selectively).

---

## Change History

| Date | Change | Reason | Validation |
|---|---|---|---|
| 2026-09-02 | Added `end_idx` field to DetectedPattern | Frontend parity for status computation | 47/47 tests |
| 2026-09-02 | Set `end_idx` in all 17 detectors | Frontend parity | 47/47 tests |
| 2026-09-02 | Wired `_calc_status` into detect_patterns | Live statuses instead of always "forming" | 47/47 tests + smoke |
| 2026-09-02 | H&S neckline min→max; IHNS max→min | Frontend parity | 47/47 tests |
| 2026-09-02 | Falling-wedge target uses h1-l1 | Correct wedge-opening measurement | 47/47 tests |
| 2026-09-02 | LOW_EDGE gate at production call sites | Exclude negative-expectancy patterns from production | 47/47 tests + smoke |
| 2026-09-02 | Documented classify_gaps / detect_multi_tf_patterns as dead code | Maintainer clarity | 47/47 tests |
| 2026-09-13 | Added 22 Phase D indicators to frontend/lib/indicators.ts | Chart panes/menu already listed them but computeIndicators returned none | tsc clean for indicators.ts + runtime smoke test |
| 2026-09-13 | williamsR now uses williamsPeriod setting | Dedicated setting existed but was ignored | tsc clean + runtime smoke test |
| 2026-10-14 | Extracted decision logic into `engine/rules/`; engine delegates; added `rule_trace` | Make core decisions testable, safe to change, single-source | 192 tests (19 golden + 108 parity) |
| 2026-10-14 | Added golden-master harness (18 snapshots) + `snapshot_golden.py` | Exact-equality regression net for the refactor | Deterministic SHA-256; 18/18 match |
| 2026-10-14 | Added `scripts/sync_engine.py`; propagated engine + `rules/` to 3 deploy copies | Eliminate silent drift across the 5 physical copies | sha256 match + import `HAS_RULES True` |
| 2026-10-14 | Added `analysis_app/` deterministic analyzer (snapshot, state machine, CLI, API, page) | Reproducible full-universe analysis; regime × setup × position | 22 new tests; byte-identical artifacts; 192 backend + 130 frontend still green |
| 2026-10-14 | Added engine seams `now=` / `fundamental_analyzer_cls=` | Remove wall-clock + live-fundamentals non-determinism | 192 backend tests; re-propagated via `sync_engine.py` |
| 2026-10-14 | `run_id` derives from effective (post-`--limit`) universe | Limited and full runs collided on the same id | 23 analysis_app tests; full run id unchanged |
| 2026-10-14 | Ran full-NSE analyze on pinned snapshot (2,696 tickers) | Validate the app end-to-end on real data | 2,432 analyzed / 264 errors; `run_sha256` stable across runs |