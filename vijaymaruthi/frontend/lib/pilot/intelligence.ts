/**
 * Auto Pilot — intelligence layer.
 *
 * Computes REAL entry / target / stop-loss for a ticker from its OHLCV
 * candles, using the same S/R + ATR methodology the app's engine uses, then
 * feeds the result into `computePriceTargets` (lib/priceTargets.ts).
 *
 * This runs in the browser (or server) from the OHLCV series that the
 * backend /ohlcv endpoint returns — no heavy /analyze call needed, so it is
 * fast and reliable on both localhost and the deployed app.
 */

import type { OHLCVPoint } from "@/lib/types";
import { computePriceTargets, type PriceTargets } from "@/lib/priceTargets";

export interface SRLevel {
  price: number;
  strength?: string;
  distance_pct?: number;
}

export interface SupportResistance {
  support: SRLevel[];
  resistance: SRLevel[];
}

export interface ATRInfo {
  atr: number;
  percent_of_price: number;
}

/** True Range for one candle. */
function trueRange(prevClose: number, high: number, low: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * Wilder-smoothed ATR (14-period) — the standard used by the engine.
 * Returns the latest ATR value and its % of the latest close.
 */
export function computeATR(candles: OHLCVPoint[], period = 14): ATRInfo | null {
  if (candles.length < period + 1) return null;
  const closes = candles.map((c) => c.close);
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(trueRange(closes[i - 1], candles[i].high, candles[i].low));
  }
  // Wilder smoothing
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  const lastClose = closes[closes.length - 1];
  if (!lastClose) return null;
  return { atr, percent_of_price: (atr / lastClose) * 100 };
}

/**
 * Detect swing highs / lows using a simple fractal (pivot) method with a
 * lookback of `left` bars each side. Returns the most recent levels.
 */
function findSwings(candles: OHLCVPoint[], left = 3): { highs: SRLevel[]; lows: SRLevel[] } {
  const highs: SRLevel[] = [];
  const lows: SRLevel[] = [];
  for (let i = left; i < candles.length - left; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + left; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ price: c.high });
    if (isLow) lows.push({ price: c.low });
  }
  return { highs, lows };
}

/**
 * Build support/resistance levels from swing highs/lows, keeping the most
 * relevant (recent + clustered) levels around the current price.
 */
export function computeSupportResistance(
  candles: OHLCVPoint[],
  currentPrice: number,
): SupportResistance {
  const { highs, lows } = findSwings(candles, 3);
  const lastClose = currentPrice || candles[candles.length - 1]?.close || 0;

  // Cluster nearby levels (within 0.5% of each other) to reduce noise.
  const cluster = (levels: SRLevel[]): SRLevel[] => {
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const out: SRLevel[] = [];
    for (const lvl of sorted) {
      const existing = out.find((o) => Math.abs(o.price - lvl.price) / lvl.price < 0.005);
      if (existing) {
        existing.price = (existing.price + lvl.price) / 2;
      } else {
        out.push({ ...lvl });
      }
    }
    return out;
  };

  const support = cluster(lows)
    .filter((s) => s.price < lastClose)
    .sort((a, b) => b.price - a.price) // closest first
    .slice(0, 4)
    .map((s) => ({ ...s, distance_pct: ((lastClose - s.price) / lastClose) * 100 }));

  const resistance = cluster(highs)
    .filter((r) => r.price > lastClose)
    .sort((a, b) => a.price - b.price) // closest first
    .slice(0, 4)
    .map((r) => ({ ...r, distance_pct: ((r.price - lastClose) / lastClose) * 100 }));

  return { support, resistance };
}

/**
 * Compute real price targets for a ticker from its OHLCV candles.
 * Falls back to ATR-based defaults when S/R is unavailable.
 */
export function computePilotTargets(
  candles: OHLCVPoint[],
  signal: "BUY" | "HOLD" | "SELL",
  currentPrice?: number,
): PriceTargets {
  const price = currentPrice ?? candles[candles.length - 1]?.close ?? 0;
  const atr = computeATR(candles);
  const sr = computeSupportResistance(candles, price);
  return computePriceTargets(price, signal, sr, atr);
}
