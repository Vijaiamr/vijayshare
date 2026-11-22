import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { ledgerConfigured, getSummary } from "@/lib/ledger/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/ledger/summary
 *
 * Aggregated spending summary for the authenticated user — powers the
 * "Spending Snapshot" widget on the home dashboard.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  try {
    const summary = await getSummary(user.id);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Summary fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}