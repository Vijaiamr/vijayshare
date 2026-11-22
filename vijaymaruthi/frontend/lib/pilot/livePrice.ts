/**
 * Auto Pilot — live price source.
 *
 * Fetches the latest NSE price for a ticker. Priority:
 *   1. The deployed Python backend `/last-price/{ticker}` (yfinance live NSE
 *      price) — works on both localhost and the deployed app.
 *   2. Fallback: the last close of the OHLCV series (from Supabase snapshot
 *      or the backend /ohlcv endpoint).
 *
 * This module is server-only (imported by route handlers). The browser never
 * talks to the Python backend directly.
 */

const BACKEND_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8765/api/v1").replace(/\/+$/, "");

export interface LivePriceResult {
  price: number | null;
  source: string;
  time: string | null;
}

const FETCH_TIMEOUT = 20_000;

async function fetchWithTimeout(url: string, timeout = FETCH_TIMEOUT, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Try the deployed Python backend for a live price. Returns null on any
 * failure (network, timeout, non-200) so callers can fall back.
 */
export async function fetchLivePriceFromBackend(ticker: string): Promise<LivePriceResult | null> {
  try {
    const res = await fetchWithTimeout(`${BACKEND_BASE}/last-price/${encodeURIComponent(ticker)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: number | null; time?: string | null; source?: string };
    if (typeof data.price !== "number" || !isFinite(data.price)) return null;
    return {
      price: data.price,
      source: data.source ?? "backend",
      time: data.time ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Get the last close from an OHLCV series (fallback when the live backend is
 * unreachable). `candles` is the already-fetched series.
 */
export function lastCloseFromOhlcv(candles: Array<{ close: number; time?: string }>): LivePriceResult | null {
  const last = candles[candles.length - 1];
  if (!last || typeof last.close !== "number" || !isFinite(last.close)) return null;
  return { price: last.close, source: "ohlcv-close", time: last.time ?? null };
}

export interface RealEngineLevels {
  entryLow: number | null;
  entryHigh: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  stopLoss: number | null;
}

/**
 * Fetch the REAL analysis engine's trade levels (entry_zone / targets /
 * invalidation) from the backend `/api/v1/analyze` endpoint. This is the SAME
 * `_classify_signal` that the rest of the platform uses, so the pilot trades
 * on the same engine. Returns null on any failure (network, timeout, non-200,
 * missing levels) so callers can fall back to the snapshot or local compute.
 */
export async function fetchRealEngineLevels(ticker: string): Promise<RealEngineLevels | null> {
  try {
    const res = await fetchWithTimeout(`${BACKEND_BASE}/analyze`, 30_000, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, period: "1y", save_db: false }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      entry_zone?: Array<number | null> | null;
      targets?: Array<number | null> | null;
      invalidation?: number | null;
    };
    const entryZone = Array.isArray(data.entry_zone) ? data.entry_zone : [];
    const targets = Array.isArray(data.targets) ? data.targets : [];
    const stop = data.invalidation ?? null;
    // Require a usable target + stop (the guard in _classify_signal guarantees
    // these are non-degenerate when present).
    const t1 = targets[0] ?? null;
    if (t1 === null || t1 <= 0 || stop === null || stop <= 0) return null;
    return {
      entryLow: entryZone[0] ?? null,
      entryHigh: entryZone[1] ?? null,
      target1: t1,
      target2: targets[1] ?? null,
      target3: targets[2] ?? null,
      stopLoss: stop,
    };
  } catch {
    return null;
  }
}
