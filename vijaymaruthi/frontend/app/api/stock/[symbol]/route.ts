import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { fetchSnapshotRow, supabaseConfigured } from "@/lib/supabase";
import type { TickerAnalysis } from "@/lib/types";

// Never statically optimize — data changes every time the Mac syncs
export const dynamic = "force-dynamic";

// Python engine base URL (owner's Mac). Not reachable on Vercel — the merge
// below degrades gracefully to the snapshot-only response when unavailable.
const ENGINE_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8765/api/v1";
const ENGINE_TIMEOUT_MS = 8000;

/**
 * Merge engine-only sections (conv_technical with pattern geometry, etc.)
 * from the local Python backend when it is reachable. In deployed mode the
 * backend does not exist, so this returns null and the caller keeps the
 * snapshot-only response — never fabricated data.
 */
async function fetchEngineSections(ticker: string): Promise<Partial<TickerAnalysis> | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
    try {
      const res = await fetch(`${ENGINE_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, period: "1y", sentiment: false, save_db: false }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res.json();
      // Only merge the engine sections the page actually renders; never
      // overwrite the snapshot's authoritative price/signal/quantamental.
      return {
        conv_technical: data.conv_technical,
        conv_fundamental: data.conv_fundamental,
        candlestick: data.candlestick,
        indicators: data.indicators,
        market_structure: data.market_structure,
        trend: data.trend,
        support_resistance: data.support_resistance,
        divergence: data.divergence,
        wyckoff: data.wyckoff,
        gann: data.gann,
        chart_url: data.chart_url,
        report_text: data.report_text,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return null; // backend unreachable (deployed mode) — degrade gracefully
  }
}

/**
 * GET /api/stock/:symbol
 *
 * Same-origin proxy for the stock detail page in "supabase" data mode.
 *
 * The full deep-dive analysis (OHLCV, patterns, Wyckoff, Gann, backtests)
 * is produced by the Python engine which only runs on the owner's Mac. In
 * deployed mode we serve the REAL precomputed snapshot row for the ticker
 * (price, QM rating/score, technical signal/score, fundamental score, cap
 * category, trend, rank) and mark engine-only sections as unavailable —
 * never fabricated data.
 *
 * Authorization mirrors /api/dashboard: valid Supabase session with an
 * APPROVED profile, or the shared APP_TOKEN (?token=...).
 */
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

  // ── 2. Fetch the real snapshot row ──
  try {
    // The snapshot stores NSE tickers with a ".NS" suffix (e.g. "RELIANCE.NS"),
    // but the URL may be requested without it (e.g. /stock/RELIANCE). Try the
    // raw symbol first, then the ".NS"-suffixed form.
    const candidates = symbol.includes(".")
      ? [symbol]
      : [symbol, `${symbol}.NS`, `${symbol}.BO`];
    let row: Awaited<ReturnType<typeof fetchSnapshotRow>> = null;
    for (const cand of candidates) {
      row = await fetchSnapshotRow(cand);
      if (row) break;
    }
    if (!row) {
      return NextResponse.json(
        { error: `Ticker ${symbol} not found in the latest snapshot` },
        { status: 404 },
      );
    }

    const analysis: TickerAnalysis = {
      ticker: row.ticker,
      signal: row.tech_signal ?? "HOLD",
      confidence: row.tech_confidence ?? 0,
      price: row.price ?? 0,
      quantamental: {
        blended_score: row.qm_score ?? 0,
        blended_rating: (row.qm_rating ?? "N/A") as TickerAnalysis["quantamental"]["blended_rating"],
        technical_score: row.tech_score ?? 0,
        technical_confidence: row.tech_confidence ?? 0,
        technical_signal: row.tech_signal ?? "HOLD",
        fundamental_score: row.fund_score ?? 0,
        fundamental_rating: row.fund_rating ?? "N/A",
        sentiment_score: 0,
        sentiment_label: "N/A",
        sentiment_article_count: 0,
        market_cap_category: row.cap_category ?? "mid",
        weights: {},
        weight_adjustments: [],
        evidence: { technical: [], fundamental: [] },
      },
      // Engine-only sections (Python analysis) — empty in deployed mode
      market_structure: {},
      trend: {},
      support_resistance: {},
      indicators: {},
      candlestick: {},
      divergence: [],
      wyckoff: {},
      gann: {},
      sentiment: {},
      fundamentals: {},
      chart_url: null,
      report_text: null,
      cached: row.cached ?? true,
      cached_at: row.last_analyzed ?? null,
    };

    // Merge engine-only sections from the local Python backend when reachable
    // (owner's Mac). This is what makes pattern geometry + convolution reach
    // the page in supabase data mode; deployed mode degrades gracefully.
    const engine = await fetchEngineSections(row.ticker);
    if (engine) {
      Object.assign(analysis, engine);
    }

    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stock data fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
