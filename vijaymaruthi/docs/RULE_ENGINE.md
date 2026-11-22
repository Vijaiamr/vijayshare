# Rule Engine (`engine/rules/`)

> **Status:** Live. Since this refactor, every market-analysis *decision* is
> computed by the code-defined rule modules under `engine/rules/`. The legacy
> logic inside `technical_analysis_report.py` was replaced by thin delegating
> methods. Behaviour is locked by an exact-equality golden-master gate.

## Why it exists

Before this refactor, the decision logic (signal classification, the two
weighted convolutions, quality gates, quantamental fusion, pattern gating) was
scattered as hardcoded `if/else` + magic-number blocks spread through a
~5,800-line `technical_analysis_report.py`. That made the rules:

- hard to read (buried in a monolith),
- hard to test in isolation (required a full network/pipeline run),
- hard to change safely (no regression net),
- duplicated across 4 physical copies with silent drift.

The rule engine extracts those decisions into small, pure, individually
testable rule modules, and adds a golden-master harness so any behavioural
change is caught immediately.

## Design principles

1. **Pure functions.** Rule modules take a `MarketFeatures` bundle and return a
   value — no I/O, no network, no globals mutated. This is what makes them
   unit-testable and golden-testable offline.
2. **Exact-equality contract.** The refactor is a *big-bang* extraction: the
   rules must reproduce the old numbers **exactly** (not approximately). The
   golden snapshots (`backend/tests/golden/*.json`) are the source of truth.
3. **Delegation, not duplication.** `technical_analysis_report.py` keeps its
   public method names (`_classify_signal`, `_technical_convolution`, …) so no
   caller changes — each method now builds a `MarketFeatures` and delegates to
   the matching rule function.
4. **Observability.** The engine records a `rule_trace` into
   `analysis['rule_trace']` describing which rules fired and the group totals.

## Module map

| Module | Public API | Responsibility |
|---|---|---|
| `core.py` | `MarketFeatures`, `Rule`, `FiredRule`, `RuleOutcome`, `RuleSet`, `DecisionTrace` | Rule primitives: a `RuleSet` evaluates rules against features, clamps per-group contributions via `group_max`/`group_clamp`, and returns a `RuleOutcome`; `DecisionTrace` assembles outcomes into a serialisable trace. |
| `technical.py` | `classify_signal`, `technical_convolution`, `classify_outcome`, `convolution_outcome`, `CLASSIFY_GROUP_MAX`, `CONV_WEIGHTS` | Signal classification (Trend 20 / MA 15 / RSI 10 / MACD 10 / ADX 10 / Volume 10 / OBV 5 / Wyckoff 10 / Fib 10 → BUY≥65 / SELL≤35 / HOLD) + entry/target/stop levels (degenerate-trade guard); the 7-component technical convolution (pattern 30, trend 15, momentum 15, volume 15, candlestick 10, oscillator/divergence 10, Wyckoff 5; score = `50 + total/2`). |
| `fundamental.py` | `fundamental_convolution` | 7-factor fundamental convolution (value 20 / growth 20 / profitability 20 / risk 15 / momentum 10 / analyst 10 / dividend 5) with the AND-floor cap at 65 when any factor `< FUND_FACTOR_FLOOR (50)`. |
| `gates.py` | `apply_quality_gates` | Post-fusion quality gates (data / liquidity / fundamental / valuation / calibration) that can downgrade a signal. |
| `quantamental.py` | `compute_quantamental`, `cap_weight`, `cap_category`, `map_fund_rating_to_score`, `parse_pct`, `parse_num`, `fallback_fund_score` | 50/50 technical/fundamental blend with market-cap weighting clamped to `[0.45, 0.55]` and VADER sentiment adjustment. |
| `pattern_gates.py` | `pattern_votes`, `UNAVAILABLE`, `BULL_W`, `BEAR_W`, `SYM_TRIANGLE_MAX_RR`, `SYM_TRIANGLE_MAX_ATR_PCT` | Converts detected patterns into bull/bear votes. A bullish `symmetrical_triangle` only counts when `risk_reward ≤ 3.5` **and** `atr_pct ≤ 1.0`; ties are neutral (never a veto). |

## Data flow

```
OHLCV + fundamentals
        │
        ▼
TechnicalAnalysisPipeline.run()
        │  builds _MarketFeatures(analysis, price, pattern_votes, ticker, yf_info)
        ▼
 engine/rules/*.py  ──►  value returned to the caller (unchanged public API)
        │
        └──► analysis['rule_trace']  (DecisionTrace: fired rules + group totals)
```

`MarketFeatures` is the single, explicit input contract; adding a new rule means
reading fields off it, not reaching into pipeline state.

## How it is validated

| Harness | Location | What it proves |
|---|---|---|
| Golden masters | `backend/tests/golden/*.json` (18 cases) | Byte-exact reproduction of every decision field |
| Golden gate test | `backend/tests/test_rule_engine_golden.py` | Regenerates snapshots and compares exactly (determinism). |
| Parity test | `backend/tests/test_rules_parity.py` (108 checks) | Each rule function equals the engine method it replaced, per case. |
| Fixtures | `backend/tests/fixtures/` | 6 synthetic + 12 real-OHLCV cases; offline via `df_override` + stubbed `FundamentalAnalyzer`. |

Regenerate snapshots after an **intentional** behaviour change:
```bash
cd backend && python3 scripts/snapshot_golden.py          # rewrite golden files
cd backend && python3 -m pytest tests/ -q                  # verify
```

## Propagation (the 5 copies)

The engine is physically duplicated. The canonical copy is
`vijaymaruthi/engine/`; the others are deploy copies. After editing the
canonical engine **or** `engine/rules/`, propagate with:

```bash
cd vijaymaruthi && python3 scripts/sync_engine.py            # copy + verify
cd vijaymaruthi && python3 scripts/sync_engine.py --check    # verify only
```

Targets: `share-root/`, `vijaymaruthi/vercel-backend/lib/`, `share-root/pi-bundle/`.
The script copies `technical_analysis_report.py` **and the entire `rules/`
package** (the engine imports `rules` from its own directory via `_ENGINE_HOME`),
verifies sha256 equality, and confirms each target imports with
`HAS_RULES == True`.

> ⚠️ If `rules/` is missing next to an engine copy, that copy raises
> `AttributeError` at runtime (the legacy fallbacks were removed). Always
> propagate the whole package.

## Out of scope

Paper-trading/simulator rules (R4–R11, F-1, volatility sizing) remain hardcoded
in the backend and are **not** part of this rule engine (phase 2).
`frontend/lib/patterns.ts` intentionally drifts — it is a separate client-side
implementation.
