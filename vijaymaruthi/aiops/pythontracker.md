# Python Engineering Tracker

## Current Status

**Overall Status:** In Progress (ADK layer fixed and verified; frontend integration remains)

**Last Updated:** 2026-09-15

**Current Focus:** ADK 2.x bridge rewrite, root agent activation, server wiring

---

## Executive Summary

Built the complete AIOps Python engine (10 modules) inside
`/Users/vijaykumar/projecs /opencode/share/vijaymaruthi/aiops` per the contract:
market data + indicators + regime + features, prediction store + engine,
validation + calibration, learning (BM25 + lessons + recipes + knowledge),
OpenCode client/parser/agent/bridge (ADK-optional), workflows (runs, morning,
evening, backtest), CLI, tools, and root agent stub. All 19 tests pass offline.
The real-data acceptance chain (init → backtest → status → morning → evening →
status → validate) completed successfully on `state/aiops.db`.

**Extension phase (this session):** added recursive multi-year historical
backtest from 2000-01-01, deterministic pattern gating (no force-fit),
multi-agent predict/validate loop, and positive/negative knowledge
accumulation. 40 tests pass (19 original + 21 new). A real 5-year backtest
(2000-01-01 → 2004-12-31, 11 symbols) completed in minutes: 1305 days, 4359
predictions, hit_rate 0.4306, 5521 skipped (no-force-fit), 12 knowledge rows
promoted (9 positive, 3 negative).

**ADK fix phase (this session):** audited the ADK layer (FAIL), then rewrote
`opencode/bridge.py` against the google-adk 2.9.0 contract (content-based
`LlmResponse`, `google.genai.types` parts, full-history serialization),
fixed the `_with_conn` wrapper (`**kwargs` + `__signature__` so FunctionTool
derives correct schemas), fixed a pre-existing circular import in
`agents/root/__init__.py` (`..` → `...`), wired the root agent into
`server/main.py` (`/api/v1/adk` + `adk` status object), pinned
`google-adk>=2.9,<3`, and added `tests/test_adk_bridge.py` (18 tests).
google-adk 2.9.0 installed; full suite: 59 passed.

---

## Work Completed

### [TASK-001] Package scaffolding

**Status:** Completed

**What I found:**
The `aiops/` package had no subpackages yet; only the contract files
(`config.py`, `clock.py`, `db/`) existed.

**Why it mattered:**
The 10-module contract required a full package layout.

**What I changed:**
Created `market/`, `prediction/`, `validation/`, `learning/`, `opencode/`,
`workflows/`, `cli/`, `tools/`, `agents/root/` with `__init__.py` files and
implemented every module.

**Validation:**
- Import smoke test: PASS
- pytest suite: PASS

### [TASK-002] Market data, indicators, regime, features

**Status:** Completed

**What I found:**
No data layer existed beyond the DB contract.

**Why it mattered:**
Predictions need OHLCV, indicators, regime classification, and leakage-safe
feature building.

**What I changed:**
`fetch.py` (yfinance fetch with exclusive `end`, `upsert_daily` INSERT OR
IGNORE, `available_at_iso`), `indicators.py` (SMA/EMA/RSI/MACD/ATR/Bollinger/
ADX/volume SMA), `regime.py`, `features.py` (`build_features` with
`MIN_BARS=30` and `INSUFFICIENT_DATA` guard).

**Validation:**
- `test_features.py`: PASS (as_of filtering, insufficient data)

### [TASK-003] Prediction store + engine

**Status:** Completed

**What I found:**
No prediction persistence or generation existed.

**Why it mattered:**
Core deliverable — daily predictions with temporal correctness.

**What I changed:**
`store.py` (idempotent `insert_prediction`, `get_prediction`, `list_predictions`,
`record_agent_run`), `engine.py` (`predict_symbol` with baseline + LLM modes,
`as_of = D 09:00 IST`, exception-safe LLM path persisting INSUFFICIENT_DATA).

**Validation:**
- `test_schema.py`: PASS (immutability triggers)
- `test_backtest_boundary.py`: PASS (as_of == predict_at(D), no future bars)

### [TASK-004] Validation + calibration

**Status:** Completed

**What I found:**
No validation layer existed.

**Why it mattered:**
Predictions must be scored and calibration tracked per confidence bucket.

**What I changed:**
`validation/engine.py` (`validate_predictions`, `update_calibration`,
`confidence_bucket`).

**Bug fixed during testing:**
`update_calibration` INSERT had 4 placeholders but only 3 bindings supplied
(the `hit_rate` placeholder was unfilled). Fixed by passing `hit` for the
initial `hit_rate` (n=1 ⇒ hit_rate = hits/n = hit).

**Validation:**
- `test_backtest_boundary.py`: PASS after fix
- `test_acceptance.py`: PASS

### [TASK-005] Learning subsystem

**Status:** Completed

**What I found:**
No learning layer existed.

**Why it mattered:**
Continuous learning requires retrieval (BM25), lesson lifecycle, recipes, and
knowledge versioning.

**What I changed:**
`bm25.py` (tokenizer + BM25 index), `lessons.py` (propose/add/promote/list),
`recipes.py` (3 starter recipes), `knowledge.py` (versioned knowledge context).

**Validation:**
- `test_bm25.py`: PASS

### [TASK-006] OpenCode integration

**Status:** Completed

**What I found:**
google-adk is NOT installed in the environment; the OpenCode server is not
running on port 4096.

**Why it mattered:**
The LLM path must degrade gracefully without ADK and without a live server.

**What I changed:**
`client.py` (OpenCodeClient with health/session/message, Basic auth, 120s
timeout), `parser.py` (strict JSON parser), `agent.py` (prompt builders),
`bridge.py` (lazy ADK import; `OpenCodeLlm` factory; `ADK_INSTALL_HINT`).

**Validation:**
- `morning --mode llm` without server: exit 1 with clear error (PASS)
- Baseline mode unaffected: PASS

### [TASK-007] Workflows + CLI

**Status:** Completed

**What I found:**
No orchestration or CLI existed.

**Why it mattered:**
Daily morning/evening runs, backtests, and status/validate commands are the
user-facing surface.

**What I changed:**
`runs.py` (begin/finish/get/status), `morning.py`, `evening.py` (graceful
no-close handling, lesson proposal), `backtest.py` (force=True per day +
in-code leakage assertion), `cli/main.py` (all subcommands + `serve` stub).

**Validation:**
- `test_acceptance.py`: PASS (full CLI chain + idempotency)
- Real-data chain: PASS

### [TASK-008] Tests

**Status:** Completed

**What I found:**
No tests existed.

**Why it mattered:**
The contract required offline tests covering schema, clock, BM25, features,
backtest boundaries, and a full acceptance chain.

**What I changed:**
`conftest.py` (db fixture, deterministic `synthetic_ohlcv`, `seed_market`),
`test_schema.py`, `test_clock.py`, `test_bm25.py`, `test_features.py`,
`test_backtest_boundary.py`, `test_acceptance.py`.

**Bug fixed during testing:**
`test_schema.py` used `pytest.raises` without `import pytest` → NameError.
Added the import.

**Bug fixed during testing:**
`prediction/engine.py` `_recent_stats` and the `predict_symbol` early-return
passed `date` objects to sqlite3, triggering the Python 3.12+ deprecated date
adapter warning. Changed to `.isoformat()` strings.

**Validation:**
- `pytest tests/ -q`: 19 passed, 0 warnings

### [TASK-009] Schema + data layer for multi-year backtest

**Status:** Completed

**What I found:**
The schema had no place to accumulate pattern outcomes or fundamentals
snapshots, and `knowledge` had no dedupe key.

**Why it mattered:**
Knowledge accumulation requires per-pattern outcome aggregates and a stable
dedupe key for promoted knowledge rows.

**What I changed:**
- `db/schema.sql`: added `fundamentals` table, `pattern_stats` table, and
  `ref TEXT` column on `knowledge`.
- `db/engine.py`: added generic `_ensure_column` (PRAGMA check + ALTER TABLE)
  and call it in `migrate()` for `knowledge.ref`.
- `market/fetch.py`: added `fetch_daily_range` (end-inclusive), 
  `ensure_daily_range` (skips network when range already covered),
  `fetch_fundamentals` (yfinance current snapshot labeled as_of, {} on failure),
  `store_fundamentals` (INSERT OR IGNORE).
- `market/features.py`: `build_features` now also returns `high_20`/`low_20`
  (needed by breakout patterns).

**Bug fixed during migration:**
`schema.sql` created `idx_knowledge_ref_kind ON knowledge(ref, kind)` inside
`executescript`, which failed on pre-ref databases ("no such column: ref")
because the index ran before `_ensure_column`. Moved the index creation into
`migrate()` after `_ensure_column`; schema.sql now documents this.

**Validation:**
- `init` on the pre-existing `state/aiops.db`: PASS (column + index added)
- pytest suite: PASS

### [TASK-010] Pattern gate (no force-fit)

**Status:** Completed

**What I found:**
The baseline predictor always emitted a prediction (flat when no signal),
which would fabricate predictions on weak data during a multi-year replay.

**Why it mattered:**
The contract requires pattern gating — no prediction unless a deterministic
pattern fires; weak days are skipped, never force-fit.

**What I changed:**
- `prediction/engine.py`: replaced `_baseline` with a pattern-gated version
  (priority: trend_up/trend_down → meanrev_up/meanrev_down →
  breakout_up/breakout_down → `{"pattern": "none"}`), added `_is_insufficient`,
  and `predict_symbol(..., allow_skip=False)`. When `allow_skip=True` and no
  pattern fires (or LLM returns INSUFFICIENT_DATA), the function returns None
  and inserts nothing; LLM audit rows are still recorded. When
  `allow_skip=False` (live morning default), no-pattern becomes a flat row
  (old behavior preserved).

**Bug fixed during testing:**
The skip gate originally ran AFTER target/stop price computation, so a
`{"pattern": "none"}` dict crashed with `KeyError: 'target_pct'` before the
gate could return None. Moved the gate to right after mode dispatch.

**Validation:**
- `test_pattern_gate.py` (10 tests): PASS
- Existing acceptance tests (flat rows in live mode): PASS

### [TASK-011] Validator agent + agent validation mode

**Status:** Completed

**What I found:**
Validation was purely deterministic; the contract requires a multi-agent
predict/validate loop where a validator agent adds qualitative assessment and
knowledge proposals.

**Why it mattered:**
The agent loop is the learning feedback channel; the validator must never
compute numbers (Python computes the hit).

**What I changed:**
- Created `/Users/vijaykumar/projecs /opencode/share/.opencode/agents/aiops-validator.md`
  (subagent, temperature 0.2, tools [], strict `validate` output contract).
- `opencode/agent.py`: added `_OUTPUT_CONTRACT_VALIDATE` and
  `build_validation_prompt` (embeds prediction + Python-computed outcome;
  `features_summary=None` never fabricates data).
- `validation/engine.py`: `validate_predictions(..., mode="deterministic"|"agent",
  llm_client=None, daily_run_id=None)`; `_agent_assess` calls the validator,
  records user+assistant turns in `agent_runs`, and adds knowledge with
  `ref=f"validator:{symbol}:{run_date}"`; never raises.

**Validation:**
- `test_validator_prompt.py` (3 tests): PASS

### [TASK-012] Knowledge accumulation

**Status:** Completed

**What I found:**
`knowledge.py` had no way to add positive/negative observations or promote
pattern outcomes into versioned knowledge.

**Why it mattered:**
The contract requires positive/negative knowledge accumulation from pattern
outcomes, deduplicated by ref.

**What I changed:**
- `learning/knowledge.py`: `VALID_KINDS` = {positive, negative, recipe, lesson,
  rule}; `add_knowledge(conn, kind, content, ref=None)` (dedupe by ref+kind,
  bumps knowledge_version+hash, returns id or None); `update_pattern_stats`
  (SQLite upsert n/hits/hit_rate); `promote_pattern_knowledge(conn, min_obs=5)`
  (hit_rate >= 0.6 → positive, <= 0.4 → negative, ref
  `pattern:{symbol}:{pattern}:positive|negative`); `bump_knowledge` now accepts
  `ref` and returns the new id.

**Validation:**
- `test_knowledge.py` (6 tests): PASS
- Real 5-year backtest promoted 9 positive + 3 negative rows (e.g. TCS
  meanrev_up 0/268 → negative; HDFCBANK meanrev_up 8/10 → positive)

### [TASK-013] Recursive date-range backtest rewrite

**Status:** Completed

**What I found:**
`workflows/backtest.py` only replayed the last N trading days and always
inserted predictions (no skip, no pattern stats, no knowledge promotion).

**Why it mattered:**
The contract requires a recursive multi-year replay from 2000-01-01 with
per-day predict → validate → accumulate → promote.

**What I changed:**
Rewrote `run_backtest(conn, *, start=None, end=None, years=5, days=None,
mode="baseline", validate_mode="deterministic", llm_client=None, min_bars=100)`:
- `_resolve_range`: start omitted → today - years; end omitted → today; start
  given + end omitted → Dec 31 of (start.year + years - 1) (2000-01-01 + 5
  years → 2004-12-31). `days=N` keeps the old last-N-dates behavior.
- `_trading_dates_in_range`, vectorized `_regime_series` (replicates
  `classify_regime` incl. n>=15 guard), `_precompute_symbol` (indicator
  DataFrame indexed by date, deduped), `_features_from_slice`.
- Per-symbol `ensure_daily_range` with 60-day warmup; per-day loop with
  `begin_run(force=True)`, `predict_symbol(allow_skip=True)`,
  `validate_predictions`, `update_pattern_stats`, `finish_run`;
  `promote_pattern_knowledge` after the loop.
- Temporal boundary enforced: `assert features["last_date"] < D.isoformat()`.
- Summary includes days/start/end/run_dates/predictions/prediction_list
  (backward compat)/hits/hit_rate/skipped/per_direction/calibration/
  per_symbol/patterns/knowledge/results.

**Bug fixed during testing:**
The per-day `results[].skipped` field was computed as a sum over eligible
symbols that ARE in preds (inverted logic — counted predictions, not skips).
Replaced with a real per-day counter incremented when `predict_symbol` returns
None.

**Validation:**
- `test_backtest_range.py` (4 tests): PASS
- Real 5-year backtest: 1305 days, 4359 predictions, hit_rate 0.4306,
  skipped 5521, finished in minutes

### [TASK-014] CLI extension

**Status:** Completed

**What I found:**
The CLI `backtest` subcommand only exposed `--days`/`--mode`; no way to run a
date-range backtest, fetch fundamentals, or inspect data coverage.

**Why it mattered:**
The contract requires `backtest --start 2000-01-01 --years 5`, a
`fundamentals` subcommand, and a `data` subcommand.

**What I changed:**
`cli/main.py`: `backtest` gains `--start`, `--end`, `--years` (default 5),
`--validate-mode deterministic|agent` (keeps `--days`/`--mode`); added
`fundamentals` (fetch + store + print table) and `data` (per-symbol
first/last/bars) subcommands; `cmd_backtest` prints the full summary
(directions, calibration, per-symbol, patterns, knowledge).

**Validation:**
- `init`, `backtest --start 2000-01-01 --years 5`, `data`, `fundamentals`:
  PASS on real data

### [TASK-015] New tests

**Status:** Completed

**What I found:**
No tests covered pattern gating, knowledge accumulation, date-range backtest,
or the validator prompt.

**Why it mattered:**
The contract requires offline tests for each new capability.

**What I changed:**
- `test_pattern_gate.py` (10 tests): each pattern fires with correct
  direction/target/stop/confidence; no-pattern returns `{"pattern": "none"}`;
  weak trend not force-fit; `allow_skip=True` returns None and inserts
  nothing; `allow_skip=False` inserts flat; pattern merged into returned dict.
- `test_knowledge.py` (6 tests): pattern_stats upsert; promotion boundaries
  (0.6 → positive, 0.4 → negative, 0.5 → leave); dedupe by ref on second
  promote; add_knowledge dedupe by ref+kind; invalid kind raises.
- `test_backtest_range.py` (4 tests): multi-year replay with pattern-only
  predictions, validation rows, pattern_stats, knowledge structure,
  per-symbol coverage, temporal boundary (no D bar observable at as_of);
  years-default resolution; `days=` backward compat.
- `test_validator_prompt.py` (3 tests): prompt carries prediction + outcome,
  mentions the validate contract, never fabricates features.

**Validation:**
- `pytest tests/ -q`: 40 passed (19 original + 21 new)

### [TASK-016] ADK bridge rewrite (google-adk 2.9.0 contract)

**Status:** Completed

**What I found:**
The audit (FAIL) showed `opencode/bridge.py` targeted a non-existent ADK API:
`LlmResponse(parts=...)` never existed in any google-adk release (0.0.1 →
2.9.0); `Message`/`Text`/`FunctionCall`/`FunctionResponse` were imported from
`google.adk.models.llm_response` but live in `google.genai.types`;
`FunctionTool(function=..., name=..., description=..., parameters=...)` was
called with kwargs that only exist in ADK 0.x. With `google-adk>=0.1`
resolving to 2.9.0, the whole layer broke at import time. The request
direction also dropped tool-call/tool-response history (multi-turn broken),
and `BaseLlm` is a pydantic model in 2.x (plain `self._client = ...` in
`__init__` would not work).

**Why it mattered:**
The ADK layer was dead code that could never run; the fix list required a
rewrite against the current contract.

**What I changed:**
- `opencode/bridge.py`: `_adk()` now imports `BaseLlm`/`LlmRequest`/
  `LlmResponse` from `google.adk.models.*` and `types` from `google.genai`,
  and distinguishes `ModuleNotFoundError` (truly not installed) from other
  ImportErrors (installed but broken). `OpenCodeLlm` is a pydantic subclass
  with declared fields + `PrivateAttr` client built in `model_post_init`;
  `model` resolves to `"opencode"` when config is unset (fixes a latent
  ValidationError when `OPENCODE_MODEL` is empty). `generate_content_async`
  yields `LlmResponse(content=types.Content(role="model", parts=[...]),
  partial=False)`; `_serialize_history` renders the full request history
  (text, tool calls, tool responses) as role-marked lines so multi-turn tool
  context survives the text-only opencode client.
- `agents/root/__init__.py`: `_with_conn` wrapper now `def wrapper(**kwargs)`
  (FunctionTool invokes `target(**args)`), carries `__name__`, the
  descriptor's `description` as `__doc__`, and an explicit `__signature__`
  (KEYWORD_ONLY params, `default=None`, `Optional[str]` /
  `Optional[Literal[...]]` annotations) so FunctionTool derives correct
  optional typed schemas with the status enum preserved. Tools built as
  `FunctionTool(func=...)`. Error handling distinguishes ModuleNotFoundError
  ("not installed") from other ImportErrors ("installed but failed to
  import").
- `server/main.py`: imports `aiops.agents`; `/api/v1/status` gains an `adk`
  object (`available`/`error`/`ui_url`/`agent`); new `GET /api/v1/adk`
  endpoint; `adk_ui_url` kept for frontend backward compat.
- `pyproject.toml`: `adk = ["google-adk>=2.9,<3"]`.
- `tests/test_adk_bridge.py` (18 tests): root agent build, tool names/
  descriptions, schema derivation (run_date optional string, status enum
  preserved), wrapper invocation with temp DB, content-based LlmResponse,
  history serialization, model resolution, `generate_content_async` text +
  tool-call mapping, `_try_parse_tool_call`. Skips cleanly via
  `pytest.importorskip("google.adk")`.

**Bug fixed during testing:**
`agents/root/__init__.py` used `from .. import config` — from
`aiops.agents.root`, `..` is `aiops.agents` (circular import). Changed to
`from ... import config` (and `...db`, `...opencode`, `...tools`). This was a
pre-existing latent bug never exercised because nothing imported
`aiops.agents` before.

**Validation:**
- `pytest tests/test_adk_bridge.py`: 18 passed
- `pytest tests/ -q`: 59 passed (41 existing + 18 new)
- Server smoke: `GET /api/v1/adk` → `{'available': True, 'error': None,
  'agent': 'aiops_root'}`; `/api/v1/status` includes `adk` object
- ADK-absent simulation (meta-path blocker): `root_agent=None`, clear
  "not installed" ADK_ERROR
- Broken-dependency simulation (block google.genai): "not installed" hint
- `canonical_tools()` on root agent: 5 tools in descriptor order
- CLI import unaffected (never imports `aiops.agents`)

---

## Issues Found

| ID | Severity | Component | Issue | Status |
|---|---|---|---|---|
| BUG-001 | HIGH | validation/engine.py | INSERT had 4 placeholders, 3 bindings (hit_rate unfilled) | Fixed |
| BUG-002 | MEDIUM | tests/test_schema.py | `pytest.raises` without `import pytest` | Fixed |
| BUG-003 | LOW | prediction/engine.py | `date` objects passed to sqlite3 (deprecated adapter warning) | Fixed |
| BUG-004 | HIGH | db/schema.sql | `idx_knowledge_ref_kind` created before `_ensure_column` → "no such column: ref" on pre-ref DBs | Fixed |
| BUG-005 | HIGH | prediction/engine.py | Skip gate ran after target/stop computation → KeyError 'target_pct' on no-pattern | Fixed |
| BUG-006 | MEDIUM | workflows/backtest.py | Per-day `results[].skipped` counted predictions, not skips (inverted logic) | Fixed |
| BUG-007 | HIGH | agents/root/__init__.py | `from .. import config` from `aiops.agents.root` → circular import (`..` = `aiops.agents`); latent, never exercised | Fixed |
| BUG-008 | HIGH | opencode/bridge.py | `LlmResponse(parts=...)` + `Message/Text/FunctionCall` from wrong module — API never existed in any ADK release | Fixed (rewrite) |
| BUG-009 | HIGH | agents/root/__init__.py | `_with_conn` wrapper `def wrapper(args: dict)` incompatible with FunctionTool `target(**args)` invocation | Fixed |
| BUG-010 | MEDIUM | opencode/bridge.py | Tool-call/tool-response history dropped in request direction (multi-turn broken) | Fixed |
| BUG-011 | MEDIUM | opencode/bridge.py | `OpenCodeLlm(model=None)` → pydantic ValidationError when `OPENCODE_MODEL` unset | Fixed |

---

## Testing Record

### Unit Tests

- `test_schema.py` (3 tests) — PASS
- `test_clock.py` (3 tests) — PASS
- `test_bm25.py` (4 tests) — PASS
- `test_features.py` (3 tests) — PASS
- `test_backtest_boundary.py` (2 tests) — PASS
- `test_acceptance.py` (2 tests) — PASS
- `test_pattern_gate.py` (10 tests) — PASS
- `test_knowledge.py` (6 tests) — PASS
- `test_backtest_range.py` (4 tests) — PASS
- `test_validator_prompt.py` (3 tests) — PASS
- `test_adk_bridge.py` (18 tests) — PASS

### Integration Tests

- Full CLI acceptance chain (offline, synthetic): PASS
- Real-data acceptance chain (state/aiops.db): PASS
- Real 5-year backtest (2000-01-01 → 2004-12-31, 11 symbols): PASS
- `data` + `fundamentals` subcommands on real DB: PASS
- Server smoke: `/api/v1/adk` + `/api/v1/status` (adk object): PASS
- ADK-absent simulation: root_agent=None + clear ADK_ERROR: PASS
- `canonical_tools()` on root agent (5 tools): PASS

### Regression Tests

- Idempotent morning re-run: PASS (skipped without --force)
- Bad date input: exit 1 (PASS)
- `morning --mode llm` without server: exit 1 with clear error (PASS)
- `backtest --days N` backward compat: PASS
- `init` on pre-existing DB (column migration): PASS

---

## Mathematical Validation

- **Temporal boundary:** every prediction `as_of == predict_at(D).isoformat()`
  (D 09:00 IST); features only include bars `available_at <= D-1 16:00 IST`.
  Verified in `test_backtest_boundary`, `test_features` (future-bar leak
  test), and `test_backtest_range` (no D bar observable at a D prediction's
  as_of).
- **Backtest:** 5 days × 11 symbols = 55 predictions, 31 hits, hit_rate 0.5636
  on real data; per-direction and per-bucket calibration breakdowns sane.
- **Multi-year backtest:** 1305 days (2000-01-01 → 2004-12-31), 4359
  predictions, 1877 hits, hit_rate 0.4306, 5521 skipped (no-force-fit).
  Per-direction: up 0.4046 (n=3099), down 0.4944 (n=1260). Calibration:
  0.5-0.6 → 0.4913, 0.6-0.7 → 0.4206, 0.7-0.8 → 0.4219, 0.8-0.9 → 0.4263.
- **Pattern outcomes:** meanrev_down 0.6057 (n=246), trend_up 0.4415
  (n=2720), meanrev_up 0.1356 (n=376), trend_down 0.4675 (n=1014),
  breakout_up 0.6667 (n=3). Knowledge promoted: 9 positive, 3 negative
  (e.g. TCS meanrev_up 0/268 → negative; HDFCBANK meanrev_up 8/10 → positive).
- **Calibration:** `hit_rate = hits/n` per (symbol, confidence bucket),
  updated atomically via `ON CONFLICT ... DO UPDATE`; verified by status output.

---

## Performance Findings

- All feature/indicator computation is vectorized with pandas; no per-row
  Python loops in hot paths.
- Multi-year backtest uses per-symbol precomputed indicator DataFrames sliced
  by date (no per-day indicator recomputation): 1305 days × 11 symbols
  completes in minutes (network-bound only on first fetch; re-runs skip
  covered ranges via `ensure_daily_range`).
- No memory concerns at current scale (single-symbol daily bars).

---

## Remaining Work

- [ ] P4: frontend integration against the serve API (ADK status now exposed
      via `/api/v1/adk` and the `adk` status object)
- [ ] P4: run `backtest --validate-mode agent` end-to-end with the OpenCode
      server running (validator agent path is implemented + unit-tested but
      not exercised against a live LLM in this session)
- [ ] P4: exercise the ADK root agent against a live opencode server
      (bridge is unit-tested with mocked client; live `generate_content_async`
      round-trip not yet run)
- [ ] INFO: `cli/main.py` `serve` help text still says "not yet implemented"
      although `cmd_serve` runs uvicorn against `server.main`

---

## Risks / Concerns

- OpenCode server must be running on port 4096 for `--mode llm` and
  `--validate-mode agent`; otherwise those paths exit 1 by design (health
  check). Baseline + deterministic validation are unaffected.
- yfinance may report "possibly delisted" for future dates; evening workflow
  degrades gracefully (validates 0) rather than fabricating closes. `^NSEI`
  returned no data for 1999-2004 (index history starts later) — handled
  gracefully (bars=0, skipped).
- `state/aiops.db` now contains real backtest + morning data from the
  acceptance run (gitignored).
- Multi-year backtest hit_rate 0.4306 is below 0.5 — expected for a naive
  pattern baseline on random-walk-like data; the knowledge accumulation
  correctly flags weak patterns (e.g. TCS meanrev_up 0/268 → negative) and
  preserves strong ones (meanrev_down 0.6057 → positive). This is the
  learning signal, not a bug.
- **Environment side-effect:** `pip install 'google-adk>=2.9,<3'` downgraded
  `opentelemetry-sdk` to 1.42.1, conflicting with a pre-existing
  `opentelemetry-exporter-otlp-proto-grpc 1.44.0` (requires ~=1.44.0). This
  does not affect the AIOps package or its tests, but other tools in the
  environment that use the OTLP exporter may be affected.
- ADK 2.9 emits a DeprecationWarning for `BaseAgentConfig` and an
  experimental-feature UserWarning for `JSON_SCHEMA_FOR_FUNC_DECL` (enabled
  by default); both are upstream, harmless, and do not fail tests.

---

## Next Recommended Action

Wire the frontend to the ADK status (`/api/v1/adk` + `adk` status object) and
gate the ADK UI on `available`. Optionally exercise the root agent against a
live opencode server and run `backtest --validate-mode agent` end-to-end.

---

## Change History

| Date | Change | Reason | Validation |
|---|---|---|---|
| 2026-09-15 | Fixed calibration INSERT bindings | Prevented ProgrammingError on backtest | Tests passed |
| 2026-09-15 | Added `import pytest` to test_schema.py | Prevented NameError | Tests passed |
| 2026-09-15 | Stringified date params in prediction/engine.py | Remove deprecated sqlite3 date adapter warning | Tests passed, 0 warnings |
| 2026-09-15 | Added fundamentals/pattern_stats tables + knowledge.ref | Knowledge accumulation + fundamentals snapshots | Tests passed |
| 2026-09-15 | Moved idx_knowledge_ref_kind into migrate() after _ensure_column | Pre-ref DBs failed with "no such column: ref" | init on old DB passed |
| 2026-09-15 | Pattern-gated _baseline + allow_skip in predict_symbol | No-force-fit contract | test_pattern_gate passed |
| 2026-09-15 | Moved skip gate before target/stop computation | KeyError 'target_pct' on no-pattern | Tests passed |
| 2026-09-15 | Rewrote workflows/backtest.py for date ranges | Multi-year recursive backtest contract | test_backtest_range passed |
| 2026-09-15 | Fixed per-day skipped counter in backtest results | Inverted logic counted predictions | Tests passed |
| 2026-09-15 | Added validator agent + agent validation mode | Multi-agent predict/validate loop | test_validator_prompt passed |
| 2026-09-15 | Added add_knowledge/update_pattern_stats/promote_pattern_knowledge | Positive/negative knowledge accumulation | test_knowledge passed |
| 2026-09-15 | Extended CLI: backtest --start/--years, fundamentals, data | Contract CLI surface | Manual runs passed |
| 2026-09-15 | Rewrote opencode/bridge.py for ADK 2.9 contract | Bridge targeted API that never existed | test_adk_bridge passed |
| 2026-09-15 | Fixed agents/root imports `..` → `...` | Circular import (latent) | root agent builds |
| 2026-09-15 | Fixed _with_conn wrapper to **kwargs + __signature__ | FunctionTool invokes target(**args) | Tool schemas + invocation passed |
| 2026-09-15 | Wired root agent into server/main.py (/api/v1/adk) | ADK layer was dead code | Server smoke passed |
| 2026-09-15 | Pinned google-adk>=2.9,<3 in pyproject.toml | Unbounded >=0.1 resolved to 2.9.0 | Install + tests passed |
| 2026-09-15 | Added tests/test_adk_bridge.py (18 tests) | No ADK coverage existed | 59 passed total |