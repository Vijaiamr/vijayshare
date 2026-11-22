/**
 * Auto Pilot — core engine (server-side).
 *
 * Shared logic used by the /api/pilot/* route handlers:
 *   - selectCandidates(): pick the top BUY-scored tickers from the snapshot.
 *   - openPositions(): compute real entry/target/stop from OHLCV + open paper
 *     positions with equal-weight notional split.
 *   - markToMarket(): pull the latest NSE price per open position, update P&L,
 *     and square positions that hit target1 (take-profit) or stop-loss.
 */

import { fetchAllSnapshotRows } from "@/lib/supabase";
import { fetchOhlcvRow } from "@/lib/supabase";
import { computePilotTargets } from "@/lib/pilot/intelligence";
import { fetchLivePriceFromBackend, fetchRealEngineLevels, lastCloseFromOhlcv } from "@/lib/pilot/livePrice";
import type { PilotCandidate, PilotTrade } from "@/lib/pilot/types";

export const DEFAULT_CAPITAL = 100000;
export const DEFAULT_TOP_N = 8;

/** Shape of a snapshot row (subset used by the pilot). */
interface SnapshotRowLike {
  ticker: string | null;
  qm_score: number | null;
  tech_signal: string | null;
  qm_rating: string | null;
  price: number | null;
  fund_score: number | null;
  fund_rating: string | null;
  // Real-engine trade levels (from _classify_signal) — the pilot trades on
  // the SAME analysis engine as the rest of the platform when these are set.
  entry_low: number | null;
  entry_high: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  stop_loss: number | null;
}

/** Parse the jsonb candles column (may be an array or a JSON string). */
function parseCandles(raw: unknown): Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }> {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr as Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
}

/**
 * Select the top-N BUY-scored tickers from the latest snapshot.
 *
 * The pilot is a paper-trading engine, so it should only open positions in
 * stocks that are BOTH technically strong AND fundamentally sound — not just
 * high technical momentum. We therefore require:
 *   • tech_signal = BUY / Strong Buy (technical green light)
 *   • fund_rating = Buy / Strong Buy (fundamental green light)
 *   • fund_score >= 60 (a minimum fundamental quality bar)
 * and sort by the blended qm_score (which already fuses tech + fundamentals).
 */
export async function selectCandidates(topN = DEFAULT_TOP_N): Promise<PilotCandidate[]> {
  const rows = (await fetchAllSnapshotRows()) as SnapshotRowLike[];
  const buySignals = new Set(["BUY", "STRONG BUY", "STRONG_BUY", "Strong Buy"]);
  const buyFundRatings = new Set(["BUY", "STRONG BUY", "STRONG_BUY", "Strong Buy", "CAN BUY"]);
  const MIN_FUND_SCORE = 60;

  return rows
    .filter((r) => r.ticker && buySignals.has((r.tech_signal ?? "").toUpperCase()))
    .filter((r) => buyFundRatings.has((r.fund_rating ?? "").toUpperCase()))
    .filter((r) => (r.fund_score ?? 0) >= MIN_FUND_SCORE)
    .map((r) => ({
      ticker: r.ticker as string,
      qmScore: r.qm_score ?? 0,
      techSignal: r.tech_signal ?? "BUY",
      qmRating: r.qm_rating ?? "N/A",
      price: r.price ?? null,
      fundScore: r.fund_score ?? null,
      fundRating: r.fund_rating ?? null,
      // Real-engine trade levels (may be null if the snapshot predates the
      // 2026-09-04 schema change — the pilot falls back to local computation).
      entryLow: r.entry_low ?? null,
      entryHigh: r.entry_high ?? null,
      target1: r.target1 ?? null,
      target2: r.target2 ?? null,
      target3: r.target3 ?? null,
      stopLoss: r.stop_loss ?? null,
    }))
    .sort((a, b) => b.qmScore - a.qmScore)
    .slice(0, topN);
}

/**
 * Compute real entry/target/stop for a ticker.
 *
 * Priority (all use the SAME analysis engine's quality standards):
 *   1. Backend `/api/v1/analyze` — the real `_classify_signal` output, live.
 *   2. Real-engine levels stored on the Supabase snapshot row (from the Mac
 *      sync of the same `_classify_signal` output).
 *   3. Local S/R + ATR computation with the degenerate-trade guard (safety
 *      net when neither the backend nor the snapshot has real-engine levels).
 *
 * Returns null when no usable levels can be determined (ticker skipped).
 */
export async function computeTargetsForTicker(
  ticker: string,
  signal: "BUY" | "HOLD" | "SELL",
  fallbackPrice?: number | null,
  realLevels?: { entryLow: number | null; entryHigh: number | null; target1: number | null; stopLoss: number | null },
): Promise<{ entry: number; target1: number; stopLoss: number; currentPrice: number } | null> {
  // 1. Fetch the LIVE price first — this is the real market price we should
  //    open at, not the stale OHLCV close or snapshot price.
  let livePrice: number | null = null;
  try {
    const live = await fetchLivePriceFromBackend(ticker);
    if (live?.price && isFinite(live.price)) livePrice = live.price;
  } catch { /* ignore */ }

  // 2. PRIMARY: the real analysis engine's levels from the backend
  //    `/api/v1/analyze` endpoint (the SAME _classify_signal the platform
  //    uses). This is the strongest source — live, and independent of the
  //    Supabase snapshot schema.
  const backendLevels = await fetchRealEngineLevels(ticker);
  if (
    backendLevels &&
    isFinite(backendLevels.target1 ?? NaN) &&
    isFinite(backendLevels.stopLoss ?? NaN) &&
    (backendLevels.target1 ?? 0) > 0 &&
    (backendLevels.stopLoss ?? 0) > 0
  ) {
    const entry = livePrice ?? fallbackPrice ?? backendLevels.entryLow ?? backendLevels.entryHigh ?? 0;
    if (entry <= 0) return null;
    return {
      entry,
      target1: backendLevels.target1 as number,
      stopLoss: backendLevels.stopLoss as number,
      currentPrice: entry,
    };
  }

  // 3. SECONDARY: real-engine levels stored on the Supabase snapshot row.
  if (
    realLevels &&
    isFinite(realLevels.target1 ?? NaN) &&
    isFinite(realLevels.stopLoss ?? NaN) &&
    (realLevels.target1 ?? 0) > 0 &&
    (realLevels.stopLoss ?? 0) > 0
  ) {
    const entry = livePrice ?? fallbackPrice ?? realLevels.entryLow ?? realLevels.entryHigh ?? 0;
    if (entry <= 0) return null;
    return {
      entry,
      target1: realLevels.target1 as number,
      stopLoss: realLevels.stopLoss as number,
      currentPrice: entry,
    };
  }

  // 4. TERTIARY: fetch OHLCV and compute locally (only when neither the
  //    backend nor the snapshot has real-engine levels). The local path has
  //    the degenerate-trade guard, so it never emits a structurally broken
  //    trade.
  let candles: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }> = [];
  try {
    const row = await fetchOhlcvRow(ticker);
    candles = parseCandles(row?.candles);
  } catch {
    candles = [];
  }

  if (candles.length === 0) {
    // No OHLCV — cannot compute real targets. Skip this ticker.
    return null;
  }

  // 5. Use the live price as the current price. Fall back to snapshot/OHLCV
  //    close only when live is unavailable.
  const currentPrice = livePrice ?? fallbackPrice ?? candles[candles.length - 1].close;
  const targets = computePilotTargets(candles, signal, currentPrice);

  // Guard against degenerate targets (all equal to current price).
  if (
    !isFinite(targets.entry) ||
    !isFinite(targets.target1) ||
    !isFinite(targets.stopLoss) ||
    targets.entry <= 0 ||
    targets.target1 <= 0 ||
    targets.stopLoss <= 0
  ) {
    return null;
  }

  return {
    entry: targets.entry,
    target1: targets.target1,
    stopLoss: targets.stopLoss,
    currentPrice,
  };
}

/**
 * Open paper positions for the given candidates with equal-weight notional
 * split of the available cash. Returns the trades to insert.
 */
export function buildOpenTrades(
  candidates: Array<PilotCandidate & { entry: number; target1: number; stopLoss: number }>,
  availableCash: number,
): Array<Omit<PilotTrade, "id" | "openDate" | "closeDate" | "createdAt" | "updatedAt">> {
  if (candidates.length === 0 || availableCash <= 0) return [];
  const perTrade = availableCash / candidates.length;
  return candidates.map((c) => {
    const quantity = Math.max(1, Math.floor(perTrade / c.entry));
    const notional = quantity * c.entry;
    return {
      ticker: c.ticker,
      direction: "BUY" as const,
      entry: c.entry,
      target1: c.target1,
      stopLoss: c.stopLoss,
      quantity,
      notional,
      qmScore: c.qmScore,
      techSignal: c.techSignal,
      fundScore: c.fundScore,
      fundRating: c.fundRating,
      status: "OPEN" as const,
      closeReason: null,
      currentPrice: c.entry,
      pnl: 0,
      pnlPct: 0,
    };
  });
}

/**
 * Mark every OPEN position to market against the latest NSE price and square
 * positions that hit target1 (take-profit) or stop-loss.
 *
 * Returns { trades, priceSource } where `trades` is the full updated list and
 * `priceSource` describes the live-price source used.
 */
export async function markToMarket(
  trades: PilotTrade[],
): Promise<{ trades: PilotTrade[]; priceSource: string | null }> {
  const open = trades.filter((t) => t.status === "OPEN");
  if (open.length === 0) return { trades, priceSource: null };

  const updated: PilotTrade[] = [];
  let priceSource: string | null = null;

  for (const t of open) {
    // 1. Try the live backend price.
    let live = await fetchLivePriceFromBackend(t.ticker);
    let price = live?.price ?? null;
    let source = live?.source ?? null;

    // 2. Fallback: last OHLCV close.
    if (price === null) {
      try {
        const row = await fetchOhlcvRow(t.ticker);
        const candles = parseCandles(row?.candles);
        const fallback = lastCloseFromOhlcv(candles);
        if (fallback) {
          price = fallback.price;
          source = fallback.source;
        }
      } catch {
        // ignore
      }
    }

    if (price === null || !isFinite(price)) {
      // No price available — leave the position as-is.
      updated.push(t);
      continue;
    }
    if (source) priceSource = source;

    // Compute P&L (long only).
    const pnl = (price - t.entry) * t.quantity;
    const pnlPct = t.notional > 0 ? (pnl / t.notional) * 100 : 0;

    // Check take-profit / stop-loss.
    let status: "OPEN" | "CLOSED" = "OPEN";
    let closeReason: PilotTrade["closeReason"] = null;
    let closeDate: string | null = null;
    if (price >= t.target1) {
      status = "CLOSED";
      closeReason = "take-profit";
      closeDate = new Date().toISOString();
    } else if (price <= t.stopLoss) {
      status = "CLOSED";
      closeReason = "stop-loss";
      closeDate = new Date().toISOString();
    }

    updated.push({
      ...t,
      currentPrice: price,
      pnl,
      pnlPct,
      status,
      closeReason,
      closeDate,
    });
  }

  // Merge back: updated open positions + untouched closed positions.
  const closed = trades.filter((t) => t.status === "CLOSED");
  const merged = [...closed, ...updated];
  return { trades: merged, priceSource };
}
