# Scheduling VijayMaruthi tasks with cron

This guide explains how to run the VijayMaruthi platform's periodic jobs —
daily analysis, Supabase sync, server keep-alive, and pinging the Vercel
backend — using **cron**.

Everything in this doc has already been created for you:

```
cron/
├── crontab.example       # ready-to-install crontab
├── run_supabase_sync.sh  # Job 1 — push local analysis → Supabase
├── run_daily_analysis.sh # Job 2 — re-run NSE analysis with latest data
└── keep_alive.sh         # Job 3 — restart the local dev stack if it dies
```

---

## 1. What can be automated

| Job | Command / script | When | Why |
|-----|------------------|------|-----|
| **Supabase sync** | `sync/sync_to_supabase.py` | weekdays 18:45 IST | Push today's analysed stocks to the cloud DB |
| **Analysis refresh** | `run_latest_analysis.py` | after market close | Re-analyse NSE stocks with latest prices (1.5–3 h for all ~2400) |
| **Keep dev stack alive** | `keep_alive.sh` | every 5 min | Restart backend :8765 / frontend :3001 if they crash |
| **Vercel health ping** | `curl …/api/v1/health` | every 6 h | Keep the serverless backend warm / monitor it |
| **Vercel daily scan** | `curl -X POST …/analyze/scan-pending` | daily | Trigger analysis on the hosted backend (see §8) |

---

## 2. Cron in 30 seconds

- Cron is a scheduler built into macOS/Linux. It reads a **crontab** (a table
  of jobs) and runs commands at the times you specify.
- Each line has 5 time fields, then the command:

  ```
  ┌──────────── minute (0–59)
  │ ┌────────── hour   (0–23)
  │ │ ┌──────── day of month (1–31)
  │ │ │ ┌────── month  (1–12)
  │ │ │ │ ┌──── day of week (0–7, 0 and 7 = Sunday)
  │ │ │ │ │
  45 18 * * 1-5  /path/to/script.sh
  ```

- `*` = every unit, `1-5` = range (Mon–Fri), `*/5` = every 5 units.

### Commands you'll use

```bash
crontab cron/crontab.example   # install the example crontab
crontab -l                      # list your jobs
crontab -e                      # edit your jobs (vim)
crontab -r                      # remove ALL jobs (careful)
```

> `crontab -e` edits **your** jobs as the logged-in user. Use `sudo crontab -e`
> only for system-level jobs.

### Current installed schedule (13 Aug 2026)

This crontab is **already installed and active** on this Mac. View it anytime
with `crontab -l` (see §12 for a one-line terminal command).

| Job | Crontab line | Schedule | Next run |
|-----|--------------|----------|----------|
| **Supabase sync** (fast, `--skip-ohlcv`) | `30 15 * * *` | **once daily at 3:30 PM IST** (market close) | today 15:30 local |
| **Full OHLCV backfill** | `0 21 * * 0` | Sunday 21:00 *(commented — enable if wanted)* | — |
| **Daily analysis** (100 tickers) | `30 19 * * 1-5` | weekdays 19:30 | daily |
| **Keep-alive** | `*/5 * * * *` | every 5 min *(commented — launchd recommended)* | — |
| **Vercel health ping** | `0 */6 * * *` | every 6 h *(commented)* | — |

To change the sync frequency, edit the crontab and re-install:

```bash
crontab -e                                  # edit the 5th field, e.g. 30 15 * * *
# or regenerate from the example file:
crontab cron/crontab.example
```

---

## 3. Important: this project's path contains a space

Your project lives at:

```
/Users/vijaykumar/projecs /opencode/share/vijaymaruthi
```

Note the space in `projecs /opencode`. In cron (and shell scripts) you must
quote or escape paths with spaces:

```bash
# ❌ breaks — unquoted
45 18 * * 1-5 /Users/vijaykumar/projecs /opencode/share/vijaymaruthi/cron/run_supabase_sync.sh

# ✅ escaped with backslash
45 18 * * 1-5 /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/run_supabase_sync.sh
```

The wrapper scripts in `cron/` already quote everything internally, so the
crontab only needs the escaping shown above.

---

## 4. Job 1 — Daily Supabase sync (cron version)

You already have this as a launchd job (`sync/com.vijaymaruthi.supabase-sync.plist`,
18:45 daily). If you prefer cron, add:

```cron
45 18 * * 1-5 /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/run_supabase_sync.sh --skip-ohlcv
```

**About the OHLCV backfill:** a full sync pushes the dashboard snapshot
(~2386 stocks) in a few seconds, then fetches **5-year OHLCV candles for every
ticker** — that part takes ~15 minutes. You don't need candles refreshed
daily, so:

- **Daily (fast):** `run_supabase_sync.sh --skip-ohlcv` → snapshot + meta, ~10 s
- **Weekly (full):** `run_supabase_sync.sh` → snapshot + candles, ~15 min
- **Partial:** `run_supabase_sync.sh --ohlcv-limit 200` → first 200 candles
- **Test:** `run_supabase_sync.sh --dry-run` → nothing is written

The crontab example wires the fast daily job (weekdays 18:45) plus a full
backfill on Sunday. Logs go to `logs/cron_supabase_sync.log`.

Test it once manually first:

```bash
./cron/run_supabase_sync.sh --skip-ohlcv && tail -5 logs/cron_supabase_sync.log
```

> If you keep the launchd job, remove one of them — you don't want the sync
> running twice. (The launchd job runs the full sync daily at 18:45.)

---

## 5. Job 2 — Daily analysis refresh

`run_latest_analysis.py` re-analyses NSE tickers with today's data and saves to
`reports/analysis_history.db`. It is **resumable** — tickers already analysed
today are skipped, so an interrupted run restarts cleanly.

```cron
# First 100 tickers, weekdays at 19:30 IST (quick, ~15 min)
30 19 * * 1-5 /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/run_daily_analysis.sh --limit 100

# ALL ~2400 tickers, Sunday 22:00 (takes 1.5–3 h)
0 22 * * 0 /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/run_daily_analysis.sh

# Force re-run + chain Supabase sync afterwards
# (SYNC_AFTER=1 ./cron/run_daily_analysis.sh --force)
```

Notes:
- Log: `logs/cron_analysis.log`
- Don't schedule a full scan during market hours (data changes mid-run) or when
  you need the Mac for other work.
- The wrapper forwards any extra flags to the script.

---

## 6. Job 3 — Keep the dev stack alive

`keep_alive.sh` checks that the backend (`:8765`) and frontend (`:3001`) are
listening and restarts `npm run dev` if either is down:

```cron
*/5 * * * * /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/cron/keep_alive.sh
```

**Caveat:** cron is a poor fit for "keep a server running" — the Mac's own
`launchd` is the right tool (see §7). Use this script only if you don't want to
touch launchd. Also note the stack only runs while this Mac is awake — for a
real 24/7 deployment use Vercel (frontend + backend already configured) or a
small VPS.

---

## 7. macOS: cron vs launchd

Your project already uses **launchd** (Apple's recommended scheduler) for two
jobs:

| Job | launchd label | Schedule |
|-----|---------------|----------|
| Supabase sync | `com.vijaymaruthi.supabase-sync` | daily 18:45 |
| Trading journal watcher | `com.vijaymaruthi.trading-journal-watcher` | every 30 s |

**Use launchd for long-running/keep-alive jobs, cron for one-shot daily tasks.**
Rule of thumb:

- Run a script once a day → either works.
- Keep a process alive → `launchd` with `KeepAlive=true`.
- You're on a Linux server / VPS → `cron` (or systemd timers).

cron quirks on macOS:
- Jobs run with a **minimal PATH** (`/usr/bin:/bin:…`) — always use absolute
  paths or set `PATH=` at the top of the crontab (the example file does).
- First run may prompt for **Full Disk Access** for `cron` in System Settings →
  Privacy & Security (needed to read files under your home directory).
- No GUI access from cron jobs — don't launch apps that need a display.

---

## 8. Scheduling the Vercel-hosted backend

Since the backend is now deployed to Vercel, the cleanest way to schedule
server-side tasks is **Vercel Cron Jobs** — Vercel calls your endpoints on a
schedule, no Mac required.

Add a `crons` block to `vercel-backend/vercel.json`:

```json
{
  "crons": [
    { "path": "/api/v1/analyze/scan-pending", "schedule": "0 19 * * 1-5" }
  ]
}
```

Then redeploy (`cd vercel-backend && ./deploy.sh`). Vercel will `POST` to
`/api/v1/analyze/scan-pending` weekdays at 19:00 UTC.

- Hobby plan allows **2 cron jobs**; Pro allows more.
- Cron paths receive **GET** by default — `scan-pending` is a POST endpoint,
  so use a GET-friendly endpoint instead (e.g. a future `/cron/daily` route),
  or trigger it from a local cron with curl:

```bash
# From this Mac — trigger the hosted backend's pending scan, then check progress
curl -s -X POST "https://vijaymaruthi-backend.vercel.app/api/v1/analyze/scan-pending" \
  >> logs/cron_vercel_scan.log 2>&1

# Health ping (every 6 h)
0 */6 * * * curl -s -o /dev/null -w "%{http_code}\n" https://vijaymaruthi-backend.vercel.app/api/v1/health >> /Users/vijaykumar/projecs\ /opencode/share/vijaymaruthi/logs/cron_vercel_health.log 2>&1
```

> Remember: the Vercel backend has a 60 s function limit — the full multi-hour
> NSE scan belongs on the local machine (Job 2), not serverless.

---

## 8.5 Cloud cron at zero cost (GitHub Actions)

The Mac cron only runs while this Mac is awake. To run the same job **in the
cloud, at zero cost**, this repo includes a GitHub Actions workflow:

```
.github/workflows/cloud-sync.yml   # schedule: 0 10 * * * (10:00 UTC = 15:30 IST daily)
cloud/sync_cloud_prices.py          # reads tickers from Supabase → yfinance → upserts ohlcv
cloud/README.md                     # full setup (5 min) + cost comparison
```

The cloud job is once daily at **3:30 PM IST** (10:00 UTC), matching the Mac
cron. GitHub Actions is free — 2,000 minutes/month on private repos
(once-daily ≈ 450 min/month, well within budget) and unlimited on public
repos.

Setup: create a free GitHub repo → push this project → add two secrets
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) → run once manually to test.
Full steps in `cloud/README.md`.

---

## 9. Quick install

```bash
# 1. Make the scripts executable
chmod +x cron/*.sh

# 2. Dry-run each script once (optional but recommended)
./cron/run_supabase_sync.sh
./cron/run_daily_analysis.sh --limit 5

# 3. Install the crontab
crontab cron/crontab.example

# 4. Verify
crontab -l
```

### Run now once, then daily at 3:30 PM IST

Trigger the same job the cron uses — manually, right now — without waiting for
the next scheduled tick. The cron schedule (`30 15 * * *`) keeps running once
daily at 3:30 PM IST afterwards; logs go to the same file:

```bash
./cron/run_supabase_sync.sh --skip-ohlcv && tail -5 logs/cron_supabase_sync.log
```

Done as of 13 Aug 2026 09:26 IST — snapshot=2386, fundamentals=293 pushed to
Supabase. Next automatic run: 15:30 local (daily at market close).

---

## 10. Logs & troubleshooting

All jobs write to `logs/`:

| Job | Log file |
|-----|----------|
| Supabase sync | `logs/cron_supabase_sync.log` |
| Analysis | `logs/cron_analysis.log` |
| Keep-alive | `logs/cron_keep_alive.log` |
| Vercel health | `logs/cron_vercel_health.log` |

Check whether cron actually ran:

```bash
grep CRON /var/log/system.log | tail -20     # macOS: every cron execution
tail -20 logs/cron_supabase_sync.log          # your job's own output
```

Common issues:

- **Job didn't run** → check `grep CRON /var/log/system.log`; verify the
  schedule field and that the script path is escaped (`projecs\ /opencode`).
- **"command not found"** → cron has a minimal PATH; use absolute paths
  (the scripts already do).
- **Permission denied** → `chmod +x cron/*.sh`; grant cron Full Disk Access.
- **Script runs but does nothing** → run it manually first and read the log.
- **Wrong timezone** → cron uses the machine's local time; on this Mac that is
  IST, so `18:45` = 18:45 IST. On a Linux server, check `timedatectl`.
- **`bad minute` when installing** → the macOS cron parser chokes if an
  environment line has a **trailing comment** on the same line. This bit us
  with `MAILTO=""  # empty = no mail` — the comment must be on its own line:

  ```cron
  # ❌ breaks:  MAILTO=""   # empty = no mail
  # ✅ works:   MAILTO=""
  ```

---

## 12. Show the cron jobs in a new terminal

To open a **new Terminal window** that displays the active cron jobs on this
Mac, run either:

```bash
# One-shot — opens a new Terminal window, runs crontab -l, stays open
osascript -e 'tell application "Terminal" to do script "echo \"=== VijayMaruthi cron jobs ===\"; crontab -l; echo; echo \"cron daemon:\"; pgrep -x cron >/dev/null && echo RUNNING || echo NOT RUNNING"'

# Or simply type this in any terminal
crontab -l
```

---

## 11. Alternative: Docker / server deployment

For running the whole stack on a server (not this Mac), the repo already ships
`docker-compose.yml` + `Dockerfile.backend`. A typical server crontab would be:

```cron
45 18 * * 1-5 docker compose -f /opt/vijaymaruthi/docker-compose.yml run backend python sync/sync_to_supabase.py
0 19 * * 1-5 docker compose -f /opt/vijaymaruthi/docker-compose.yml run backend python run_latest_analysis.py --limit 100
```

Or skip cron entirely and use **systemd timers** on the server (cleaner
logging, dependency handling).
