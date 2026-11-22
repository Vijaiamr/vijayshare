import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { fetchDashboardSnapshot, supabaseConfigured } from "@/lib/supabase";

// Never statically optimize — data changes every time the Mac syncs
export const dynamic = "force-dynamic";

const ENGINE_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8765/api/v1";
const ENGINE_TIMEOUT_MS = 8000;

/**
 * Enrich dashboard rows with engine-detected chart patterns (Tier 2).
 *
 * The dashboard snapshot (Supabase) does not store pattern data. When the
 * local Python engine is reachable we fetch the backend dashboard (which
 * already enriches every row from the analysis cache — fast, no fresh runs)
 * and merge its pattern summaries into the snapshot rows by ticker. In
 * deployed mode the backend does not exist, so rows keep their snapshot
 * shape — never fabricated data.
 */
async function enrichWithPatterns(rows: any[]): Promise<any[]> {
  if (!rows || rows.length === 0) return rows;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
    try {
      const res = await fetch(`${ENGINE_BASE}/dashboard?force=0`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return rows;
      const data = await res.json();
      const byTicker = new Map<string, any[]>();
      for (const row of data.rows ?? []) {
        byTicker.set(row.ticker, row.detected_patterns ?? []);
      }
      return rows.map((r) => ({
        ...r,
        detected_patterns: byTicker.get(r.ticker) ?? [],
      }));
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return rows; // backend unreachable (deployed mode) — degrade gracefully
  }
}

/**
 * GET /api/dashboard
 *
 * Server-side proxy: reads the dashboard snapshot from Supabase using the
 * service role key (stays server-side) and returns the same JSON shape as
 * the FastAPI /dashboard endpoint.
 *
 * Authorization (defense in depth) — see lib/server-auth.ts:
 *   1. A valid Supabase session (browser cookie) — the normal path — AND the
 *      user's profile must be approved by an admin.
 *   2. OR the shared APP_TOKEN (?token=...) — used only for external
 *      monitoring/scripts, never by the browser anymore.
 */
export async function GET(request: Request) {
  // ── 1. Authenticate / authorize ──
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  // ── 2. Fetch ──
  try {
    const data = await fetchDashboardSnapshot();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const enriched = await enrichWithPatterns(rows);
    return NextResponse.json({ ...data, rows: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dashboard fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
