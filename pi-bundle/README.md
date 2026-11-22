# VijayMaruthi Engine — Raspberry Pi 3B Bundle

Run the NSE quantamental analysis engine on a **Raspberry Pi 3B** to populate
the local SQLite DB (`reports/analysis_history.db`) and push to Supabase.

> **Honest expectations for Pi 3B (1 GB RAM):**
> - The engine is network-bound (Yahoo Finance downloads), so it *works* on a Pi.
> - But 1 GB RAM is tight — the bundle forces **1 worker** and creates a
>   **2 GB swap file** to avoid out-of-memory crashes.
> - Full 2400-ticker scan: **6–12 h** on a Pi 3B. Start with `--limit 50–100`.
> - The Pi is best as an **always-on daily runner** (5 W, never sleeps).
>   Keep heavy backtests on the Windows laptop / Mac.

---

## Requirements

- **Raspberry Pi 3B** with **Raspberry Pi OS 64-bit** (Lite is fine).
  ⚠️ 32-bit OS will NOT work — pandas/scipy/matplotlib no longer ship
  32-bit ARM wheels. Reinstall 64-bit if needed.
- Internet access (Yahoo Finance).
- Optional: `vijaymaruthi/sync/.env` with `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (only needed for the Supabase push).

---

## Quick start

1. **Copy this whole `pi-bundle` folder** to the Pi (e.g. `~/pi-bundle`).
   (USB stick, `scp`, or `git clone` — whatever is easiest.)
2. **Run setup:**
   ```bash
   cd ~/pi-bundle
   bash setup.sh
   ```
   This checks 64-bit OS, creates a 2 GB swap file, installs dependencies,
   verifies imports, and runs a 2-ticker smoke test. (~10–20 min on a Pi.)
3. **Test a small run:**
   ```bash
   bash run_daily.sh --limit 20
   ```
   Check the log: `tail -f logs/daily_analysis.log`
4. **Schedule it** (optional, recommended):
   ```bash
   sudo bash install_service.sh
   ```
   Registers systemd timers: daily analysis Mon–Fri 19:30 IST, cloud sync
   daily 15:30 IST.

---

## Files

| File | Purpose |
|---|---|
| `setup.sh` | One-time setup: 64-bit check, swap, venv, deps, smoke test |
| `run_daily.sh` | NSE analysis → SQLite → (optional) Supabase. Forces `--workers 1` |
| `run_cloud_sync.sh` | Refresh OHLCV candles in Supabase (lightweight) |
| `install_service.sh` | Register systemd timers (daily analysis + cloud sync) |
| `run_latest_analysis.py` | Engine entry point (canonical share-root version) |
| `technical_analysis_report.py` | The analysis engine |
| `analysis_db.py` | SQLite layer (`reports/analysis_history.db`) |
| `analysis_health.py` | Health scoring |
| `sentiment_analyzer.py` | Sentiment module |
| `quantamental_backtester.py` | Backtester (heavy — run on laptop, not Pi) |
| `pattern_engine.py` | Pattern detection |
| `vijaymaruthi/backend/engine/runner.py` | Async runner wrapper |
| `vijaymaruthi/sync/sync_to_supabase.py` | Supabase push |
| `vijaymaruthi/cloud/sync_cloud_prices.py` | Cloud OHLCV sync |

---

## Usage

### Daily analysis

```bash
bash run_daily.sh                # all ~2400 tickers (6-12h on Pi 3B)
bash run_daily.sh --limit 100    # first 100 tickers (~15-30 min)
bash run_daily.sh --force        # re-run even if analysed today
SYNC_AFTER=1 bash run_daily.sh   # also push to Supabase when done
```

Resumable: interrupted runs can be restarted — tickers already analysed
today are skipped.

### Cloud sync (lightweight — the ideal Pi job)

```bash
bash run_cloud_sync.sh
```

### Backtests

**Do NOT run the full backtest on the Pi 3B** (8–12 h on a laptop becomes
days on a Pi). Use the Windows laptop or Mac for `quantamental_backtester.py`.

---

## Logs

All logs append to `logs/`:
- `logs/daily_analysis.log`
- `logs/cloud_sync.log`

systemd timers log to journald: `journalctl -u vijaymaruthi-analysis -f`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `setup.sh` says 32-bit OS | Reinstall Raspberry Pi OS 64-bit, re-run setup |
| Out-of-memory / process killed | Check swap: `free -h`. Re-run `setup.sh` to recreate swap. Always use `--workers 1` (run_daily.sh does this) |
| Yahoo 404 on some tickers | Normal — delisted/renamed symbols are skipped automatically |
| Supabase push fails | Check `vijaymaruthi/sync/.env` exists with valid credentials |
| Analysis interrupted | Just re-run the same command — it resumes |
| Slow scan | Expected on Pi 3B. Use `--limit 50–100` for daily runs |

---

## License notes

Engine code is part of the VijayMaruthi platform (internal use). Dependencies:
numpy/pandas/scipy/matplotlib (BSD), yfinance (Apache-2.0), requests (Apache-2.0).