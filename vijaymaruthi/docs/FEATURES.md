# FEATURES.md — VijayMaruthi Feature Encyclopedia

> What each product area does and what powers it. Companion docs:
> [PROJECT_MAP.md](./PROJECT_MAP.md) (structure) · [LEDGER.md](./LEDGER.md) (ledger system).

---

## 1. Stock Analysis (core)

**What it is:** Institutional-grade quantamental analysis for NSE/BSE stocks — technical + fundamental + sentiment fused into a single weighted signal.

**User flow:** `/stock/[symbol]` deep-dive → `POST /api/v1/analyze` → `AnalysisRunner.run_ticker` → `TechnicalAnalysisPipeline.run()`.

**What the pipeline produces (per ticker):**
- **Technical**: metrics (SMA/EMA/RSI/MACD/ATR/ADX/Bollinger/Stochastic), market structure, support/resistance levels, candlestick patterns, divergence detection, multi-timeframe analysis, Wyckoff/ICT analysis, Gann cycles, options strategy hints
- **Fundamental**: business economics, financial statements, valuation (P/E, P/B, EV/EBITDA, DCF), moat, ROIC/ROE/ROCE, earnings quality, FCF
- **Sentiment**: yfinance news scored by VADER → −1…+1 with time decay
- **Fusion**: weighted convolution (`conv_technical` / `conv_fundamental`, since 2026-09-05) → quantamental 50/50 blend → `_classify_signal` emits entry zone / targets / stop-loss. All of these decisions are computed by the code-defined **rule engine** (`engine/rules/`, see `docs/RULE_ENGINE.md`) and exposed as `analysis['rule_trace']`.
- **Health gate**: `analysis_health.py` v3 checks (price_ok, sma_ok, atr_ok, adx_ok, div_sane, debt_sane, nan_ok) → `health_pass`
- **Outputs**: JSON response (cached 6 h TTL), PNG chart (`reports/charts/`), text report (`reports/*_report.txt`), HTML executive report (`/export/report`)

**Powers:** home dashboard table, stock deep-dive tabs, heatmap batch, NSE scans, backtests.

---

## 2. NSE Scanning

**What it is:** Background full-market scans that keep the portfolio DB fresh.

- `POST /api/v1/analyze/scan-nse` — full NSE scan (~2400 symbols, batches of 20, force=True), then auto-syncs to Supabase
- `POST /api/v1/analyze/scan-pending` — scans only symbols not yet in DB
- `GET /api/v1/analyze/scan-progress/{scan_id}` — polling endpoint
- Daily automation: `cron/run_daily_analysis.sh` (19:30 IST) → `engine/run_latest_analysis.py` (resumable, saves to DB + charts + reports)
- Windows alternative: `windows/run_daily_analysis.bat` via Task Scheduler

---

## 3. Dashboard & Portfolio

- **`/` home dashboard**: scroll-paginated analysis table with filters, market strips, SpendingSnapshot widget (ledger)
- **`/market`**: sectors/rotation + breadth + indices
- **`/portfolio`**: localStorage `vm_portfolio_positions` watchlist
- **`GET /api/v1/dashboard`**: merged DB-trend + cache-enriched rows, 30 s cache, `health_summary`, `pending_count`, `detected_patterns` (pattern votes geometry summary)
- **`GET /api/v1/portfolio`**: raw latest-per-ticker snapshot from `analysis_runs`

---

## 4. Charting

- **`/charts`**: chart grid (`?layout&tickers=`) — lightweight-charts
- **`/convolution`**: custom convolution view (pattern votes visualization)
- **`/stock/[symbol]`**: tabbed deep-dive with charts
- **`/drawings`** API: user chart drawings persistence
- **`/layouts`** API: saved chart layouts

---

## 5. Pattern Engine

**What it is:** Chart-pattern detection + backtesting with calibrated reliability.

- **Frontend**: `lib/patterns.ts` (2,926 lines) — 10 calibrated + 7 experimental patterns, TrendLineDef/MarkerDef, ScreenConfig dials
- **Backend**: `pattern_engine.py` — Python port: swing detection, 17+ detectors (H&S, double/triple tops/bottoms, flags, wedges, triangles, cup-handle, rounding, island reversal), `detect_patterns`, `simulate_trades` (SL/TP/breakeven), `run_pattern_backtest`
- **`/pattern-backtest`**: UI for `POST /api/v1/pattern-backtest` `{ticker, years, min_confidence, min_rr, trend_filter}` (+ `screen_config` dials)
- **Calibration tooling**: `backend/scripts/` — `calibrate_reliability.py`, `collect_trade_dataset.py`, `symtri_*` quartet
- **Research scanners**: `nse_hs_scanner.py` (strict H&S, 8 validation rules), `backtest_hs_full.py`, `pattern_validator.py` (full-spectrum daily/weekly/monthly)

---

## 5b. Deterministic Analyzer (`analysis_app/`)

**What it is:** A fully deterministic analysis application — the rule engine + a composite state machine over a **pinned snapshot**, producing byte-identical outputs for identical inputs.

- **Determinism**: pinned OHLCV/fundamentals snapshot (`snapshot.db`), frozen `Clock`, injected `fundamental_analyzer_cls`, canonical JSON hashing; `run.sha256` + `verify_run` prove reproducibility
- **State machine**: composite **regime × setup × position** per stock (`trend_up`/`trend_down`/`range`/`high_volatility`; `none`→`watch`→`armed`→`triggered`/`invalidated`; `flat`→`entered`→`managing`→`target_hit`/`stopped`), plus a per-bar position timeline
- **CLI**: `python -m analysis_app freeze|analyze|verify|report` (`freeze` is the only network step)
- **API**: `/api/v1/deterministic/*` (health, universe, state, analyze, runs) — mounted optionally in `backend/api/main.py`
- **Frontend**: `/deterministic` page (nav: Deterministic Analyzer) — local-only (snapshot lives on the backend machine)
- **Tests**: `python -m pytest analysis_app/tests -q` (22 tests: determinism, state machine, end-to-end byte-identical artifacts + tamper detection)
- **Docs**: `docs/DETERMINISTIC_ANALYZER.md`

---

## 6. Backtesting

- **Quantamental backtest**: `POST /api/v1/backtest` `{ticker, years, rebalance_days}` → `QuantamentalBacktester` — lookahead-free historical validation (point-in-time OHLCV via `df_override`), fwd returns/MAE, per-rating-bucket stats
- **Pattern backtest**: see §5
- **Full-universe**: `windows/run_backtest.bat` → `make_universe.py` → `nse_universe.txt` (8–12 h resumable)

---

## 7. Paper Trading — Pilot + AIOps

**What it is:** Paper trading with a learning AI agent.

- **Pilot**: `/pilot` — paper trading with CAPITAL=100000; API `pilot/{start,state,refresh,close,reset}`; trade levels (entry_low/entry_high/target1-3/stop_loss) stored in `analysis_runs` and synced to `auto_pilot_state`/`auto_pilot_trades`
- **AIOps agent**: `/pilot/aiops` + `aiops/` package — continuous-learning loop: OpenCode LLM over HTTP (port 4096) proposes direction/confidence; deterministic Python validates (prices, no future leakage via `available_at`); lessons proposed→accepted/rejected; immutable market_daily + locked predictions; idempotent runs. CLI: `aiops/cli/main.py` (init/status/morning/evening/backtest/lessons/validate/serve). FastAPI on `:8010` consumed via `/api/pilot/aiops/status`

---

## 8. Fundamentals & OHLCV

- `GET /api/v1/fundamentals/{ticker}` — yfinance `Ticker.info` → ~40 normalized fields + heuristic 0–100 `fundamental_score`
- `GET /api/v1/ohlcv/{ticker}` — `yf.download`, up to 500 candles (3000 root), daily + intraday ISO timestamps (root adds `1m/5m/15m/30m/1h/4h`)
- `GET /api/v1/last-price/{ticker}` — 4-tier fallback (info.currentPrice → daily close → 1 m intraday → 5 d close)
- Frontend: `lib/api.ts` getOHLCV/getFundamentals; `lib/types.ts` FundamentalsData (~60 fields)

---

## 9. Calculator

- **`/calculator`**: P&L calculator + free-share calculator (bonus/split math)

---

## 10. Analytics Product Suite

**What it is:** Full product analytics (admin-only) — event collection + admin dashboards.

- **Ingest**: `POST /api/analytics/collect` (frontend event collection)
- **Rollup**: `cron/analytics-rollup` (daily aggregation)
- **Admin UI**: `/admin/analytics/*` — 20 sub-pages, 4 tab groups: overview, top-users, top-pages, revenue, events, funnels, journeys, visitors, campaigns, audiences, attribution, sessions (+ per-session), realtime, ux, audit, alerts, users/[id]
- **Schema**: `analytics_events/sessions/identity/daily/funnels/audiences/alerts/alert_events/blocklist`
- **Seed**: `sync/seed_analytics.py` (~30 days demo traffic)

---

## 11. Ledger (Personal Financial Ledger)

**What it is:** Bank-statement import → categorization → budgeting → tax tracking. Fully TypeScript (backend deleted in Phase 4).

- **Import**: `POST /api/ledger/upload` — .xlsx/.xls/.xlsm/.xlsb/.csv/.txt/.pdf from any Indian retail bank, credit card, or UPI app (PhonePe/GPay/Paytm)
- **Parsing**: `frontend/lib/ledger/engine.ts` — bank-agnostic (UPI, delimited tab/semicolon/pipe, fixed-width, Dr/Cr indicator, PDF via pdfjs-dist); balance-continuity self-check; `looksLikeDate` guard
- **Categorization**: 11 categories, keyword rules, learned per-user corrections (similarity ≥0.65), personal-transfer heuristic
- **Dedup**: two-tier (exact + normalized) so re-uploads never duplicate
- **UI**: `/ledger` → LedgerApp — Ledger & Dashboard + Indian Tax exemption & Rebate Tracker (TaxTracker); KPI cards, charts, budgets, insights, spending report, transaction drawer
- **API**: `ledger/{upload,transactions,budgets,summary,corrections}`
- **Storage**: Supabase `ledger_transactions`/`ledger_budgets`/`ledger_corrections` (owner-scoped RLS) + Storage `user-uploads`
- **Deep-dive**: see [LEDGER.md](./LEDGER.md)

---

## 12. Admin & Auth

- **Auth**: invite-only signup (`INVITE_CODE`), Supabase password login, `profiles.approved` gating, shared `APP_TOKEN` for external scripts; first signup auto-becomes admin
- **Admin users**: `/admin/users` — approve/deny users
- **Admin analytics**: see §10

---

## 13. Chatbot (Knowledge Assistant)

- `POST /api/v1/chatbot/chat` — OpenAI (`OPENAI_API_KEY`/`OPENAI_BASE_URL`) + web search (`SEARCH_API_KEY`)
- `POST /api/v1/chatbot/learn` — add knowledge
- `GET /api/v1/chatbot/knowledge`, `GET/DELETE /api/v1/chatbot/knowledge/{topic}` — file-based KB under `VM_SHARE_DIR`

---

## 14. Automation & Deployment

- **Daily NSE scan**: `cron/run_daily_analysis.sh` (19:30 IST) + Windows Task Scheduler alternative
- **SQLite → Supabase sync**: `sync/sync_to_supabase.py` (daily 18:45 IST launchd; flags: `--dry-run`, `--skip-ohlcv`, `--intraday-only`, `--skip-fundamentals`)
- **Cloud OHLCV sync**: `cloud/sync_cloud_prices.py` via GitHub Actions `cloud-sync.yml` (daily 10:00 UTC, zero cost)
- **Upload sync**: `sync/download_uploads.py` (every 15 min launchd)
- **Keep-alive**: `cron/keep_alive.sh` (5-min port watch)
- **Deploy**: `deploy.sh` (unified), `deploy-vercel.sh` (frontend-only), `go-live.sh` (first-time setup)

---

## 15. Stories (separate workspace)

`/Users/vijaykumar/projecs /opencode/stories` — children's story collection (ages 2–18) with metadata index. Not part of the platform app; managed by the storyteller skill/agent.