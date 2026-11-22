# VijayMaruthi cloud cron — zero cost

Run the daily price refresh **in the cloud** — no Mac, no paid plan.

## What this runs

`.github/workflows/cloud-sync.yml` — a scheduled GitHub Actions workflow that
runs **once daily at 15:30 IST (10:00 UTC)** and executes:

```
cloud/sync_cloud_prices.py
```

That script:
1. Reads the ticker list from your Supabase `portfolio_snapshot` table
2. Downloads fresh 5-year daily candles from Yahoo Finance (same logic as the
   Mac's `sync/sync_to_supabase.py --ohlcv-only`)
3. Upserts them into the Supabase `ohlcv` table + records stats in `sync_meta`

Result: the ohlcv charts refresh daily at 3:30 PM IST even when your Mac is off.

## Why GitHub Actions (not Vercel cron)?

- **Free on both** — but Vercel's Hobby cron only runs **once per day** and
  can only hit HTTP endpoints; it cannot run the Python yfinance logic.
- GitHub Actions runs real Python on a schedule, free (2,000 min/month on
  private repos, unlimited on public).
- Once-daily at 15:30 IST ≈ 450 min/month — comfortably inside the free
  private-repo budget, and the workflow can be re-triggered manually anytime.

## Setup (5 minutes, $0)

1. **Create a GitHub repo** (github.com → New repository). Private is fine;
   public gets unlimited CI minutes.
2. **Push this project to it:**
   ```bash
   cd /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi
   git init -b main
   git add .
   git commit -m "init: VijayMaruthi platform + cloud cron"
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. **Add secrets** (repo → Settings → Secrets and variables → Actions):
   | Secret | Value |
   |--------|-------|
   | `SUPABASE_URL` | `https://<your-project>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key (from sync/.env) |
4. **Test it manually:** Actions → "Cloud price sync" → **Run workflow** →
   watch the run (2–3 min).
5. The `0 10 * * *` schedule (15:30 IST) starts automatically after the first push.
   Verify: Actions → "Cloud price sync" → the schedule badge shows the next run.

## Controlling run length (free minutes)

| Repo type | Free minutes | Once-daily allowance |
|-----------|-------------|----------------------|
| Private | 2,000 / month | ~65 min per day (a full 2386-ticker run ≈ 15 min — plenty) |
| Public | unlimited | all 2386 tickers every run |

The workflow defaults to **all tickers** (`--limit 0`). To cap the per-run
work, set a repo **variable** `CLOUD_SYNC_LIMIT` (Settings → Variables) —
e.g. `1000`. The workflow passes it as `--limit`; 0 = all tickers.

## Local test of the same script

```bash
cd cloud
set -a; source ../sync/.env; set +a          # loads SUPABASE_URL + key
python3 sync_cloud_prices.py --only RELIANCE.NS,HDFCBANK.NS --dry-run   # 2 tickers, no writes
python3 sync_cloud_prices.py --limit 10                                  # real: 10 tickers
```

## Cost summary

| Option | Cost | Every 4 h? | Runs Python? | Needs |
|--------|------|-----------|--------------|-------|
| **GitHub Actions** (this) | **$0** | ✅ | ✅ | free GitHub repo + 2 secrets |
| Vercel Cron (Hobby) | $0 | ❌ once/day | ✅ | deploy backend |
| cron-job.org / UptimeRobot | $0 | ✅ | ❌ HTTP only | none (pings a URL) |
| Cloudflare Workers Cron | $0 | ✅ | ⚠️ 10 ms CPU (HTTP fetch only) | Cloudflare account |
| Vercel Pro | $20/mo | ✅ | ✅ | paid |

> The heavy full-NSE analysis (~2,400 tickers, 1.5–3 h) is too big for free
> cloud runners — that stays on the Mac (cron Job 2) or on a VPS. This cloud
> job keeps the hosted charts/prices fresh, which is the every-4-hour part
> that matters most.
