# PROJECT_MAP.md — VijayMaruthi Platform Structure Encyclopedia

> Deep-dive reference. Read this before working in the app. Companion docs:
> [FEATURES.md](./FEATURES.md) (what each feature does) · [LEDGER.md](./LEDGER.md) (ledger system).

## 1. Top-level layout

```
vijaymaruthi/
├── frontend/            # Next.js 14 app (port 3001, Turbopack, output: standalone)
├── backend/             # Dev/local FastAPI (port 8765) — NEWER, source of truth
├── vercel-backend/      # Deployed serverless copy — OLDER (check both when editing)
├── engine/              # Python analysis engine (canonical copies also at share root)
├── analysis_app/        # Deterministic analyzer (pinned snapshot + state machine; CLI + API + page)
├── sync/                # SQLite → Supabase ETL + schema SQL + launchd agents
├── cron/                # Daily scan / sync / keep-alive shell wrappers + crontab.example
├── cloud/               # GitHub Actions OHLCV sync (zero-cost cloud pipeline)
├── windows/             # Always-on Windows runner (Task Scheduler alternative)
├── aiops/               # Auto Pilot learning agent (own SQLite, own CLI, own FastAPI :8010)
├── ledger/              # LEGACY standalone Vite SPA + ledger/backend.py (unused)
├── reports/             # Local SQLite + file cache + charts (dev copies; canonical at share root)
├── tests/               # Python tests
├── testcase/            # Live-site test cases
├── docs/                # Knowledge base (this file + FEATURES.md + LEDGER.md)
├── deploy.sh            # Unified deploy (frontend + backend, env injection)
├── deploy-vercel.sh     # Frontend-only Vercel deploy (supabase mode)
├── go-live.sh           # First-time: validate env → sync → launchd → deploy
├── docker-compose.yml / Dockerfile.backend
└── package.json         # npm run dev / dev:frontend / dev:backend
```

**Two backend tracks (critical):**
| Track | Location | Status |
|---|---|---|
| Dev/local FastAPI | `backend/` | Source of truth, newer (screen_config, pending_count, detected_patterns, intraday intervals, 3 sync skip-flags) |
| Vercel serverless | `vercel-backend/` | Deployed copy, older (no screen dials, no pending_count, only `--skip-ohlcv`) |

`vercel-backend/index.py` is the serverless entry: adds `backend/` + `lib/` to `sys.path`, forces `VM_SHARE_DIR=/tmp`, `MPLBACKEND=Agg`. `vercel-backend/sync-lib.py` copies shared engine modules from the share root into `vercel-backend/lib/` before deploy. `vercel.json` = one function, 1024 MB, 60 s max.

---

## 2. Frontend (`frontend/`)

### App sections (`app/(app)/`)
| Route | Purpose |
|---|---|
| `/` | Home dashboard: scroll-paginated analysis table, filters, market strips, SpendingSnapshot widget |
| `/market` | Sectors/rotation + breadth + indices |
| `/portfolio` | LocalStorage `vm_portfolio_positions` |
| `/calculator` | P&L / free-share calculator |
| `/pilot` | Paper trading (CAPITAL=100000) |
| `/pilot/aiops` | AIOps agent status UI |
| `/charts` | Chart grid (`?layout&tickers=`) |
| `/stock/[symbol]` | Tabbed stock deep-dive |
| `/convolution` | Custom lightweight-charts view |
| `/deterministic` | Deterministic analyzer (pinned snapshot + composite state machine; local-only) |
| `/backtest` | Quantamental backtest UI |
| `/pattern-backtest` | Chart-pattern backtest UI |
| `/analytics` | Product analytics suite |
| `/ledger` | LedgerApp (Ledger & Dashboard + Tax Tracker) |
| `/admin/users`, `/admin/analytics/*` | Admin (20 sub-pages, 4 tab groups) |
| `/settings` | Screen dials (pattern screening config) |
| `/about` | About |
| `/login`, `/signup` | Auth |

### API routes (`app/api/`) — 43 routes
- **Auth**: `auth/me`, `auth/verify-invite`
- **Analysis**: `stock/[symbol]`, `ohlcv/[symbol]`, `fundamentals/[symbol]`, `dashboard`, `market`, `nse-symbols`
- **Scans**: `cron/*` (analytics rollup), `layouts`, `alerts`, `drawings`
- **Pilot**: `pilot/{start,state,refresh,close,reset,aiops/status}`
- **Ledger**: `ledger/{upload,transactions,budgets,summary,corrections}`
- **Admin**: `admin/users`, `admin/analytics/{overview,top-users,top-pages,revenue,events,funnels,journeys,visitors,campaigns,audiences,attribution,sessions,sessions/[id],realtime,ux,audit,alerts,users/[id]}`
- **Analytics**: `analytics/collect`

### Key `lib/` modules
- `api.ts` — dual-mode API client (health/analyze/analyzeBatch/getDashboard/getPortfolio/getHistory/getNseSymbols/startNseScan/startPendingNseScan/getScanProgress/getLastPrice/getOHLCV/runBacktest/patternBacktest/getFundamentals/getMarket/deterministic.*)
- `types.ts` — all API contracts (INDIAN_WATCHLIST, PatternSummary, Backtest/PatternBacktest, FundamentalsData ~60 fields, MarketResponse)
- `patterns.ts` — 2,926-line pattern engine: 10 calibrated + 7 experimental patterns, TrendLineDef/MarkerDef, ScreenConfig dials
- `candlestick-patterns.ts`, `indicators.ts`, `priceTargets.ts`, `humaniser.ts`
- `screenConfig.ts` — localStorage `vijaymaruthi.screenConfig.v1`
- `scan-context.tsx` (ScanProvider), `admin-context.tsx` (AdminProvider), `use-market.ts`
- `theme.ts` — dark-class on `<html>`, localStorage `qm-theme`
- `server-auth.ts` — shared route auth gate
- `supabase/{client,server}.ts`, `supabase.ts` — data/auth access layer
- `ledger/` — engine, categories, upi, delimited, pdf, merchant, period, db, types (see LEDGER.md)
- `uploads.ts` — Storage `user-uploads` persistence

### Conventions
- Security headers on all routes (X-Frame-Options DENY, nosniff, COOP same-origin)
- Tests: `node --import tsx --test tests/*.test.ts` (130 tests, 26 suites)
- Pure-function engines stay I/O-free for testability
- Dark-first UI: shadcn components + framer-motion + lucide icons
- RLS + service-role defense-in-depth on every ledger query (owner_id scoping)

---

## 3. Backend — FastAPI endpoints

`vercel-backend/backend/api/main.py` (1349 lines; root `backend/api/main.py` = 1410-line superset). Pydantic models in `backend/api/models.py`. Chatbot router in `backend/api/routes/chatbot_routes.py`.

### Analysis
| Endpoint | Purpose | Powered by |
|---|---|---|
| `POST /api/v1/analyze` | Single-ticker quantamental analysis | `AnalysisRunner.run_ticker` → `TechnicalAnalysisPipeline.run()` (cache-first, 6 h TTL, md5 file cache) |
| `POST /api/v1/analyze/batch` | Heatmap for multiple tickers | `AnalysisRunner.run_batch` (thread pool, 120 s timeout) + `portfolio_heatmap.py` |
| `POST /api/v1/analyze/scan-nse` | Background full-NSE scan (~2400 symbols, batches of 20) | `_run_nse_scan` → `run_batch` + `_sync_to_supabase_after_scan` |
| `POST /api/v1/analyze/scan-pending` | Scan NSE symbols not yet in DB | `_run_pending_nse_scan` |
| `GET /api/v1/analyze/scan-progress/{scan_id}` | Poll scan progress | in-memory `_scans` dict |

### Dashboard / Portfolio / History
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/dashboard` | Merged DB-trend + cache-enriched rows, 30 s cache, `health_summary`, `pending_count` (root only), `detected_patterns` (root only) |
| `GET /api/v1/portfolio` | Raw latest-per-ticker snapshot |
| `GET /api/v1/history/{ticker}` | Run history/trend |

### Backtest
| Endpoint | Purpose | Powered by |
|---|---|---|
| `POST /api/v1/backtest` | Quantamental backtest `{ticker, years, rebalance_days}` | `QuantamentalBacktester` |
| `POST /api/v1/pattern-backtest` | Chart-pattern backtest `{ticker, years, min_confidence, min_rr, trend_filter}` (+ `screen_config` root-only) | `pattern_engine.run_pattern_backtest` / `simulate_trades` / `detect_patterns` |

### Fundamentals / OHLCV / Last price (inline in main.py)
- `GET /api/v1/fundamentals/{ticker:path}` — yfinance `Ticker.info` → ~40 normalized fields + heuristic 0–100 `fundamental_score`
- `GET /api/v1/ohlcv/{ticker}` — `yf.download`, up to 500 candles (3000 root), daily + intraday ISO timestamps (root adds `1m/5m/15m/30m/1h/4h`)
- `GET /api/v1/last-price/{ticker}` — yfinance 4-tier fallback (info.currentPrice → daily close → 1 m intraday → 5 d close)

### Exports / Health / NSE symbols / Chatbot
- `GET /api/v1/export/report` — self-contained print-friendly HTML executive report (`engine/report_generator.py`)
- `GET /api/v1/health` — import checks (numpy/pandas/yfinance/scipy/matplotlib)
- `GET /api/v1/nse-symbols` — nsetools list, 1 h cache
- `POST /api/v1/chatbot/chat` — OpenAI + web search; `POST /learn`, `GET /knowledge`, `GET/DELETE /knowledge/{topic}` — file-based KB under `VM_SHARE_DIR`

### Deterministic analyzer (`analysis_app/api.py`, root only)
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/deterministic/health` | Pinned-snapshot status (date, sha, counts) |
| `GET /api/v1/deterministic/universe` | Pinned ticker list + `universe_sha` |
| `GET /api/v1/deterministic/state/{ticker}?timeline=` | Composite state (regime × setup × position) for one ticker |
| `POST /api/v1/deterministic/analyze` | Run analysis (`limit`, `as_of`, `period`, `timeline`, `persist`) |
| `GET /api/v1/deterministic/runs` | List persisted runs |
| `GET /api/v1/deterministic/runs/{run_id}` | Run manifest + ranking |
| `GET /api/v1/deterministic/runs/{run_id}/stocks/{ticker}` | One stock from a run |

Mounted optionally in `backend/api/main.py` (boots without it if the package/snapshot is absent). See `docs/DETERMINISTIC_ANALYZER.md`.

---

## 4. Python engine modules

### `engine/` (canonical copies also at share root)
| Module | Role |
|---|---|
| `technical_analysis_report.py` (~5000 lines) | Institutional-grade core: `TechnicalAnalysisPipeline` orchestrates metrics, structure, S/R, candlestick, divergence, MTF, Wyckoff/ICT, Gann, options, fundamentals, sentiment, weighted convolution (`conv_technical`/`conv_fundamental`), quantamental 50/50 blend, `_classify_signal` (entry/targets/stop), ChartGenerator, ReportBuilder, FundamentalAnalyzer, CLI. **Decision logic now delegates to `engine/rules/`** (see below); emits `analysis['rule_trace']`. |
| `rules/` | Code-defined market-analysis rule engine — the single source of truth for signal classification, both convolutions, quality gates, quantamental fusion and pattern gating. See `docs/RULE_ENGINE.md`. |
| `sentiment_analyzer.py` | Third fusion pillar: yfinance news scored by VADER (+ keyword lexicon) → −1…+1 with time decay |
| `quantamental_backtester.py` | Lookahead-free historical validation (point-in-time OHLCV via `df_override`), fwd returns/MAE, per-rating-bucket stats; `UniverseRunner` CLI |
| `analysis_db.py` | SQLite persistence (`analysis_runs` + `metadata`, WAL, migrations) |
| `analysis_health.py` | v3 scan-quality gate: `compute_health()` → checks {price_ok, sma_ok, atr_ok, adx_ok, div_sane, debt_sane, nan_ok}, `health_pass`, quality gates |
| `run_latest_analysis.py` | CLI re-run of the whole NSE scan for the day (batches of 20, resumable) |

### `backend/engine/` + `vercel-backend/backend/engine/` (API wiring)
| Module | Role |
|---|---|
| `runner.py` | `AnalysisRunner`: thread-pool async bridge (run_ticker, run_batch, run_backtest, get_portfolio, get_ticker_history, `_sanitize`) |
| `pattern_engine.py` | Python port of TS pattern engine: swing detection, 17+ detectors (H&S, double/triple, flags, wedges, triangles, cup-handle, rounding, island reversal), `simulate_trades`, `run_pattern_backtest`, root-only `ScreenConfig` dials |
| `report_generator.py` | Executive HTML report (inline CSS, SVG donut, rating-bucket sorting) |

### `vercel-backend/lib/` (deploy copies from share root)
- `nse_hs_scanner.py` — strict NSE head-&-shoulders scanner (8 validation rules)
- `backtest_hs_full.py` — full H&S success/failure backtest
- `pattern_validator.py` — full-spectrum multi-pattern validator (daily/weekly/monthly, all NSE)
- `portfolio_heatmap.py` — multi-symbol batch heatmap helper
- Copies of `analysis_db.py`, `analysis_health.py`, `technical_analysis_report.py`, `quantamental_backtester.py`, `sentiment_analyzer.py`

### `backend/scripts/` (pattern calibration tooling)
- `calibrate_reliability.py`, `collect_trade_dataset.py` (+ `trade_dataset.jsonl`, `reliability_calibration.json`)
- Symmetrical-triangle quartet: `symtri_{bullish_validate,diagnostics,target_sweep,walkforward}.py`
- `snapshot_golden.py` — regenerate the 18 golden-master snapshots (`backend/tests/golden/`) for the rule engine.

### `scripts/` (repo tooling)
- `sync_engine.py` — propagate the canonical engine + `rules/` package to the deploy copies (share root, `vercel-backend/lib`, `pi-bundle`) with sha256 + import verification. Flags: `--dry-run`, `--check`.

### `analysis_app/` (deterministic analyzer — new top-level package)
| Module | Role |
|---|---|
| `determinism.py` | `canonical_json`, `sha256_*`, frozen `Clock`, `derive_run_id`, `BUILDER_VERSION` |
| `datasource.py` | `PinnedDataSource` (reader) + `build_snapshot` + providers (`yfinance_ohlcv`, `csv_dir_ohlcv`, `reports_fundamentals`, `derive_info`) |
| `indicators.py` | Self-contained pure `sma`, Wilder `atr`/`adx` |
| `state_machine.py` | `RegimeEngine` + setup/position classification + `position_timeline` (composite state) |
| `analyzer.py` | `analyze_ticker` / `analyze_universe` (pinned pipeline + state machine) |
| `report.py` | `write_run` / `verify_run` (manifest, stocks, ranking/states CSV, HTML, `run.sha256`) |
| `cli.py` | `freeze` / `analyze` / `verify` / `report` (`python -m analysis_app`) |
| `api.py` | FastAPI router `/api/v1/deterministic/*` |
| `snapshot/` | Pinned snapshot (`universe.json`, `snapshot.db`, `manifest.json`) |
| `runs/` | Run artifacts (gitignored) |
| `tests/` | 22 determinism + state-machine + end-to-end tests |

See `docs/DETERMINISTIC_ANALYZER.md`. Not propagated by `sync_engine.py` (new package); the engine seams it uses (`now=`, `fundamental_analyzer_cls=`) are part of the canonical engine and do propagate.

---

## 5. Sync / cron / cloud / windows / deploy

### `sync/` (local SQLite → Supabase "free cloud" pipeline)
- `sync_to_supabase.py` (46 KB, key ETL) — reads `analysis_history.db`, upserts `portfolio_snapshot` (one row/ticker incl. Auto-Pilot entry/target/stop + health_pass), `sync_meta`, `ohlcv` (5 y candle JSON), `ohlcv_intraday` (6 intervals), `fundamentals` (from `reports/*_data.json`). Flags: `--dry-run`, `--ohlcv-only/--skip-ohlcv`, `--intraday-only/--skip-intraday`, `--skip-fundamentals`, `--limit`.
- `download_uploads.py` — pulls `user-uploads` Storage objects to local `uploads/` (15-min launchd job)
- `apply_schema_fix.py` — DDL migrations via Management API (`SUPABASE_ACCESS_TOKEN`) or direct Postgres fallback
- `seed_analytics.py` — ~30 days of demo analytics traffic through the real ingest route
- Schema SQL: `supabase_schema.sql`, `chart_schema.sql`/`v2`/`v3`, `auth_schema_v2.sql` (profiles), `analytics_schema.sql`, `auto_pilot_schema.sql`, `ledger_schema.sql` (legacy)
- launchd: `com.vijaymaruthi.supabase-sync.plist` (daily 18:45 IST), `com.vijaymaruthi.upload-sync.plist` (every 15 min)

### `cron/`
- `run_daily_analysis.sh` — wraps `run_latest_analysis.py`, optional `SYNC_AFTER=1`
- `run_supabase_sync.sh` — wraps `sync_to_supabase.py`, always exits 0 (cron-friendly)
- `keep_alive.sh` — port-watch restart of backend:8765 + frontend:3001
- `crontab.example` — canonical schedule (15:30/18:45 sync, 19:30 daily analysis, 5-min keep-alive, 6-hourly Vercel health ping, optional aiops morning/evening)

### `cloud/`
- `sync_cloud_prices.py` — OHLCV sync rewritten for GitHub Actions (`cloud-sync.yml`, daily 10:00 UTC): reads tickers from `portfolio_snapshot`, downloads 5 y candles, upserts `ohlcv`, records `sync_meta`. Zero cost. Flags: `--limit/--workers/--dry-run/--only`.

### `windows/` (always-on Windows runner)
- `setup_windows.ps1` (venv + deps + credentials + dry-run), `register_tasks.ps1` (Task Scheduler: CloudSync daily 15:30, DailyAnalysis weekdays 19:30, wake-to-run), `run_backtest.bat` (8–12 h resumable full-universe quant backtest via `make_universe.py` → `nse_universe.txt`), `run_cloud_sync.bat`, `run_daily_analysis.bat`, `README_WINDOWS.md`

### Deploy
- `go-live.sh` — validates `sync/.env`, first Supabase sync, installs launchd daily job, calls `deploy-vercel.sh`
- `deploy-vercel.sh` — frontend-only Vercel deploy (env: `NEXT_PUBLIC_DATA_MODE=supabase`, `APP_TOKEN`/`NEXT_PUBLIC_APP_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- `deploy.sh` — unified deploy (pre-flight, optional git commit/`--sync`, tsc+build verify, frontend env incl. `CRON_SECRET`, backend env `VM_SHARE_DIR=/tmp`, `CACHE_TTL_HOURS`, `DASHBOARD_CACHE_TTL`, `CORS_ORIGINS`, then health + page verification)

---

## 6. AIOps — Auto Pilot learning agent (`aiops/`)

Standalone additive Python package, **separate from the analysis engine** (own SQLite `state/aiops.db`, own CLI, own config). NSE AI market-intelligence **continuous-learning loop** using **OpenCode LLM over HTTP** (`opencode serve`, port 4096) with **deterministic Python validation** (LLM proposes direction/confidence; Python computes prices/validates; lessons proposed→accepted/rejected; no future leakage via `available_at`; market_daily + locked predictions immutable via triggers; idempotent runs).

Structure:
- `cli/main.py` — init/status/morning/evening/backtest/lessons/validate/serve
- `clock.py` (IST temporal standard), `config.py` (env overrides, default 11 NSE symbols)
- `db/` (engine.py + schema.sql), `market/` (fetch, features, indicators, regime)
- `prediction/` (engine, store), `learning/` (bm25, knowledge, lessons, recipes)
- `validation/engine.py`, `workflows/` (morning/evening/backtest/runs)
- `opencode/` (client, agent, bridge, parser — ADK bridge for web UI)
- `server/main.py` — FastAPI on `:8010` consumed via frontend `/api/pilot/aiops/status` proxy
- 15+ tests in `aiops/tests/`

---

## 7. Data layer

### Four stores
1. **Local analysis store**: `reports/analysis_history.db` (canonical at share root; dev copies near-empty). Tables `analysis_runs` (ticker, run_timestamp, period, price, tech_signal/confidence/score, fund_score/rating, screening/risk/moat/analyst ratings, qm_rating/qm_score, weights, cap_category, weight_adjustments, divergence, sentiment_score, evidence JSON, v3 health fields, **Auto-Pilot trade levels entry_low/entry_high/target1-3/stop_loss**, schema_version, pipeline_version; unique per (ticker, run_timestamp)) + `metadata`.
2. **File cache + charts**: `reports/cache/` ≈ 2593 md5-hashed JSON (6 h TTL), `reports/charts/` ≈ 2601 PNG, ~2700 `*_data.json` + `*_report.txt` per ticker.
3. **AIOps store**: `aiops/state/aiops.db` (24 MB, 13 tables: meta, symbols, market_daily (immutable), daily_runs (idempotent UNIQUE(run_type,run_date)), agent_runs, predictions (immutable once locked), validation, lessons, recipes, feedback, calibration, knowledge, fundamentals, pattern_stats).
4. **Supabase (deployed)**: Postgres via PostgREST/service_role. Tables: `portfolio_snapshot` (+ real-engine trade-level columns, RLS service_role-only), `sync_meta`, `ohlcv` (jsonb candles PK ticker), `ohlcv_intraday` (PK ticker+interval), `fundamentals` (jsonb), `profiles` (auth approval), analytics suite (`analytics_events/sessions/identity/daily/funnels/audiences/alerts/alert_events/blocklist`, admin-only), `auto_pilot_state`/`auto_pilot_trades` (owner-scoped paper trading), legacy ledger tables. Storage bucket `user-uploads` (path `{userId}/{ts}_{source}_{filename}`).

### Credentials (never commit)
- `sync/.env` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `SUPABASE_ACCESS_TOKEN`, generated `CRON_SECRET`
- `sync/.app_token` — deploy `APP_TOKEN`
- `frontend/.env.local` — `NEXT_PUBLIC_*` vars
- Backend env optional: `VM_SHARE_DIR`, `CACHE_TTL_HOURS`, `DASHBOARD_CACHE_TTL`, `CORS_ORIGINS`, `SCAN_WORKERS`, `TICKER_TIMEOUT_SECONDS`, `BATCH_TIMEOUT_SECONDS`
- GitHub Actions consumes the same two secrets; Windows copies `sync/.env`

### Key flows
- **Engine → SQLite**: pipeline `do_db=True` → `AnalysisDatabase.save_run` per ticker
- **SQLite → Supabase**: `sync_to_supabase.py` upserts snapshot/ohlcv/intraday/fundamentals; scan completion triggers it in-process; cron/launchd/GitHub Actions/windows tasks run it on schedule
- **Frontend → data**: Vercel Next.js server proxies read Supabase with service_role (browser never sees keys); dev mode reads local `:8765` FastAPI directly

---

## 8. Auth model (frontend)

- Signup is **invite-only**: `INVITE_CODE` (server-only) verified by `/api/auth/verify-invite` (constant-time compare + 300 ms delay + per-IP rate limit 20/10 min)
- Login via Supabase `signInWithPassword` (browser anon client, `lib/supabase/client.ts`)
- Every API route authenticates through `lib/server-auth.ts` `authenticate()`: (1) valid Supabase session AND `profiles.approved === true`, OR (2) shared `APP_TOKEN` via `?token=` (external monitoring/scripts only). Missing `profiles` table → 503 hinting `sync/auth_schema_v2.sql`
- `/api/auth/me` returns `{ id, email, role, approved }` — gates admin-only UI; **first signup auto-becomes admin**
- Supabase clients: `lib/supabase/server.ts` (SSR + service-role), `lib/supabase/client.ts` (anon browser), `lib/supabase.ts` (raw PostgREST with service-role — server-only)

---

## 9. Legacy / dead code (do not extend)

- `ledger/` — old standalone Vite SPA + `ledger/backend.py` (FastAPI CSV/Excel classifier) + local JSON stores. **Unused**; live ledger is the Next.js route + TS engine.
- `sync/ledger_schema.sql` — legacy per-user spending schema, not actively synced.
- `frontend/scripts/ledger-db-live-test.ts`, `ledger-engine-test.ts` — legacy test harnesses (kept for reference).
- Python ledger backend was deleted in Phase 4 (2026) — do not resurrect.