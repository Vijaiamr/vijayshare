# AIOps — NSE AI Market Intelligence & Continuous Learning Agent

Additive feature under the **Auto Pilot** area of the VijayMaruthi platform.
**Additive integration with no intentional behavioral changes to existing
Auto Pilot functionality.** The existing engine (`run_latest_analysis.py`),
cron jobs, Supabase sync, `/api/pilot/*` routes, paper-trading logic, and
navigation are untouched.

## Architecture — three layers

1. **Deterministic Python** — market data, indicators, regime, validation,
   calibration, BM25 retrieval, persistence. The LLM never computes numbers;
   Python validates everything.
2. **ADK (optional)** — orchestration layer for the web UI. `google-adk` is an
   optional dependency; the CLI works without it.
3. **OpenCode LLM** — the only LLM. Accessed over HTTP via `opencode serve`
   (direct client for CLI workflows; ADK `BaseLlm` bridge for the web UI).

## Non-negotiable rules

1. **No future leakage.** Every feature row carries `available_at`. Queries
   filter `available_at <= as_of`. The backtester replays the exact temporal
   boundary per day (see `clock.py`).
2. **Immutability.** `market_daily` and locked `predictions` are immutable
   (SQLite triggers). Corrected data = new `data_version`, never an UPDATE.
3. **LLM never computes numbers.** The LLM proposes direction/confidence/
   rationale; Python computes prices, validates ranges, and persists.
4. **`INSUFFICIENT_DATA` over fabrication.** If data is missing, say so.
5. **Idempotency.** `daily_runs` has `UNIQUE(run_type, run_date)`; re-running
   a completed run is a no-op unless `--force`.
6. **Temporal integrity.** Prediction `as_of = D 09:00 IST` uses only bars
   with `available_at <= D-1 16:00`. Validation `as_of = D 16:00` uses the
   D close bar.
7. **Version identity + integrity.** `prompt_version`/`knowledge_version` are
   human-readable identities; `prompt_hash`/`knowledge_hash` are sha256
   content hashes. Both are recorded in `agent_runs` with `model`.
8. **Audit everything.** Every LLM interaction is recorded in `agent_runs`.
9. **Sequential per symbol.** Predictions are made one symbol at a time.
10. **Knowledge growth is gated.** Lessons are `proposed` → validated by
    observations → `accepted`/`rejected`. LLM proposes; Python decides.

## Temporal standard (single source: `aiops/clock.py`)

```
D-1 16:00  available historical state (bars through D-1 close)
    ↓
D 09:00    prediction (as_of = D 09:00 IST)
    ↓
D 16:00    validation (D close bar available)
```

## CLI

```
aiops init                      # create DB, schema, seed symbols
aiops status                    # runs, predictions, lessons, calibration
aiops morning                   # fetch D-1..D data → predict for D
aiops evening                   # fetch D close → validate → calibrate
aiops backtest --days 15        # replay with SimulationClock
aiops lessons                   # list/promote lessons
aiops serve                     # local HTTP API (FastAPI, port 8010)
aiops validate                  # run internal consistency checks
```

## Local HTTP API (`aiops serve`)

FastAPI on `AIOPS_API_HOST:AIOPS_API_PORT` (default 127.0.0.1:8010):

```
GET  /api/v1/health
GET  /api/v1/status        # includes adk_ui_url + next_scheduled ("Not configured")
GET  /api/v1/runs
GET  /api/v1/predictions   # ?run_date= / ?symbol=
GET  /api/v1/lessons       # ?status=
GET  /api/v1/calibration   # ?symbol=
POST /api/v1/morning       # {force?, mode?}
POST /api/v1/evening       # {force?}
```

The frontend proxies this via `frontend/app/api/pilot/aiops/status/route.ts`
(`AIOPS_API_URL || http://127.0.0.1:8010/api/v1`). On Vercel the local server
does not exist, so the route returns `{ available: false }` and the
`/pilot/aiops` page renders the "run locally" guidance panel — never
fabricated data.

## Auto Pilot integration (additive)

- `frontend/app/(app)/pilot/aiops/page.tsx` — "AI Ops & Learning" view
- `frontend/app/api/pilot/aiops/status/route.ts` — server-side proxy
- `frontend/components/pilot/AiOpsLinkCard.tsx` — link card on the Auto Pilot page
- `frontend/app/(app)/pilot/page.tsx` — one additive import + one element only

No intentional behavioral changes to existing Auto Pilot functionality. The
analysis engine, cron jobs, Supabase sync, `/api/pilot/*` routes, paper-trading
logic, and navigation are untouched.

## Acceptance (gate before any frontend work)

```
aiops init → aiops backtest --days 15 → aiops status → aiops morning → aiops evening → aiops status
```

## Layout

```
aiops/
├── aiops/          # source/package (no state, no reports)
├── server/         # local HTTP API
├── tests/
├── state/aiops.db  # runtime DB (gitignored)
└── reports/        # generated artifacts (gitignored)
```