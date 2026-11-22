import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  pilotConfigured,
  getPilotState,
  getPilotTrades,
  updatePilotTrade,
  updatePilotState,
} from "@/lib/pilot/db";
import { markToMarket } from "@/lib/pilot/engine";
import { buildSnapshot } from "../state/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/pilot/refresh
 *
 * Pulls the latest NSE price for every OPEN position (live backend price,
 * falling back to the last OHLCV close), updates P&L, and squares positions
 * that hit target1 (take-profit) or stop-loss. Returns the updated snapshot.
 */
export async function POST(request: Request) {
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

    if (!state) {
      return NextResponse.json(
        { error: "Auto Pilot not started. Click Start to begin." },
        { status: 422 },
      );
    }

    const { trades: updated, priceSource } = await markToMarket(trades);

    // Persist the updated trades.
    for (const t of updated) {
      await updatePilotTrade(user.id, t.id, {
        currentPrice: t.currentPrice,
        pnl: t.pnl,
        pnlPct: t.pnlPct,
        status: t.status,
        closeReason: t.closeReason,
        closeDate: t.closeDate,
      });
    }

    // Reconcile available cash: when a position closes, its notional returns
    // to cash (plus/minus realized P&L).
    const openNotional = updated
      .filter((t) => t.status === "OPEN")
      .reduce((sum, t) => sum + t.notional, 0);
    const realizedPnl = updated
      .filter((t) => t.status === "CLOSED")
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const availableCash = Math.max(0, state.capital - openNotional + realizedPnl);
    await updatePilotState(user.id, { availableCash });

    const finalTrades = await getPilotTrades(user.id);
    const snapshot = buildSnapshot(await getPilotState(user.id), finalTrades);
    snapshot.lastPriceSource = priceSource;
    return NextResponse.json({ snapshot, priceSource });
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
  const message = err instanceof Error ? err.message : "Auto Pilot refresh failed";
  return NextResponse.json({ error: message }, { status: 500 });
}
