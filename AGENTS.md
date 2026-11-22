# AGENTS.md — Workspace Knowledge Base

Auto-loaded every session. This is the entry point to the project brain.

## Workspace layout

```
/Users/vijaykumar/projecs /opencode/share/
├── AGENTS.md          ← this file (auto-loaded)
├── vijaymaruthi/      ← MAIN APP: VijayMaruthi Wealth Management platform
│   └── docs/          ← deep-dive knowledge base (see below)
└── stories/           ← children's story collection (ages 2-18, metadata index)
```

## The main application: `vijaymaruthi/`

VijayMaruthi Wealth Management platform — NSE/BSE stock analysis (technical + fundamental + quantamental), pattern/quant backtesting, paper trading (Pilot + AIOps learning agent), personal financial ledger (bank-statement import), and a full analytics product suite.

**Read these before working in the app:**
1. `vijaymaruthi/docs/PROJECT_MAP.md` — full folder/route/endpoint/module/data-layer map
2. `vijaymaruthi/docs/FEATURES.md` — feature encyclopedia (what each area does + what powers it)
3. `vijaymaruthi/docs/LEDGER.md` — ledger system deep-dive (parsing, dedup, categorization, API, tests)

## Critical rules (always)

- **The repo path contains a literal space**: `/Users/vijaykumar/projecs /opencode/share/vijaymaruthi`. Always quote paths in shell commands; never `cd` without quotes.
- **Never commit or expose secrets**: `frontend/.env.local`, `sync/.env`, `sync/.app_token`, `vercel-backend/.env*`. Docs must never contain real keys.
- **Dual data modes** (`NEXT_PUBLIC_DATA_MODE` in frontend env):
  - `local` (default dev): frontend `:3001` talks to FastAPI `http://localhost:8765/api/v1` directly.
  - `supabase` (deployed): same-origin `/api/*` Next.js proxy routes read Supabase with service-role key (browser never sees keys).
- **Two backend tracks**: `backend/` (dev/local FastAPI, newer, source of truth) vs `vercel-backend/` (deployed serverless copy, older). When editing backend code, check both.
- **Ledger backend is TypeScript-only now**: the Python ledger backend was deleted (Phase 4). The live ledger is `frontend/app/api/ledger/*` + `frontend/lib/ledger/*`. The old standalone `ledger/` Vite SPA + `ledger/backend.py` still exist but are legacy/unused.
- **Pure-function engines stay I/O-free** for testability (e.g. `frontend/lib/ledger/engine.ts`).

## Key commands (run from `vijaymaruthi/`)

| Task | Command |
|---|---|
| Dev (both services) | `npm run dev` → frontend `:3001`, backend `:8765` |
| Frontend only | `npm run dev:frontend` |
| Backend only | `npm run dev:backend` |
| Frontend tests | `cd frontend && npm test` (`node --import tsx --test tests/*.test.ts`) |
| TypeScript check | `cd frontend && npx tsc --noEmit` |
| Deploy Vercel | `./deploy-vercel.sh` (frontend, supabase mode) |
| Full deploy | `./deploy.sh` |
| Daily NSE scan | `cron/run_daily_analysis.sh` (wraps `engine/run_latest_analysis.py`) |
| Sync SQLite → Supabase | `sync/sync_to_supabase.py` (flags: `--dry-run`, `--skip-ohlcv`, `--intraday-only`, `--skip-fundamentals`) |
| Cloud OHLCV sync | `cloud/sync_cloud_prices.py` (GitHub Actions `cloud-sync.yml`, daily 10:00 UTC) |
| AIOps agent CLI | `aiops/cli/main.py` (init/status/morning/evening/backtest/lessons/validate/serve) |

## Data layer at a glance

- **Local SQLite**: `reports/analysis_history.db` (canonical, at share root) — `analysis_runs` + `metadata`; `aiops/state/aiops.db` — AIOps 13-table store.
- **File cache**: `reports/cache/` (~2600 md5-hashed JSON, 6 h TTL), `reports/charts/` (~2600 PNG), `reports/*_data.json` + `*_report.txt` per ticker.
- **Supabase (deployed)**: `portfolio_snapshot`, `sync_meta`, `ohlcv`, `ohlcv_intraday`, `fundamentals`, `profiles` (auth approval), analytics suite, `auto_pilot_state`/`auto_pilot_trades`, `ledger_transactions`/`ledger_budgets`/`ledger_corrections`; Storage bucket `user-uploads`.

## Auth model (frontend)

- Signup is invite-only (`INVITE_CODE`, verified by `/api/auth/verify-invite` with rate limiting).
- Login via Supabase password auth; every API route gates through `lib/server-auth.ts` `authenticate()`: valid Supabase session AND `profiles.approved === true`, OR shared `APP_TOKEN` via `?token=` (external scripts only).
- First signup auto-becomes admin. Missing `profiles` table → 503 hinting `sync/auth_schema_v2.sql`.

## Recent session context (ledger work)

- Ledger parser is bank-agnostic: UPI (PhonePe/GPay/Paytm), delimited (tab/semicolon/pipe), fixed-width, Dr/Cr indicator, credit cards, PDF (pdfjs-dist). Sign convention: amount > 0 = expense, < 0 = income.
- Balance-continuity self-check returns `balanceCheck.mismatches`; `looksLikeDate` guard excludes HDFC "STATEMENT SUMMARY" totals rows.
- Failure handling: unparseable files → 422 with clear message (never silent 200); zero-amount rows always dropped (no garbage fabrication).
- Regression harness: `frontend/tests/` — 130 tests, 26 suites, incl. `fixtures.test.ts` (13 fixture files in `frontend/tests/fixtures/`).
- Real HDFC verification: `frontend/scripts/verify-real-statement.ts` against `/Users/vijaykumar/projecs /opencode/Acct Statement_8816_*.xls` (123 & 385 txns, 0 balance mismatches).