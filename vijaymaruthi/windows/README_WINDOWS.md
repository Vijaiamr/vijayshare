# VijayMaruthi — Windows Runner Setup

This laptop is the **always-on runner**: daily cloud DB population, daily NSE
analysis → Supabase, and overnight backtests. Development happens on the Mac;
this machine deploys and runs.

---

## 1. One-time setup (~15 minutes)

1. **Install Python 3.12+** from https://www.python.org/downloads/
   ⚠️ Tick **"Add python.exe to PATH"** in the installer.
2. **Copy this repo** to e.g. `C:\vijaymaruthi\` (git clone after the GitHub
   remote is added, or copy the folder).
3. **Copy credentials** from the Mac: `vijaymaruthi/sync/.env` → same path here.
   It contains `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Never commit it.
4. Open PowerShell in `windows\` and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File setup_windows.ps1
   ```
   This creates `.venv`, installs all dependencies, verifies imports, and runs
   a 2-ticker dry-run against Supabase.

## 2. Register scheduled tasks (run PowerShell as Administrator)

```powershell
powershell -ExecutionPolicy Bypass -File register_tasks.ps1
```

| Task | Schedule | What it does |
|---|---|---|
| `VijayMaruthi-CloudSync` | daily 15:30 | Refreshes OHLCV candles in Supabase (`cloud/sync_cloud_prices.py`) |
| `VijayMaruthi-DailyAnalysis` | Mon–Fri 19:30 | NSE analysis → local SQLite → Supabase push |
| Backtest | manual | `windows\run_backtest.bat` (8–12 h, resumable) |

## 3. Power settings — CRITICAL for overnight runs

- Settings → System → Power & battery → **Screen and sleep**:
  - **When plugged in, put my device to sleep after: Never**
- Keep the charger connected during scheduled jobs.
- Tasks are registered with `-WakeToRun`, so the machine will wake from sleep
  to run them — but a *hibernated/shut down* laptop will not.

## 4. Run the full backtest

```bat
windows\run_backtest.bat
```

First run generates `nse_universe.txt` from Supabase (~2,400 tickers), then
runs ~8–12 h with checkpoints every ticker. **If anything interrupts it,
just run the same command again** — completed tickers are skipped (`--resume`).

Results land in `validation_results/quantamental_bt/`:
- `REPORT.md` — verdict table (does Strong Buy avoid −10% moves?)
- `signals.csv` / `summary.json` / `signals.jsonl`

## 5. Logs

All jobs append to `vijaymaruthi\logs\`:
`cloud_sync.log` · `daily_analysis.log` · `backtest.log`

## 6. Before going live — disable the other runners

Only do this AFTER Windows runs green for a day:

**Mac** (Terminal):
```bash
crontab -e          # delete the two vijaymaruthi lines
launchctl unload ~/Library/LaunchAgents/com.vijaymaruthi.supabase-sync.plist 2>/dev/null
```

**GitHub Actions** (web): repo → Actions → "Cloud price sync" → ⋯ → Disable workflow.
(Manual "Run workflow" still works as an emergency backup.)

## Troubleshooting

| Problem | Fix |
|---|---|
| `python not found` | Reinstall Python with PATH checkbox, re-run setup |
| Tasks don't fire | Check they exist: `Get-ScheduledTask 'VijayMaruthi-*'`; check laptop was awake |
| Yahoo 404 on some tickers | Normal — delisted/renamed symbols are skipped automatically |
| Backtest interrupted | Re-run `run_backtest.bat` — resumes from checkpoint |
