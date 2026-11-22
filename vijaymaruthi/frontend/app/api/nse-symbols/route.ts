import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { supabaseConfigured } from "@/lib/supabase";

// Never statically optimize — the snapshot changes every time the Mac syncs
export const dynamic = "force-dynamic";

/**
 * GET /api/nse-symbols
 *
 * Same-origin proxy for the NSE symbol autocomplete list in "supabase" data
 * mode. The local FastAPI backend (which served /nse-symbols) is not deployed,
 * so we return the real ticker list from the latest portfolio_snapshot pushed
 * by the Mac cron sync.
 *
 * Authorization mirrors /api/dashboard: valid Supabase session with an
 * APPROVED profile, or the shared APP_TOKEN (?token=...).
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  try {
    const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/portfolio_snapshot?select=ticker&order=ticker.asc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cache: "no-store" },
    );
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Supabase ${res.status}: ${body.slice(0, 200)}` }, { status: 502 });
    }
    const rows = (await res.json()) as { ticker: string }[];
    const symbols = rows.map((r) => r.ticker).filter(Boolean);
    return NextResponse.json({ total: symbols.length, symbols });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Symbols fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
