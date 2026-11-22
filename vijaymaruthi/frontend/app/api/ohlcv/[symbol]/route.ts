import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  fetchOhlcvIntradayRow,
  fetchOhlcvRow,
  supabaseConfigured,
} from "@/lib/supabase";
import type { OHLCVPoint, OHLCVResponse } from "@/lib/types";

// Never statically optimize — the Mac backfill refreshes candles each sync
export const dynamic = "force-dynamic";

/**
 * GET /api/ohlcv/:symbol?period=1mo|3mo|6mo|1y|2y|5y|10y&interval=1d|1m|5m|15m|30m|1h|4h
 *
 * Same-origin proxy for the interactive chart in "supabase" data mode.
 *
 * The Mac backfill downloads 10y of daily candles ONCE per ticker into the
 * `ohlcv` table, and intraday candles into `ohlcv_intraday` (one row per
 * ticker+interval). This route slices the stored series to the requested
 * period (trading-day counts mirror yfinance's periods, capped at 2500 like
 * the backend /api/v1/ohlcv) — no live Yahoo call happens on Vercel.
 *
 * Intraday intervals are served from `ohlcv_intraday` when available; if the
 * pair is missing (e.g. the intraday backfill hasn't covered this ticker yet)
 * the route falls back to the daily series and marks the response
 * `degraded: true` so the chart still renders.
 *
 * Authorization mirrors /api/dashboard: valid Supabase session with an
 * APPROVED profile, or the shared APP_TOKEN (?token=...).
 */
const PERIOD_POINTS: Record<string, number> = {
  "1mo": 22,
  "3mo": 66,
  "6mo": 130,
  "1y": 252,
  "2y": 504,
  "5y": 1260,
  "10y": 2500,
};
const MAX_CANDLES = 2500; // backend cap, also keeps the payload small
const INTRADAY_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;

  // ── 1. Authenticate / authorize (same rules as /api/dashboard) ──
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  // ── 2. Resolve the stored series (intraday first, daily fallback) ──
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "1y";
  const interval = url.searchParams.get("interval") ?? "1d";
  try {
    // The OHLCV tables store NSE tickers with a ".NS" suffix. Callers may pass
    // the bare symbol (e.g. /api/ohlcv/RELIANCE), so try the raw form first,
    // then the ".NS"/".BO"-suffixed forms.
    const bare = symbol.replace(/\.(NS|BO)$/i, "");
    const candidates = [...new Set([symbol, bare, `${bare}.NS`, `${bare}.BO`])];

    let raw: unknown[] = [];
    let degraded = false;
    if (INTRADAY_INTERVALS.has(interval)) {
      // Intraday is best-effort: if the table is missing (schema not applied)
      // or the pair isn't backfilled, fall back to the daily series instead of
      // failing the request.
      try {
        for (const cand of candidates) {
          const row = await fetchOhlcvIntradayRow(cand, interval);
          if (row) {
            if (Array.isArray(row.candles)) {
              raw = row.candles;
            } else if (typeof row.candles === "string") {
              raw = JSON.parse(row.candles);
            }
            break;
          }
        }
      } catch {
        raw = [];
      }
      if (raw.length === 0) degraded = true; // intraday not backfilled → daily
    }
    if (raw.length === 0) {
      for (const cand of candidates) {
        const row = await fetchOhlcvRow(cand);
        if (row) {
          // Defensive: jsonb may come back as a parsed array OR as a JSON string
          // (older backfills stored strings). Accept both.
          if (Array.isArray(row.candles)) {
            raw = row.candles;
          } else if (typeof row.candles === "string") {
            raw = JSON.parse(row.candles);
          }
          break;
        }
      }
    }
    if (raw.length === 0) {
      return NextResponse.json(
        { error: `No chart data for ${symbol} (precomputed backfill may not cover it)` },
        { status: 404 },
      );
    }

    const points = Math.min(MAX_CANDLES, PERIOD_POINTS[period] ?? 500);
    const candles = raw.slice(-points) as OHLCVPoint[];
    const response: OHLCVResponse & { degraded?: boolean } = {
      ticker: symbol,
      period,
      candles,
      ...(degraded ? { degraded: true } : {}),
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OHLCV fetch failed";
    // PGRST205 = table not in the schema cache → chart_schema.sql not run yet
    if (message.includes("PGRST205")) {
      return NextResponse.json(
        {
          error:
            "Chart tables not created yet — run sync/chart_schema.sql in the " +
            "Supabase SQL Editor, then the backfill (sync_to_supabase.py --ohlcv-only).",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
