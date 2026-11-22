import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { fetchFundamentalsRow, fetchSnapshotRow, supabaseConfigured } from "@/lib/supabase";
import type { FundamentalsData } from "@/lib/types";

// Never statically optimize — the Mac backfill refreshes data each sync
export const dynamic = "force-dynamic";

/**
 * GET /api/fundamentals/:symbol
 *
 * Same-origin proxy for the Convolution / fundamentals panel in "supabase"
 * data mode. Serves the NORMALIZED snapshot that the Mac stored (same shape
 * and 0-100 score as the Python engine's /api/v1/fundamentals response).
 *
 * Tickers are stored with .NS/.BO suffixes; this route tries the exact
 * symbol first, then bare + .NS and bare + .BO, so callers passing either
 * "TBZ" or "TBZ.NS" get the same row.
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

  // ── 2. Fetch the stored normalized snapshot ──
  try {
    const bare = symbol.replace(/\.(NS|BO)$/i, "");
    const candidates = [...new Set([symbol, bare, `${bare}.NS`, `${bare}.BO`])];

    for (const candidate of candidates) {
      const row = await fetchFundamentalsRow(candidate);
      if (!row) continue;
      // Defensive: jsonb may come back as an object OR as a JSON string.
      let data: Record<string, unknown>;
      if (typeof row.data === "string") {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } else {
        data = row.data;
      }
      if (Object.keys(data).length > 0) {
        return NextResponse.json(data as unknown as FundamentalsData);
      }
    }

    // ── Fallback: no detailed fundamentals row stored. Serve the snapshot's
    //    fundamental score + rating so the tab is never empty. ──
    for (const candidate of candidates) {
      const snap = await fetchSnapshotRow(candidate);
      if (snap && (snap.fund_score != null || snap.fund_rating != null)) {
        return NextResponse.json({
          ticker: snap.ticker,
          name: snap.ticker.replace(/\.(NS|BO)$/i, ""),
          sector: "",
          industry: "",
          fundamental_score: snap.fund_score ?? 0,
          analyst_recommendation: snap.fund_rating ?? "N/A",
        } as unknown as FundamentalsData);
      }
    }

    return NextResponse.json(
      { error: `No fundamentals stored for ${symbol} (Mac report backfill may not cover it)` },
      { status: 404 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fundamentals fetch failed";
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
