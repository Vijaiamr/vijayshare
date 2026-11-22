# VijayMaruthi Trading Analysis Workspace

This workspace contains a Python market-analysis toolkit, the VijayMaruthi Wealth Management web platform, and a macOS Trading Journal automation service.

It is designed for local research and portfolio workflows. Analysis uses live market data from Yahoo Finance through `yfinance`; it is not investment advice and results depend on data availability, ticker format, and the selected timeframe.

## Workspace Map

```text
workspace root/
├── technical_analysis_report.py   # Standalone single-ticker analysis
├── run_latest_analysis.py         # Resumable batch analysis
├── pattern_engine.py              # Chart-pattern detection and trade geometry
├── pattern_validator.py           # Multi-timeframe NSE validation
├── portfolio_heatmap.py           # Batch portfolio analysis and visualization
├── quantamental_backtester.py     # Technical/fundamental signal backtesting
├── analysis_db.py                 # SQLite persistence for root workflows
├── sentiment_analyzer.py          # News retrieval and sentiment scoring
├── trading_journal_watcher.py     # macOS Notes polling service
├── trading_journal_processor.py   # Journal task parsing and execution
├── validate_analysis.py            # Output validation across sample tickers
├── reports/                       # Text, JSON, chart, and SQLite outputs
├── logs/                          # Runtime and scheduled-job logs
├── validation_results/            # Validation summaries
└── vijaymaruthi/                  # FastAPI + Next.js platform
    ├── backend/                   # API and platform analysis engine
    ├── frontend/                  # Next.js application
    ├── sync/                      # SQLite to Supabase synchronization
    ├── cron/                      # Scheduled-job wrappers
    ├── testcase/                  # Live/deployed integration tests
    └── CRON.md                    # Detailed scheduling reference
```

The `quantamental-platform/frontend` directory is a separate frontend-only project area. The complete runnable application is under `vijaymaruthi/`.

## Architecture and Data Flow

### Standalone analysis

```text
Yahoo Finance / yfinance
        |
        v
technical_analysis_report.py
        |
        +--> indicators, market structure, patterns, Wyckoff/ICT, Gann
        +--> fundamentals and optional news sentiment
        +--> quantamental/confluence signal
        |
        +--> reports/{SYMBOL}_report.txt
        +--> reports/{SYMBOL}_data.json
        +--> reports/{SYMBOL}_analysis.png
        +--> reports/analysis_history.db (when persistence is enabled)
```

### Web platform

```text
Next.js frontend (:3001)
        |
        v
FastAPI backend (:8765)
        |
        v
backend/engine and SQLite analysis database
        |
        +--> local dashboard/report APIs
        +--> optional sync/sync_to_supabase.py
        +--> Supabase tables for deployed dashboard data
```

The frontend supports local mode, where it calls FastAPI directly, and Supabase mode, where Next.js proxy routes and Supabase authentication are used for deployed operation.

### Trading Journal automation

```text
macOS Notes: "Trading Journal"
        |
        v
trading_journal_watcher.py (polls every 30 seconds)
        |
        v
trading_journal_processor.py -> pattern_validator.py
        |
        v
HTML ##RESULT: block appended to the same note
```

## Requirements

- macOS for the Notes watcher and launchd integration
- Python 3.10 or newer
- Node.js 18 or newer
- Network access for Yahoo Finance and any configured cloud services
- Optional: Supabase project for deployed data synchronization
- Optional: OpenAI/search credentials for chatbot features in the platform

Install platform Python dependencies:

```bash
cd "vijaymaruthi/backend"
python3 -m pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd "vijaymaruthi/frontend"
npm install
```

The workspace path contains a space (`projecs `). Quote paths in shell commands and escape the space in cron entries.

## Common Workflows

### 1. Analyze one ticker

From the workspace root:

```bash
python3 technical_analysis_report.py HDFCBANK.NS --save-json
python3 technical_analysis_report.py AAPL --options --wyckoff --gann
```

The script combines market structure, trend, support/resistance, Fibonacci, moving averages, RSI, MACD, Bollinger Bands, ADX, ATR, OBV, candlesticks, divergence, multi-timeframe analysis, Wyckoff/ICT, Gann, fundamentals, sentiment, and a quantamental signal when the relevant modules and data are available.

Outputs are written to `reports/`. NSE tickers normally use the `.NS` suffix; US tickers generally do not.

### 2. Run a resumable NSE refresh

```bash
python3 run_latest_analysis.py --limit 50
python3 run_latest_analysis.py --workers 8
python3 run_latest_analysis.py --force
```

The batch runner loads tickers from the platform SQLite database, skips tickers already analyzed today, processes batches of 20, and logs to `logs/latest_analysis.log`. A full universe run can take roughly 1.5 to 3 hours. Use `--force` to ignore the same-day skip behavior.

After a local refresh, synchronize supported data to Supabase from the platform directory:

```bash
cd vijaymaruthi
python3 sync/sync_to_supabase.py
```

### 3. Start the web platform

```bash
cd vijaymaruthi
npm install
npm run dev
```

This starts:

- Next.js frontend: `http://localhost:3001`
- FastAPI backend: `http://localhost:8765`
- API health check: `http://localhost:8765/api/v1/health`

Run services separately when needed:

```bash
npm run dev:frontend
npm run dev:backend
```

The platform includes stock analysis, dashboard views, backtests, OHLCV/fundamentals data, portfolio views, financial ledger workflows, authentication, and administrative routes. See [vijaymaruthi/README.md](vijaymaruthi/README.md) for the short platform-specific overview.

### 4. Use the Trading Journal watcher

The watcher only reads and updates the macOS Notes note named `Trading Journal` in the `iCloud` account and `Notes` folder.

```bash
python3 trading_journal_watcher.py --oneshot
python3 trading_journal_watcher.py
python3 trading_journal_watcher.py --daemon
```

Explicit task syntax:

```text
##TASK: analyze HDFCBANK
```

The watcher also detects uppercase stock symbols below its sentinel line, so a line such as `RELIANCE` can be processed without `##TASK:`. Completed tasks receive an HTML `##RESULT:` block. The watcher uses `/tmp/trading_journal_watcher.pid` and writes to `logs/trading_journal_watcher.log`.

For login-time startup:

```bash
./install_trading_journal_watcher.sh
```

Required macOS setup: Notes and iCloud Notes must be enabled, the note must exist in the expected account/folder, and the terminal or launchd process must have permission to automate Notes.

### 5. Run validation

Validate the standalone report contract across the configured sample universe:

```bash
python3 validate_analysis.py
```

Results are written to `validation_results/validation_results.json`. The validator checks process success, report/chart/JSON creation, expected report sections, and signal consistency.

Run platform tests:

```bash
cd vijaymaruthi/backend
python3 -m pytest tests/test_pattern_engine.py -v
python3 -m pytest tests/test_convolution.py -v

cd ..
python3 -m pytest testcase/test_live_site.py -v
python3 -m pytest testcase/test_rate_limit.py -v
```

Run frontend checks:

```bash
cd vijaymaruthi/frontend
npm run lint
npm run build
```

Live tests require the deployment and test credentials configured by `testcase/.env`.

## Configuration

Copy the frontend template before local development:

```bash
cd vijaymaruthi/frontend
cp .env.local.example .env.local
```

Important variables include:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Local FastAPI base URL, normally `http://localhost:8765/api/v1` |
| `NEXT_PUBLIC_DATA_MODE` | `local` or `supabase` frontend data mode |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase publishable/anon key |
| `SUPABASE_URL` | Server-side Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service key |
| `INVITE_CODE` | Server-only signup invite code |
| `APP_TOKEN` | Optional server monitoring gate |
| `OPENAI_API_KEY` | Optional chatbot integration |
| `SEARCH_API_KEY` | Optional search integration |
| `VM_SHARE_DIR` | Shared data directory used by platform jobs |
| `CACHE_TTL_HOURS` | Analysis cache lifetime |
| `SCAN_WORKERS` | Backend scan concurrency |
| `TICKER_TIMEOUT_SECONDS` | Per-ticker analysis timeout |

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE`, or other server secrets with a `NEXT_PUBLIC_` prefix.

## Scheduling

The detailed schedule and installation notes are in [vijaymaruthi/CRON.md](vijaymaruthi/CRON.md). The repository includes cron wrappers for daily analysis, Supabase synchronization, keep-alive behavior, and optional Vercel health/scan calls.

Use launchd for long-running services such as the journal watcher. Use cron for one-shot daily jobs. Verify the machine's actual installed jobs with `crontab -l` and `launchctl list`; repository configuration files describe intended schedules and do not prove that a job is currently active.

## Outputs and Generated Files

- `reports/*_report.txt`: human-readable analysis reports
- `reports/*_data.json`: serialized analysis data for integrations
- `reports/*_analysis.png`: generated charts
- `reports/analysis_history.db`: SQLite analysis history and dashboard source data
- `logs/*.log`: watcher, batch, cron, and application logs
- `validation_results/`: validation summaries
- `hs_charts/`, `hs_backtest_results/`: head-and-shoulders research artifacts

Treat reports, logs, caches, `node_modules`, `.next`, and local databases as generated or machine-specific data. Do not commit credentials or secrets.

## Code Ownership and Maintenance Notes

There are overlapping analysis implementations in the workspace root, `vijaymaruthi/engine`, `vijaymaruthi/backend/engine`, and `vijaymaruthi/vercel-backend`. The platform backend is the source used by the FastAPI application; root scripts are convenient standalone workflows. When changing shared analysis behavior, check the corresponding platform copy and its tests to avoid drift.

The current test coverage is strongest around pattern detection and convolution. The Notes watcher, SQLite persistence, Supabase synchronization, most API routes, and several scheduled jobs have less direct automated coverage, so validate those workflows with focused manual checks after changes.

## Further Reading

- [Platform README](vijaymaruthi/README.md)
- [Scheduling guide](vijaymaruthi/CRON.md)
- [Chart and candlestick reference](document.md)
- [Head-and-shoulders documentation](document/HEAD_AND_SHOULDERS_PATTERN.md)
- [Python tracking notes](pythontracker.md)
- [Skill usage notes](skill-usage.md)
