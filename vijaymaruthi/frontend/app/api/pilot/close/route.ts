import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  pilotConfigured,
  getPilotState,
  getPilotTrades,
  updatePilotTrade,
  updatePilotState,
} from "@/lib/pilot/db";
import { buildSnapshot } from "../state/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/pilot/close
 *
 * Manually closes an OPEN position at its current marked price (or entry if
 * no price is available). Body: { id: string }
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!pilotConfigured()) return notConfigured();

  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const [state, trades] = await Promise.all([
      getPilotState(user.id),
      getPilotTrades(user.id),
    ]);
    if (!state) {
      return NextResponse.json({ error: "Auto Pilot not started." }, { status: 422 });
    }

    const trade = trades.find((t) => t.id === body.id && t.status === "OPEN");
    if (!trade) {
      return NextResponse.json({ error: "Open position not found" }, { status: 404 });
    }

    const price = trade.currentPrice ?? trade.entry;
    const pnl = (price - trade.entry) * trade.quantity;
    const pnlPct = trade.notional > 0 ? (pnl / trade.notional) * 100 : 0;

    await updatePilotTrade(user.id, trade.id, {
      status: "CLOSED",
      closeReason: "manual",
      currentPrice: price,
      pnl,
      pnlPct,
      closeDate: new Date().toISOString(),
    });

    // Return the closed notional to cash.
    const openNotional = trades
      .filter((t) => t.status === "OPEN" && t.id !== trade.id)
      .reduce((sum, t) => sum + t.notional, 0);
    const realizedPnl = trades
      .filter((t) => t.status === "CLOSED")
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const availableCash = Math.max(0, state.capital - openNotional + realizedPnl + pnl);
    await updatePilotState(user.id, { availableCash });

    const finalTrades = await getPilotTrades(user.id);
    const snapshot = buildSnapshot(await getPilotState(user.id), finalTrades);
    return NextResponse.json({ snapshot });
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
  const message = err instanceof Error ? err.message : "Auto Pilot close failed";
  return NextResponse.json({ error: message }, { status: 500 });
}
