import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { pilotConfigured, getPilotState, getPilotTrades, PilotSchemaError } from "@/lib/pilot/db";
import type { PilotSnapshot, PilotTrade } from "@/lib/pilot/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/pilot/state
 *
 * Returns the user's Auto Pilot state: capital, available cash, all trades
 * (open + closed), and aggregate P&L / win-rate.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!pilotConfigured()) return notConfigured();

  try {
    const [state, trades] = await Promise.all([
      getPilotState(user.id),
      getPilotTrades(user.id),
    ]);
    return NextResponse.json(buildSnapshot(state, trades));
  } catch (err) {
    return errorResponse(err);
  }
}

export function buildSnapshot(
  state: Awaited<ReturnType<typeof getPilotState>>,
  trades: PilotTrade[],
): PilotSnapshot {
  const open = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status === "CLOSED");

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const capital = state?.capital ?? 100000;
  const totalPnlPct = capital > 0 ? (totalPnl / capital) * 100 : 0;

  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;

  const lastMarked = trades
    .map((t) => t.updatedAt)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return {
    state,
    trades,
    totalPnl,
    totalPnlPct,
    winRate,
    openCount: open.length,
    closedCount: closed.length,
    lastMarkedAt: lastMarked,
    lastPriceSource: null,
  };
}

function notConfigured() {
  return NextResponse.json(
    { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
    { status: 503 },
  );
}

function errorResponse(err: unknown) {
  if (err instanceof PilotSchemaError) {
    return NextResponse.json(
      { error: "Auto Pilot tables not created. Run sync/auto_pilot_schema.sql in the Supabase SQL Editor.", schemaRequired: true },
      { status: 503 },
    );
  }
  const message = err instanceof Error ? err.message : "Auto Pilot request failed";
  return NextResponse.json({ error: message }, { status: 500 });
}
