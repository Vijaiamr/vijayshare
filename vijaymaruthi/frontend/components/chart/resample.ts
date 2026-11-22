// Candle transforms: weekly/monthly resampling, Heikin-Ashi, Renko.
// All transforms keep the OHLCVPoint shape so indicators/patterns can
// recompute on the transformed series (same as TradingView).

import type { OHLCVPoint } from "@/lib/types";

// ─── Date helpers ───

function parseDate(time: string): Date {
  // Accepts "YYYY-MM-DD" (and tolerates ISO datetime strings).
  const d = new Date(time.slice(0, 10) + "T00:00:00");
  return Number.isNaN(d.getTime()) ? new Date(time) : d;
}

/** ISO week key: YYYY-Www (Monday-start). */
function weekKey(time: string): string {
  const d = parseDate(time);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day + 3); // move to Thursday of this week
  const iso = d.toISOString().slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function monthKey(time: string): string {
  return time.slice(0, 7); // YYYY-MM
}

// ─── Generic resampler ───

function resample(candles: OHLCVPoint[], keyFn: (t: string) => string): OHLCVPoint[] {
  const out: OHLCVPoint[] = [];
  let current: OHLCVPoint | null = null;
  let currentKey = "";
  for (const c of candles) {
    const k = keyFn(c.time);
    if (!current || k !== currentKey) {
      if (current) out.push(current);
      current = { ...c };
      currentKey = k;
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
      current.volume += c.volume;
    }
  }
  if (current) out.push(current);
  return out;
}

export function resampleWeekly(candles: OHLCVPoint[]): OHLCVPoint[] {
  return resample(candles, weekKey);
}

export function resampleMonthly(candles: OHLCVPoint[]): OHLCVPoint[] {
  return resample(candles, monthKey);
}

// ─── Heikin-Ashi ───

export function toHeikinAshi(candles: OHLCVPoint[]): OHLCVPoint[] {
  const out: OHLCVPoint[] = [];
  let prevHaOpen = 0;
  let prevHaClose = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    out.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: c.volume });
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  return out;
}

// ─── Renko ───

/** ATR(14) — used as the default Renko brick size. */
export function atr14(candles: OHLCVPoint[]): number {
  if (candles.length < 2) return 0;
  const period = Math.min(14, candles.length - 1);
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const seed = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let prev = seed;
  for (let i = period; i < trs.length; i++) prev = (prev * (period - 1) + trs[i]) / period;
  return prev;
}

/**
 * Renko bricks from daily candles. Brick size defaults to ATR(14) so it
 * adapts to volatility. Each brick is emitted at the time of the candle
 * that closes it; volume accumulates across the candles inside a brick.
 */
export function toRenko(candles: OHLCVPoint[], brickSize?: number): OHLCVPoint[] {
  if (candles.length < 2) return candles;
  const brick = brickSize && brickSize > 0 ? brickSize : atr14(candles);
  if (!(brick > 0)) return candles;

  const out: OHLCVPoint[] = [];
  let level = candles[0].close;
  let accVol = 0;
  let lastTime = candles[0].time;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    accVol += c.volume;
    lastTime = c.time;
    const diff = c.close - level;
    const bricks = Math.floor(Math.abs(diff) / brick);
    if (bricks > 0) {
      const dir = diff > 0 ? 1 : -1;
      for (let b = 0; b < bricks; b++) {
        const open = level;
        const close = level + dir * brick;
        out.push({
          time: lastTime,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: accVol,
        });
        level = close;
        accVol = 0;
      }
    }
  }
  return out.length > 0 ? out : candles;
}

// ─── Apply the active transform ───

export type TransformKind = "none" | "heikin" | "renko";

export function transformCandles(
  candles: OHLCVPoint[],
  interval: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M",
  transform: TransformKind,
): OHLCVPoint[] {
  let out = candles;
  if (interval === "1w") out = resampleWeekly(out);
  else if (interval === "1M") out = resampleMonthly(out);
  if (transform === "heikin") out = toHeikinAshi(out);
  else if (transform === "renko") out = toRenko(out);
  return out;
}