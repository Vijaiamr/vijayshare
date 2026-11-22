# VijayMaruthi Backend → Vercel

This folder deploys the **FastAPI quantamental backend** to Vercel as its own
serverless project, so the deployed frontend can call a hosted API instead of
`localhost:8765`.

## How it works

```
vercel-backend/
├── index.py              # Vercel entry point — exports the FastAPI `app` (root index.py is auto-detected)
├── backend -> ../backend # symlink to the real backend package (single source of truth)
├── lib/                  # synced copies of shared engine modules from the repo root
│   ├── analysis_db.py
│   ├── technical_analysis_report.py
│   ├── quantamental_backtester.py
│   ├── portfolio_heatmap.py
│   ├── sentiment_analyzer.py
│   ├── pattern_validator.py
│   ├── backtest_hs_full.py
│   └── nse_hs_scanner.py
├── requirements.txt      # Python deps for the Vercel build
├── vercel.json           # function memory / duration / exclusions
├── sync-lib.py           # copies lib/ modules from the repo root
├── deploy.sh             # one-command deploy (login → sync → link → deploy)
└── README.md
```

Vercel detects the `app` instance in `index.py` and serves the whole
FastAPI app as **one Vercel Function** — all routes (`/api/v1/...`) are matched
by FastAPI's router inside the function.

> The entry point is at the root (not `api/`) on purpose: the real backend
> package is named `api`, and a wrapper folder named `api/` would shadow it at
> import time.

## Deploy

```bash
cd vercel-backend
./deploy.sh
```

First run opens a browser for `vercel login`. The script:

1. Syncs the shared engine modules from the repo root into `lib/`
2. Creates/links a Vercel project named **`vijaymaruthi-backend`**
   (override with `VERCEL_PROJECT_NAME=my-name ./deploy.sh`)
3. Sets production env vars (`VM_SHARE_DIR=/tmp`, `CORS_ORIGINS`, …)
4. Deploys to production

Health check after deploy:
`https://vijaymaruthi-backend.vercel.app/api/v1/health`

## Point the frontend at this backend

In the **frontend's** Vercel project, add a production environment variable:

```
NEXT_PUBLIC_API_URL=https://vijaymaruthi-backend.vercel.app/api/v1
```

Locally, keep `.env.local` as-is (`http://localhost:3001/__api` → proxied to
`localhost:8765`). The frontend falls back to
`http://localhost:8765/api/v1` when the variable is unset.

> Note: the frontend currently ships in **supabase mode**
> (`NEXT_PUBLIC_DATA_MODE=supabase`), which reads data from Supabase and
> disables the localhost rewrite. The Vercel-hosted backend is the companion
> for the live-analysis endpoints and for switching the frontend back to
> API mode.

## CORS

The backend's CORS allow-list is extended at runtime via `CORS_ORIGINS`
(comma-separated). The deploy script sets it to the frontend's Vercel origins
by default.

## Caveats (serverless limits)

- **Bundle size:** pandas + numpy + scipy + matplotlib ≈ 300 MB. Vercel allows
  up to 500 MB per function — keep `lib/` lean and run `sync-lib.py` to refresh.
- **Duration:** analysis requests can be slow (yfinance downloads). The
  function is set to `maxDuration: 60`. Heavy full-stock scans are not
  practical on serverless — use the local backend or Supabase mode for those.
- **Filesystem:** `/tmp` is ephemeral. Caches, generated reports, and the
  SQLite DB reset between invocations. Persistent storage stays in Supabase.
- **Modes:** `GET /api/v1/health`, dashboard, OHLCV, fundamentals, and chat
  endpoints work well. Batch scans may hit the duration limit.

## Local testing

```bash
# From vercel-backend/ — boots the exact entry Vercel uses
python3 -m uvicorn index:app --reload --port 8765
# or
vercel dev
```
