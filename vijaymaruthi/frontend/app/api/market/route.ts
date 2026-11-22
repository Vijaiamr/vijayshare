import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  fetchAllSnapshotRows,
  fetchAllSectors,
  supabaseConfigured,
} from "@/lib/supabase";
import type {
  MarketIndex,
  MarketResponse,
  MarketTicker,
  SectorPhase,
  SectorStat,
} from "@/lib/types";

// Never statically optimize — data changes every time the Mac syncs
export const dynamic = "force-dynamic";

// ─── Live index quotes (Yahoo Finance chart API, 60s cache) ───

const INDEX_TICKERS: { symbol: string; name: string }[] = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^BSESN", name: "SENSEX" },
  { symbol: "^NSEBANK", name: "BANK NIFTY" },
];

let indicesCache: { at: number; data: MarketIndex[] } | null = null;
const INDICES_TTL_MS = 60_000;

async function fetchIndices(): Promise<MarketIndex[]> {
  if (indicesCache && Date.now() - indicesCache.at < INDICES_TTL_MS) {
    return indicesCache.data;
  }
  // Preserve INDEX_TICKERS order — build by position, not completion order.
  const out: (MarketIndex | null)[] = INDEX_TICKERS.map(() => null);
  await Promise.all(
    INDEX_TICKERS.map(async ({ symbol, name }, i) => {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
          { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
        );
        if (!res.ok) return;
        const json = await res.json();
        const meta = json?.chart?.result?.[0]?.meta;
        if (!meta) return;
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        if (typeof price !== "number" || typeof prev !== "number" || prev === 0) return;
        out[i] = {
          symbol,
          name,
          price,
          change_pct: ((price - prev) / prev) * 100,
          currency: meta.currency ?? "INR",
        };
      } catch {
        // One index failing must never break the whole market payload.
      }
    }),
  );
  const data = out.filter((x): x is MarketIndex => x !== null);
  indicesCache = { at: Date.now(), data };
  return data;
}

/**
 * GET /api/market
 *
 * Market-wide Sector Rotation / Relative Strength aggregation (Feature 1).
 *
 * This is the platform's first market-wide (cross-ticker) endpoint. It joins
 * two lightweight Supabase reads server-side:
 *   1. portfolio_snapshot — every analysed ticker with its blended QM score,
 *      technical score, fundamental score, rating, trend and score_change.
 *   2. fundamentals (jsonb sector/industry extraction) — maps each ticker to
 *      its GICS-style sector.
 *
 * It then computes, per sector:
 *   • avg_qm_score / avg_tech_score / avg_fund_score  — aggregate strength
 *   • buy_pct / improving_pct / deteriorating_pct     — breadth
 *   • rs_percentile (1-99)                            — relative strength rank
 *   • phase (Leading / Improving / Weakening / Lagging) — rotation classification
 *
 * Plus a market-wide breadth summary and a breakout ledger (top movers by
 * score_change).
 *
 * Authorization mirrors /api/dashboard: valid Supabase session with an
 * APPROVED profile, or the shared APP_TOKEN (?token=...).
 */

const BUY_RATINGS = new Set(["Strong Buy", "Buy"]);

/**
 * Classify a sector's rotation phase from a 2x2 matrix:
 *   • Strength axis — avg blended QM score vs the market-wide average
 *     (above = strong, below = weak).
 *   • Momentum axis — net breadth = improving% − deteriorating%
 *     (positive = improving, negative = weakening).
 *
 *   Strong + positive momentum → Leading   (confirmed uptrend)
 *   Weak   + positive momentum → Improving (early rotation in)
 *   Strong + negative momentum → Weakening (rolling over)
 *   Weak   + negative momentum → Lagging   (confirmed downtrend)
 */
function classifyPhase(
  avgScore: number,
  marketAvgScore: number,
  improvingPct: number,
  deterioratingPct: number,
): SectorPhase {
  const strong = avgScore >= marketAvgScore;
  const netBreadth = improvingPct - deterioratingPct;
  const positiveMomentum = netBreadth >= 0;

  if (strong && positiveMomentum) return "Leading";
  if (!strong && positiveMomentum) return "Improving";
  if (strong && !positiveMomentum) return "Weakening";
  return "Lagging";
}

export async function GET(request: Request) {
  // ── 1. Authenticate / authorize ──
  // Auth is only enforced in deployed (supabase) mode — local dev with the
  // FastAPI backend stays open for convenience (same rule as proxy.ts).
  if (process.env.NEXT_PUBLIC_DATA_MODE === "supabase") {
    const auth = await authenticate(request);
    if ("response" in auth) return auth.response;
  }

  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  // ── 2. Fetch snapshot + sector mapping in parallel ──
  try {
    const [snapshotRows, sectorRows] = await Promise.all([
      fetchAllSnapshotRows(),
      fetchAllSectors(),
    ]);

    // Build ticker → sector map (normalise .NS/.BO suffixes).
    const sectorByTicker = new Map<string, string>();
    for (const s of sectorRows) {
      const bare = s.ticker.replace(/\.(NS|BO)$/i, "");
      const sector = (s.sector ?? "").trim();
      if (sector) {
        sectorByTicker.set(bare, sector);
        sectorByTicker.set(s.ticker, sector);
      }
    }

    // ── 3. Build per-ticker market rows (only those with a known sector) ──
    const tickers: MarketTicker[] = [];
    for (const r of snapshotRows) {
      const bare = r.ticker.replace(/\.(NS|BO)$/i, "");
      const sector = sectorByTicker.get(bare) ?? sectorByTicker.get(r.ticker);
      if (!sector) continue; // no sector mapping → excluded from sector view
      tickers.push({
        ticker: r.ticker,
        qm_score: r.qm_score ?? 0,
        qm_rating: r.qm_rating ?? "N/A",
        tech_score: r.tech_score ?? 0,
        tech_signal: r.tech_signal ?? "HOLD",
        fund_score: r.fund_score ?? 0,
        trend: r.trend ?? "stable",
        score_change: r.score_change ?? 0,
        price: r.price ?? 0,
        cap_category: r.cap_category ?? "mid",
      });
    }

    // ── 4. Aggregate per sector ──
    const bySector = new Map<string, MarketTicker[]>();
    for (const t of tickers) {
      const bare = t.ticker.replace(/\.(NS|BO)$/i, "");
      const sector = sectorByTicker.get(bare) ?? sectorByTicker.get(t.ticker);
      if (!sector) continue;
      const arr = bySector.get(sector) ?? [];
      arr.push(t);
      bySector.set(sector, arr);
    }

    const sectors: SectorStat[] = [];
    // Market-wide average QM score (used as the strength threshold for phase).
    const marketAvgQm =
      tickers.length > 0
        ? tickers.reduce((s, t) => s + t.qm_score, 0) / tickers.length
        : 50;
    for (const [sector, members] of bySector) {
      const n = members.length;
      const avg = (key: keyof MarketTicker) =>
        members.reduce((s, m) => s + (m[key] as number), 0) / n;
      const buyPct =
        (members.filter((m) => BUY_RATINGS.has(m.qm_rating)).length / n) * 100;
      const improvingPct =
        (members.filter((m) => m.trend === "improving").length / n) * 100;
      const deterioratingPct =
        (members.filter((m) => m.trend === "deteriorating").length / n) * 100;
      const avgQm = avg("qm_score");
      const avgTech = avg("tech_score");
      const avgFund = avg("fund_score");

      sectors.push({
        sector,
        count: n,
        avg_qm_score: Math.round(avgQm * 10) / 10,
        avg_tech_score: Math.round(avgTech * 10) / 10,
        avg_fund_score: Math.round(avgFund * 10) / 10,
        buy_pct: Math.round(buyPct * 10) / 10,
        improving_pct: Math.round(improvingPct * 10) / 10,
        deteriorating_pct: Math.round(deterioratingPct * 10) / 10,
        rs_percentile: 0, // filled below
        phase: classifyPhase(avgQm, marketAvgQm, improvingPct, deterioratingPct),
        leaders: [...members]
          .sort((a, b) => b.qm_score - a.qm_score)
          .slice(0, 5),
      });
    }

    // ── 5. Relative-strength percentile (1-99) by avg_qm_score ──
    const sorted = [...sectors].sort((a, b) => b.avg_qm_score - a.avg_qm_score);
    const m = sorted.length;
    sorted.forEach((s, i) => {
      // Percentile of rank i (0-based) among m sectors → 1..99
      s.rs_percentile = m <= 1 ? 50 : Math.max(1, Math.min(99, Math.round(((m - i) / m) * 100)));
    });
    // Re-sort by RS percentile descending for the UI.
    sectors.sort((a, b) => b.rs_percentile - a.rs_percentile);

    // ── 6. Market-wide breadth ──
    const total = tickers.length;
    const buy = tickers.filter((t) => BUY_RATINGS.has(t.qm_rating)).length;
    const hold = tickers.filter((t) => t.qm_rating === "Hold").length;
    const sell = tickers.filter(
      (t) => t.qm_rating === "Sell" || t.qm_rating === "Strong Sell",
    ).length;
    const improving = tickers.filter((t) => t.trend === "improving").length;
    const deteriorating = tickers.filter((t) => t.trend === "deteriorating").length;
    const stable = tickers.filter((t) => t.trend === "stable").length;
    const avgQmAll =
      total > 0 ? tickers.reduce((s, t) => s + t.qm_score, 0) / total : 0;

    // ── 7. Breakout ledger: top movers by score_change ──
    const breakoutLedger = [...tickers]
      .sort((a, b) => b.score_change - a.score_change)
      .slice(0, 25);

    const response: MarketResponse = {
      generated_at: new Date().toISOString(),
      total_tickers: total,
      sectors,
      indices: await fetchIndices(),
      breadth: {
        total,
        buy,
        hold,
        sell,
        improving,
        deteriorating,
        stable,
        avg_qm_score: Math.round(avgQmAll * 10) / 10,
      },
      breakout_ledger: breakoutLedger,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Market fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
