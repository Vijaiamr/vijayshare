/**
 * transforms.ts — OHLC → alternative chart-type series transforms.
 *
 * Pure functions (no chart dependencies) that convert a candle series into the
 * point series used by TradingView's alternative chart types:
 *
 *   • Kagi        — vertical lines when price moves ≥ reversal, diagonal otherwise
 *   • Point&Figure — X/O columns with a fixed box size and reversal count
 *   • Range       — fixed-price-range bars (each bar spans exactly `range`)
 *   • Line Break  — N-line break chart (default 3 lines)
 *
 * Each returns `{ time, value }[]` suitable for a lightweight-charts LineSeries
 * (the standard way to render these in lightweight-charts v5). Parameters are
 * percent-based by default (of the first close) so they scale across tickers;
 * pass `absolute: true` to use raw price units instead.
 */

export interface TransformPoint {
  time: string;
  value: number;
}

export interface TransformOptions {
  /** Percent of the first close (default). Set `absolute: true` for raw units. */
  absolute?: boolean;
}

export interface KagiOptions extends TransformOptions {
  /** Reversal amount in % (default 4) or absolute units. */
  reversal?: number;
}

export interface PointFigureOptions extends TransformOptions {
  /** Box size in % (default 1) or absolute units. */
  boxSize?: number;
  /** Number of boxes required to reverse a column (default 3). */
  reversal?: number;
}

export interface RangeOptions extends TransformOptions {
  /** Bar range in % (default 1) or absolute units. */
  range?: number;
}

export interface LineBreakOptions {
  /** Number of lines (default 3). */
  lines?: number;
}

function unit(base: number, pct: number, absolute: boolean | undefined): number {
  return absolute ? pct : (base * pct) / 100;
}

/** ── Kagi ─────────────────────────────────────────────────────────────── */

export function toKagi(
  candles: { time: string; close: number }[],
  options: KagiOptions = {},
): TransformPoint[] {
  const { reversal = 4, absolute } = options;
  if (candles.length === 0) return [];
  const base = candles[0].close;
  const rev = unit(base, reversal, absolute);
  const out: TransformPoint[] = [];
  let price = base;
  let dir: "up" | "down" = "up";
  for (const c of candles) {
    if (dir === "up") {
      if (c.close >= price) {
        price = c.close;
      } else if (price - c.close >= rev) {
        dir = "down";
        price = c.close;
      }
    } else {
      if (c.close <= price) {
        price = c.close;
      } else if (c.close - price >= rev) {
        dir = "up";
        price = c.close;
      }
    }
    out.push({ time: c.time, value: round(price) });
  }
  return out;
}

/** ── Point & Figure ───────────────────────────────────────────────────── */

export function toPointFigure(
  candles: { time: string; high: number; low: number; close: number }[],
  options: PointFigureOptions = {},
): TransformPoint[] {
  const { boxSize = 1, reversal = 3, absolute } = options;
  if (candles.length === 0) return [];
  const base = candles[0].close;
  const box = unit(base, boxSize, absolute);
  if (box <= 0) return [];
  const out: TransformPoint[] = [];
  let price = base;
  let col: "X" | "O" | null = null;
  for (const c of candles) {
    if (col === null) {
      if (c.high >= price + box) {
        col = "X";
        price = price + box * Math.max(1, Math.floor((c.high - price) / box));
      } else if (c.low <= price - box) {
        col = "O";
        price = price - box * Math.max(1, Math.floor((price - c.low) / box));
      }
    } else if (col === "X") {
      if (c.high >= price + box) {
        price = price + box * Math.max(1, Math.floor((c.high - price) / box));
      } else if (c.low <= price - box * reversal) {
        col = "O";
        price = price - box;
      }
    } else {
      if (c.low <= price - box) {
        price = price - box * Math.max(1, Math.floor((price - c.low) / box));
      } else if (c.high >= price + box * reversal) {
        col = "X";
        price = price + box;
      }
    }
    out.push({ time: c.time, value: round(price) });
  }
  return out;
}

/** ── Range ────────────────────────────────────────────────────────────── */

export function toRange(
  candles: { time: string; high: number; low: number; close: number }[],
  options: RangeOptions = {},
): TransformPoint[] {
  const { range = 1, absolute } = options;
  if (candles.length === 0) return [];
  const base = candles[0].close;
  const rng = unit(base, range, absolute);
  if (rng <= 0) return [];
  const out: TransformPoint[] = [];
  let price = base;
  for (const c of candles) {
    if (c.high >= price + rng) {
      price = price + rng * Math.max(1, Math.floor((c.high - price) / rng));
    } else if (c.low <= price - rng) {
      price = price - rng * Math.max(1, Math.floor((price - c.low) / rng));
    }
    out.push({ time: c.time, value: round(price) });
  }
  return out;
}

/** ── Line Break ───────────────────────────────────────────────────────── */

export function toLineBreak(
  candles: { time: string; close: number }[],
  options: LineBreakOptions = {},
): TransformPoint[] {
  const { lines = 3 } = options;
  if (candles.length === 0) return [];
  const out: TransformPoint[] = [];
  const series: number[] = [candles[0].close];
  out.push({ time: candles[0].time, value: round(candles[0].close) });
  for (let i = 1; i < candles.length; i++) {
    const close = candles[i].close;
    const n = Math.min(lines, series.length);
    const hi = Math.max(...series.slice(-n));
    const lo = Math.min(...series.slice(-n));
    if (close > hi) {
      series.push(close);
    } else if (close < lo) {
      series.push(close);
    } else {
      series[series.length - 1] = close;
    }
    out.push({ time: candles[i].time, value: round(series[series.length - 1]) });
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}