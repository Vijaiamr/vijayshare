/**
 * Server-side Supabase REST client (no SDK needed).
 *
 * ⚠️ IMPORTANT: this module reads SUPABASE_SERVICE_ROLE_KEY which has FULL
 * database access. Only import it from Next.js route handlers / server
 * code — never from client components or "use client" files.
 */

import type { DashboardResponse, DashboardRow, Rating } from "./types";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

interface RawSnapshotRow {
  ticker: string;
  price: number | null;
  qm_rating: string | null;
  qm_score: number | null;
  tech_signal: string | null;
  tech_confidence: number | null;
  tech_score: number | null;
  fund_rating: string | null;
  fund_score: number | null;
  cap_category: string | null;
  trend: string | null;
  score_change: number | null;
  last_analyzed: string | null;
  history_runs: number | null;
  health_pass: boolean | null;
  rank: number | null;
  cached: boolean | null;
  // Real-engine trade levels (from _classify_signal) — used by the Auto Pilot
  // so it trades on the same analysis engine as the rest of the platform.
  entry_low: number | null;
  entry_high: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  stop_loss: number | null;
}

interface MetaRow {
  key: string;
  value: string;
}

const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function supabaseGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: HEADERS,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Generic PostgREST request (GET/POST/PATCH/DELETE) for write routes
 * (drawings, layouts, alerts). Returns the parsed JSON body.
 */
export async function supabaseRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  // PostgREST returns 201/204 with an EMPTY body for writes using the
  // default `Prefer: return=minimal` — only parse when there is a body.
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * Fetch a single snapshot row for one ticker (used by the /api/stock proxy).
 * Returns null when the ticker is not present in the latest snapshot.
 */
export async function fetchSnapshotRow(ticker: string): Promise<RawSnapshotRow | null> {
  const rows = await supabaseGet<RawSnapshotRow[]>(
    `portfolio_snapshot?select=*&ticker=eq.${encodeURIComponent(ticker)}&limit=1`,
  );
  return rows[0] ?? null;
}

/** One row of the `ohlcv` table (5y candles precomputed by the Mac backfill).
 *  jsonb is normally parsed; older backfills stored it as a JSON string. */
export interface OhlcvRow {
  candles: unknown[] | string;
}

/**
 * Fetch the precomputed candle series for a ticker (used by /api/ohlcv proxy).
 * The whole 5y series lives in one jsonb column; the route slices per period.
 */
export async function fetchOhlcvRow(ticker: string): Promise<OhlcvRow | null> {
  const rows = await supabaseGet<OhlcvRow[]>(
    `ohlcv?select=candles&ticker=eq.${encodeURIComponent(ticker)}&limit=1`,
  );
  return rows[0] ?? null;
}

/** One row of the `ohlcv_intraday` table (intraday candles precomputed by the
 *  Mac backfill, one row per (ticker, interval)). */
export interface OhlcvIntradayRow {
  candles: unknown[] | string;
}

/**
 * Fetch the precomputed intraday candle series for a ticker+interval
 * (used by /api/ohlcv proxy when the chart requests an intraday timeframe).
 * Returns null when the pair is not present (caller falls back to daily).
 */
export async function fetchOhlcvIntradayRow(
  ticker: string,
  interval: string,
): Promise<OhlcvIntradayRow | null> {
  const rows = await supabaseGet<OhlcvIntradayRow[]>(
    `ohlcv_intraday?select=candles&ticker=eq.${encodeURIComponent(ticker)}&interval=eq.${encodeURIComponent(interval)}&limit=1`,
  );
  return rows[0] ?? null;
}

/** One row of the `fundamentals` table (normalized snapshot from the Mac).
 *  jsonb is normally parsed; older backfills stored it as a JSON string. */
export interface FundamentalsRow {
  data: Record<string, unknown> | string;
}

/**
 * Fetch the normalized fundamental snapshot for a ticker
 * (used by /api/fundamentals proxy).
 */
export async function fetchFundamentalsRow(ticker: string): Promise<FundamentalsRow | null> {
  const rows = await supabaseGet<FundamentalsRow[]>(
    `fundamentals?select=data&ticker=eq.${encodeURIComponent(ticker)}&limit=1`,
  );
  return rows[0] ?? null;
}

/**
 * Fetch ALL snapshot rows via offset pagination.
 *
 * PostgREST caps every response at `db-max-rows` (default 1000 on Supabase),
 * so a single `limit=5000` request still only returns 1000 rows. We therefore
 * page through with `limit=1000&offset=...` until a short page comes back.
 * A total ORDER BY (qm_score desc + ticker tiebreak) keeps pages stable.
 */
export async function fetchAllSnapshotRows(): Promise<RawSnapshotRow[]> {
  const all: RawSnapshotRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const page = await supabaseGet<RawSnapshotRow[]>(
      `portfolio_snapshot?select=*&order=qm_score.desc.nullslast,ticker.asc&limit=${pageSize}&offset=${offset}`,
    );
    all.push(...page);
    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return all;
}

/** One row of the `fundamentals` table with only the sector/industry fields
 *  extracted from the jsonb `data` column (lightweight — no 3KB blob). */
export interface SectorRow {
  ticker: string;
  sector: string;
  industry: string;
}

/**
 * Fetch ticker → sector/industry mapping for the whole universe.
 *
 * Uses PostgREST jsonb extraction (`data->sector`) so we pull only the two
 * small strings per ticker instead of the full ~3KB fundamentals blob.
 * Paginates like fetchAllSnapshotRows (PostgREST caps at 1000 rows/page).
 */
export async function fetchAllSectors(): Promise<SectorRow[]> {
  const all: SectorRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const page = await supabaseGet<SectorRow[]>(
      `fundamentals?select=ticker,data->sector,data->industry&limit=${pageSize}&offset=${offset}`,
    );
    all.push(...page);
    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return all;
}

/**
 * Fetch the latest dashboard snapshot pushed by the Mac cron sync.
 * Shape matches the FastAPI /dashboard response so the frontend is unchanged.
 */
export async function fetchDashboardSnapshot(): Promise<DashboardResponse> {
  if (!supabaseConfigured()) {
    throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }

  const [rawRows, metaRows] = await Promise.all([
    fetchAllSnapshotRows(),
    supabaseGet<MetaRow[]>("sync_meta?select=key,value"),
  ]);

  const metaMap: Record<string, string> = Object.fromEntries(
    metaRows.map((m) => [m.key, m.value]),
  );

  const rows: DashboardRow[] = rawRows.map((r, i) => ({
    rank: r.rank ?? i + 1,
    ticker: r.ticker,
    qm_rating: (r.qm_rating ?? "N/A") as Rating,
    qm_score: r.qm_score ?? 0,
    tech_signal: r.tech_signal ?? "HOLD",
    tech_confidence: r.tech_confidence ?? 0,
    tech_score: r.tech_score ?? 0,
    fund_rating: r.fund_rating ?? "N/A",
    fund_score: r.fund_score ?? 0,
    cap_category: r.cap_category ?? "mid",
    price: r.price ?? 0,
    cached: r.cached ?? true,
    trend: (r.trend ?? "stable") as DashboardRow["trend"],
    score_change: r.score_change ?? 0,
    last_analyzed: r.last_analyzed ?? null,
    history_runs: r.history_runs ?? 0,
    health_pass: r.health_pass ?? null,
  }));

  const buys = rows.filter((r) => r.qm_rating === "Strong Buy" || r.qm_rating === "Buy").length;
  const holds = rows.filter((r) => r.qm_rating === "Hold").length;
  const sells = rows.filter((r) => r.qm_rating === "Sell" || r.qm_rating === "Strong Sell").length;

  return {
    rows,
    summary: { buy: buys, hold: holds, sell: sells, total: rows.length },
    db_entries: rows.length,
    total_nse_count: Number(metaMap.total_nse ?? 0),
    generated_at: metaMap.last_sync_at ?? new Date().toISOString(),
  };
}
