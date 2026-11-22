import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  pilotConfigured,
  getPilotState,
  getPilotTrades,
  upsertPilotState,
  insertPilotTrades,
  deletePilotTrades,
} from "@/lib/pilot/db";
import {
  DEFAULT_CAPITAL,
  DEFAULT_TOP_N,
  selectCandidates,
  computeTargetsForTicker,
  buildOpenTrades,
} from "@/lib/pilot/engine";
import { buildSnapshot } from "../state/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/pilot/start
 *
 * Initializes (or resets) the Auto Pilot with ₹1,00,000 capital, auto-selects
 * the top-N BUY-scored tickers from the app's snapshot, computes real
 * entry/target/stop from OHLCV, and opens equal-weight paper positions.
 *
 * Body: { topN?: number }  (default 8)
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!pilotConfigured()) return notConfigured();

  try {
    const body = (await request.json().catch(() => ({}))) as { topN?: number };
    const topN = Math.min(20, Math.max(1, body.topN ?? DEFAULT_TOP_N));

    // 1. Reset any existing pilot state + trades.
    await deletePilotTrades(user.id);
    const state = await upsertPilotState(user.id, {
      capital: DEFAULT_CAPITAL,
      availableCash: DEFAULT_CAPITAL,
    });

    // 2. Select top BUY candidates.
    const candidates = await selectCandidates(topN);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "No BUY-scored tickers found in the snapshot. Run a scan first." },
        { status: 422 },
      );
    }

    // 3. Compute real entry/target/stop for each candidate. Prefers the real
    //    analysis engine's levels from the snapshot; falls back to local
    //    computation only when the snapshot has none.
    const tradable: Array<typeof candidates[number] & { entry: number; target1: number; stopLoss: number }> = [];
    const skipped: string[] = [];
    for (const c of candidates) {
      const targets = await computeTargetsForTicker(c.ticker, "BUY", c.price, {
        entryLow: c.entryLow,
        entryHigh: c.entryHigh,
        target1: c.target1,
        stopLoss: c.stopLoss,
      });
      if (targets) {
        tradable.push({ ...c, ...targets });
      } else {
        skipped.push(c.ticker);
      }
    }

    if (tradable.length === 0) {
      return NextResponse.json(
        { error: "Could not compute entry/exit for any candidate (no OHLCV data)." },
        { status: 422 },
      );
    }

    // 4. Open equal-weight positions.
    const openTrades = buildOpenTrades(tradable, state.availableCash);
    const inserted = await insertPilotTrades(user.id, openTrades);

    // 5. Update available cash to reflect allocated notional.
    const allocated = inserted.reduce((sum, t) => sum + t.notional, 0);
    const newCash = Math.max(0, state.availableCash - allocated);
    await upsertPilotState(user.id, { capital: state.capital, availableCash: newCash });

    const trades = await getPilotTrades(user.id);
    const snapshot = buildSnapshot(await getPilotState(user.id), trades);
    return NextResponse.json({ snapshot, opened: inserted.length, skipped });
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
  const message = err instanceof Error ? err.message : "Auto Pilot start failed";
  return NextResponse.json({ error: message }, { status: 500 });
}
