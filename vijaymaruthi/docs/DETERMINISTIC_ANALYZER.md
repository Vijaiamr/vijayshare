# Deterministic Analyzer (`analysis_app/`)

A fully deterministic stock-analysis application that combines the existing
**rule engine** (`engine/rules/`) with a new **composite state machine**
(regime × setup × position) over a **pinned full-NSE snapshot**.

> **Contract:** identical snapshot + identical config + identical as-of date ⇒
> byte-identical outputs (verified by SHA-256).

---

## Why

The production engine is *pure given fixed inputs*, but its inputs are not
fixed: OHLCV comes from live `yfinance`, fundamentals from live calls, and a few
code paths read the wall clock (`datetime.now()`). That makes results
irreproducible run-to-run. `analysis_app` removes every source of
non-determinism:

| Source | Fix |
|---|---|
| Live OHLCV (`yf.download`) | Pinned snapshot (`snapshot.db`), read via `df_override` |
| Live fundamentals | Injected `fundamental_analyzer_cls` reading the snapshot |
| Wall clock (`datetime.now()`) | Frozen `Clock` injected via the engine's `now=` seam |
| Dict/set ordering | Canonical JSON (`sort_keys`, stable floats) everywhere |
| SQLite page layout | `snapshot_sha` hashes *logical* rows, not the file |

---

## Package layout

```
analysis_app/
├── __init__.py          # __version__
├── __main__.py          # python -m analysis_app
├── determinism.py       # canonical_json, sha256_*, frozen Clock, derive_run_id
├── datasource.py        # PinnedDataSource (reader) + build_snapshot + providers
├── indicators.py        # sma, Wilder atr/adx (self-contained, pure)
├── state_machine.py     # RegimeEngine + setup/position + timeline
├── analyzer.py          # analyze_ticker / analyze_universe
├── report.py            # write_run / verify_run (artifacts + run hash)
├── cli.py               # freeze / analyze / verify / report
├── api.py               # FastAPI router (/api/v1/deterministic/*)
├── snapshot/            # pinned snapshot (universe.json, snapshot.db, manifest.json)
├── runs/                # run artifacts (gitignored)
└── tests/               # 22 determinism + state-machine + e2e tests
```

---

## Data flow

```
freeze (network, once)          analyze (offline, repeatable)
─────────────────────           ─────────────────────────────
universe ─┐                     PinnedDataSource ─┐
OHLCV ────┼─► snapshot.db       frozen Clock ─────┼─► TechnicalAnalysisPipeline
fundamentals ┘  + universe.json  AnalyzeConfig ───┘        (df_override,
                + manifest.json                            injected analyzer,
                                                           now=clock)
                                        │
                                        ▼
                              result + analysis['rule_trace']
                                        │
                              state_machine.analyze_state
                                        │
                                        ▼
                              StockAnalysis ─► report.write_run
                                                   │
                                                   ▼
                              manifest.json, stocks/*.json, ranking.csv,
                              states.csv, report.html, run.sha256
```

---

## State machine

Three layered finite-state machines per stock (`state_machine.py`):

**Regime** — `trend_up` / `trend_down` / `range` / `high_volatility`
(same recipe as `aiops.market.regime`): ATR% > 3 → high vol; else SMA20/50
slope + ADX ≥ 20; with a <50-bar fallback.

**Setup** — `none` → `watch` → `armed` → `triggered`, plus `invalidated`.
Driven by the pattern lifecycle already computed by the pattern engine
(`forming` / `active` / `completed` / `failed`), read from
`conv_technical['pattern_votes']['geometry']` (no re-detection).

**Position** — `flat` → `entered` → `managing` → `target_hit` / `stopped`.
Derived from the pattern's entry/stop/target and the price path, first-hit-wins
with the **stop checked before the target within a bar** (mirrors
`pattern_engine._calc_status`).

`position_timeline()` walks bars from the pattern's formation end in O(bars)
over precomputed arrays — it does **not** call `simulate_trades` (which
re-detects patterns per window and is too slow for a full-universe scan).

---

## Determinism guarantees

- **Pinned snapshot** — `snapshot.db` + `universe.json` + `manifest.json`.
  `snapshot_sha` = SHA-256 of all logical rows (order- and layout-independent).
- **Frozen clock** — `Clock.at(date)`; the engine's `now=` seam replaces every
  `datetime.now()` on the analysis path.
- **Injected fundamentals** — `make_pinned_analyzer(ds)` returns a
  `FundamentalAnalyzer`-compatible class reading the snapshot; `marketCap` is
  derived offline from `section_12_valuation.market_cap`.
- **Canonical hashing** — `canonical_json` (sorted keys, stable floats) feeds
  `sha256_*`; `run_id` = `derive_run_id(effective_universe_sha, snapshot_sha,
  config_sha, as_of)`. `effective_universe_sha` hashes the tickers *actually
  analyzed* (i.e. after `--limit`), so a limited run and a full run never
  collide on the same id. For a full run it equals the snapshot `universe_sha`.
- **Run hash** — `run.sha256` covers `stocks/*.json`, `ranking.csv`,
  `states.csv`, `report.html` (excludes `manifest.json` and `run.sha256`).
  `verify_run` recomputes and compares.

---

## CLI

```bash
# 1. Freeze a snapshot (the only network step)
python -m analysis_app freeze \
  --universe-file universe.txt \
  --ohlcv-source yfinance \
  --reports-dir ../reports \
  --snapshot-date 2026-09-30 \
  --out analysis_app/snapshot

# Offline freeze from cached CSVs (used by tests)
python -m analysis_app freeze --universe-file u.txt \
  --ohlcv-source csv-dir --csv-dir backend/tests/fixtures/ohlcv \
  --snapshot-date 2026-09-30 --out /tmp/snap

# 2. Analyze (offline, repeatable)
python -m analysis_app analyze --snapshot analysis_app/snapshot \
  --out analysis_app/runs/<id> --timeline

# 3. Verify reproducibility
python -m analysis_app verify --run analysis_app/runs/<id>
```

Universe sources: `--universe-file` (JSON list or newline text),
`--from-reports DIR` (derive from `reports/*_data.json`), `--nse` (fetch NSE
`EQUITY_L.csv`).

---

## API

Mounted in `backend/api/main.py` as `/api/v1/deterministic/*` (optional — the
API boots without it if the package/snapshot is absent):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | snapshot status (date, sha, counts) |
| GET | `/universe` | pinned ticker list + `universe_sha` |
| GET | `/state/{ticker}?timeline=` | composite state for one ticker |
| POST | `/analyze` | run analysis (`limit`, `as_of`, `period`, `timeline`, `persist`) |
| GET | `/runs` | list persisted runs |
| GET | `/runs/{run_id}` | manifest + ranking |
| GET | `/runs/{run_id}/stocks/{ticker}` | one stock from a run |

Env: `ANALYSIS_APP_SNAPSHOT`, `ANALYSIS_APP_RUNS` (default to the package dirs).

---

## Frontend

- Page: `frontend/app/(app)/deterministic/page.tsx` (nav: **Deterministic Analyzer**).
- Client: `api.deterministic.*` in `frontend/lib/api.ts`; types in `lib/types.ts`.
- **Local-only** — the snapshot lives on the machine running FastAPI, so the
  page is unavailable in `supabase` data mode.

---

## Testing

```bash
python -m pytest analysis_app/tests -q     # 23 tests
```

Covers: canonical hashing, frozen clock, `derive_run_id`; regime/setup/position
classification and timeline first-hit-wins; run-identity sensitivity to
`--limit`; and end-to-end freeze → analyze → verify with byte-identical
artifacts + tamper detection.

---

## Real full-NSE run (2026-10-14)

Pinned snapshot built from `reports/*_data.json` (fundamentals) + yfinance OHLCV:

| | |
|---|---|
| Tickers | 2,696 |
| OHLCV rows | 1,651,860 |
| Fundamentals | 2,696 |
| `snapshot_sha` | `e56494f10db7…` |
| `universe_sha` | `0cde271b5721…` |

`python -m analysis_app analyze --snapshot analysis_app/snapshot` (~48 s):

| | |
|---|---|
| `run_id` | `49e68a4f3ab5178a` |
| Analyzed / errors | 2,432 / 264 (all "insufficient data", < 60 rows) |
| `run_sha256` | `7d99a45470d6…` (identical across repeated runs) |

Signal mix: 2,387 HOLD · 20 SELL · 16 AVOID · 9 BUY. Regime mix: 1,937
high_volatility · 333 trend_down · 100 trend_up · 62 range.

---

## Propagation

`analysis_app/` is a **new top-level package** and is *not* copied by
`scripts/sync_engine.py` (which propagates only `technical_analysis_report.py`
+ `rules/`). The engine seams it depends on (`now=`, `fundamental_analyzer_cls=`)
*are* part of the canonical engine and therefore propagate to the three deploy
copies.

---

## Out of scope / limitations

- Simulator rules (R4–R11, F-1, volatility sizing) are not part of the state
  machine (phase 2).
- The snapshot is local; there is no deployed (Vercel) path.
- `freeze` is the only network-touching command; `analyze`/`verify` are offline.
