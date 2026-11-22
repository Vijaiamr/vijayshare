import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  pilotConfigured,
  deletePilotState,
  deletePilotTrades,
} from "@/lib/pilot/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/pilot/reset
 *
 * Clears all pilot trades and resets capital to ₹1,00,000. The pilot is
 * stopped (no open positions) until the user clicks Start again.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!pilotConfigured()) return notConfigured();

  try {
    await deletePilotTrades(user.id);
    await deletePilotState(user.id);
    return NextResponse.json({ snapshot: { state: null, trades: [], totalPnl: 0, totalPnlPct: 0, openCount: 0, closedCount: 0, winRate: null, lastMarkedAt: null, lastPriceSource: null } });
  } catch (err) {
    return errorResponse(err);
  }
}

function notConfigured() {
  return NextResponse.json(
    { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
    { status: 503 },
  );
}

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Auto Pilot reset failed";
  return NextResponse.json({ error: message }, { status: 500 });
}
