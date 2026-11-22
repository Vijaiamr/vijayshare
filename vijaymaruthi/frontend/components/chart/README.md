# Interactive Chart — Architecture & Feature Inventory

The VijayMaruthi interactive chart is a TradingView-class chart built on
`lightweight-charts` v5. This document maps the feature set to the code that
owns it, explains the two data paths (local vs deployed), and shows how to run
the regression suites.

## Feature inventory

| Area | What's implemented |
|---|---|
| Chart types | Candle, Hollow, Heikin-Ashi, Renko, Line, Area, Bar, Baseline, **Kagi, Point & Figure, Range, Line Break** (12 total) |
| Timeframes | 1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M (9) |
| Indicators | ~45 across 5 categories (Trend / Oscillators / Volume / Volatility / Structure), 24 sub-panes |
| Drawing tools | 22 (cursor, crosshair, trendline, ray, extended, h/v line, fib retracement/ext/fan/time, gann fan, pitchfork, rect, ellipse, text, label, arrow, measure, ABCD, XABCD, Elliott) |
| Chart features | Symbol search, data window, object tree, undo/redo, hotkeys, snapshot, templates, alerts, layouts, replay, compare, price-scale modes, magnet, session breaks, watermark, volume profile |

## Architecture map

| File | Owns |
|---|---|
| `components/InteractiveChart.tsx` | View state (lookback/interval/type/toggles/settings), data fetching, undo/redo history, hotkeys, overlays (watermark/session breaks/volume profile), dialogs wiring |
| `components/chart/ChartBuilder.ts` | Every lightweight-charts instance (main chart + sub-panes); `ChartHandle` API; chart-type rendering incl. alternative-type transforms |
| `components/chart/transforms.ts` | Pure OHLC → Kagi / Point & Figure / Range / Line Break transforms (unit-tested in `transforms.test.ts`) |
| `components/chart/ChartToolbar.tsx` | Toolbar: chart type, timeframes, categorized indicator menu, 22 drawing tools, compare, replay, alerts, layouts, templates, export, snapshot, fullscreen, settings |
| `components/chart/types.ts` | All shared types: `ChartType`, `BarInterval`, `ChartTime`, `ChartSettings`, `PaneKey`, `DrawingType`, `INDICATOR_CATEGORIES`, `CHART_TYPES` |
| `components/chart/drawings/` | Drawing layer (SVG) + drawing state (`useDrawings`) |
| `components/chart/ChartSettings.tsx` | Style/scale settings incl. alternative chart-type parameters |
| `components/chart/Chart{Alerts,Layouts,Templates,SymbolSearch,DataWindow,ObjectTree}Dialog.tsx` | Feature dialogs |
| `lib/api.ts` | `getOHLCV(ticker, period, interval)` — local + supabase data modes |
| `lib/indicators.ts` | Indicator math (45 indicators) |
| `app/api/ohlcv/[symbol]/route.ts` | Supabase-mode proxy: daily slice + intraday with daily fallback |

## Data paths

### Local mode (`NEXT_PUBLIC_DATA_MODE=local`, port 3000)
- `lib/api.ts` calls `/ohlcv/:ticker?period=…&interval=…` → rewritten by
  `next.config.mjs` to the FastAPI backend (`localhost:8765/api/v1/ohlcv`).
- Backend `backend/api/main.py` fetches live from yfinance (intraday ISO
  timestamps preserved; 3000-candle cap).

### Deployed mode (`NEXT_PUBLIC_DATA_MODE=supabase`, port 3001)
- `lib/api.ts` calls `/api/ohlcv/:ticker?period=…&interval=…` → the proxy route.
- Daily: slices the precomputed `ohlcv` table (10y backfill from the Mac).
- Intraday: serves `ohlcv_intraday` (one row per ticker+interval, backfilled by
  `sync/sync_to_supabase.py --intraday-only`); **falls back to daily** with
  `degraded: true` when the pair isn't backfilled or the table is missing.
- No live Yahoo call happens on Vercel.

### Backfill (Mac)
```
python3 sync/sync_to_supabase.py --ohlcv-only --ohlcv-limit 500        # daily
python3 sync/sync_to_supabase.py --intraday-only --intraday-limit 100  # intraday
```
Schema: `sync/chart_schema.sql` (daily) + `sync/chart_schema_v3.sql` (intraday).

## Running the tests

### Transform unit tests (no browser)
```
cd frontend && npx tsx components/chart/transforms.test.ts
```

### Playwright regression suites (needs a running local-mode frontend)
```
cd tests/chart && ./run_chart_tests.sh          # all suites
cd tests/chart && ./run_chart_tests.sh phase-d  # one suite
BASE_URL=http://localhost:3000 ./run_chart_tests.sh
```
Requires `pip install playwright && playwright install chromium`.

Suites: Phase D (17 checks), deep regression (6 steps), extras
(undo/redo/hotkeys/overlays), alerts + layouts, alternative chart types.

## Known limitations
- Intraday intervals on the deployed version depend on the `ohlcv_intraday`
  backfill covering the ticker; otherwise the chart degrades to daily.
- Kagi / P&F / Range / Line Break are rendered as transformed line series
  (lightweight-charts has no native series for them) — standard practice.