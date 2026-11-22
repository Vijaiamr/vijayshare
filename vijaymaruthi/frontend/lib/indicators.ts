// Frontend Technical Indicator Computation Library
// Computes all standard indicators from OHLCV data for chart overlay

import { detectPatterns, type DetectedPattern } from "./patterns";
import { loadScreenConfig } from "./screenConfig";
import type { IndicatorSettings } from "@/components/chart/types";

// ─── Types ───

export interface EMALine { time: string; value: number }
export interface BollingerBand { time: string; upper: number; middle: number; lower: number }
export interface RSIPoint { time: string; value: number }
export interface MACDPoint { time: string; macd: number; signal: number; histogram: number }
export interface SwingPoint { time: string; price: number; type: "high" | "low" }
export interface IchimokuPoint { time: string; tenkan: number | null; kijun: number | null; senkouA: number | null; senkouB: number | null }
export interface SuperTrendPoint { time: string; upper: number; lower: number; trendUp: boolean }
export interface OrderBlock { time: string; price: number; type: "bullish" | "bearish"; strength: number }
export interface FVG { startTime: string; endTime: string; top: number; bottom: number; type: "bullish" | "bearish" }
export interface Trendline { startTime: string; endTime: string; startPrice: number; endPrice: number; type: "support" | "resistance" }
export interface VolumeProfilePoint { price: number; volume: number; isPOC: boolean; isVA: boolean }

// ─── Extended indicators (Phase B) ───

export interface ADXPoint { time: string; value: number; plusDI: number; minusDI: number }
export interface StochPoint { time: string; k: number; d: number }
export interface CCIPoint { time: string; value: number }
export interface OBVPoint { time: string; value: number }
export interface PSARPoint { time: string; value: number }
export interface VWAPPoint { time: string; value: number }
export interface ATRPoint { time: string; value: number }
export interface WilliamsRPoint { time: string; value: number }

// ─── Extended indicators (Phase D) ───

export interface SMAPoint { time: string; value: number }
export interface KeltnerPoint { time: string; upper: number; middle: number; lower: number }
export interface DonchianPoint { time: string; upper: number; middle: number; lower: number }
export interface AroonPoint { time: string; up: number; down: number }
export interface MFIPoint { time: string; value: number }
export interface StochRSIPoint { time: string; k: number; d: number }
export interface AOPoint { time: string; value: number }
export interface ROCPoint { time: string; value: number }
export interface MomentumPoint { time: string; value: number }
export interface TRIXPoint { time: string; value: number }
export interface UOPoint { time: string; value: number }
export interface PPOPoint { time: string; value: number; signal: number; histogram: number }
export interface RVIPoint { time: string; value: number; signal: number }
export interface CMOPoint { time: string; value: number }
export interface ForceIndexPoint { time: string; value: number }
export interface EOMPoint { time: string; value: number }
export interface MassIndexPoint { time: string; value: number }
export interface KlingerPoint { time: string; value: number; signal: number }
export interface DPOPoint { time: string; value: number }
export interface ElderRayPoint { time: string; bull: number; bear: number }
export interface EnvelopePoint { time: string; upper: number; lower: number }
export interface CMFPoint { time: string; value: number }

export interface ComputedIndicators {
  ema9: EMALine[]
  ema20: EMALine[]
  ema50: EMALine[]
  ema200: EMALine[]
  bollinger: BollingerBand[]
  rsi: RSIPoint[]
  macd: MACDPoint[]
  swingHighs: SwingPoint[]
  swingLows: SwingPoint[]
  pivotPoint: { pivot: number; r1: number; s1: number } | null
  ichimoku: IchimokuPoint[]
  superTrend: SuperTrendPoint[]
  orderBlocks: OrderBlock[]
  fvgs: FVG[]
  volumeProfile: VolumeProfilePoint[]
  fibonacci: { level: number; price: number }[]
  trendlines: Trendline[]
  patterns: DetectedPattern[]
  // Extended (Phase B)
  adx: ADXPoint[]
  stoch: StochPoint[]
  cci: CCIPoint[]
  obv: OBVPoint[]
  psar: PSARPoint[]
  vwap: VWAPPoint[]
  atr: ATRPoint[]
  williamsR: WilliamsRPoint[]
  // Extended (Phase D)
  sma: SMAPoint[]
  keltner: KeltnerPoint[]
  donchian: DonchianPoint[]
  aroon: AroonPoint[]
  mfi: MFIPoint[]
  stochRsi: StochRSIPoint[]
  ao: AOPoint[]
  roc: ROCPoint[]
  momentum: MomentumPoint[]
  trix: TRIXPoint[]
  uo: UOPoint[]
  ppo: PPOPoint[]
  rvi: RVIPoint[]
  cmo: CMOPoint[]
  forceIndex: ForceIndexPoint[]
  eom: EOMPoint[]
  massIndex: MassIndexPoint[]
  klinger: KlingerPoint[]
  dpo: DPOPoint[]
  elderRay: ElderRayPoint[]
  envelopes: EnvelopePoint[]
  cmf: CMFPoint[]
}

// ─── Helper: SMA ───

function sma(data: number[], period: number, index: number): number {
  let sum = 0;
  for (let j = index - period + 1; j <= index; j++) sum += data[j];
  return sum / period;
}

// ─── EMA ───

function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  let emaValue: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null) }
    else if (i === period - 1) {
      emaValue = 0;
      for (let j = 0; j < period; j++) emaValue += data[j];
      emaValue /= period;
      result.push(emaValue);
    } else {
      emaValue = (data[i] - emaValue!) * multiplier + emaValue!;
      result.push(emaValue);
    }
  }
  return result;
}

// ─── Bollinger Bands ───

function bollingerBands(data: number[], period: number, stdDev: number) {
  const middle: (number | null)[] = [];
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { middle.push(null); upper.push(null); lower.push(null) }
    else {
      const m = sma(data, period, i);
      let sqSum = 0;
      for (let j = i - period + 1; j <= i; j++) sqSum += (data[j] - m) ** 2;
      const sd = Math.sqrt(sqSum / (period - 1)); // sample std dev (standard)
      middle.push(m); upper.push(m + stdDev * sd); lower.push(m - stdDev * sd);
    }
  }
  return { upper, middle, lower };
}

// ─── RSI (Wilder smoothing) ───

function rsi(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length < period + 1) return data.map(() => null);
  const gains: number[] = []; const losses: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    gains.push(Math.max(diff, 0)); losses.push(Math.max(-diff, 0));
  }
  // Seed with simple average of first `period` gains/losses
  let avgG = 0, avgL = 0;
  for (let j = 0; j < period; j++) { avgG += gains[j]; avgL += losses[j] }
  avgG /= period; avgL /= period;
  result.push(null); // index 0
  for (let i = 1; i < data.length; i++) {
    if (i < period) { result.push(null); continue }
    if (i === period) {
      // first RSI uses the seeded SMA
    } else {
      // Wilder smoothing for subsequent values
      avgG = (avgG * (period - 1) + gains[i - 1]) / period;
      avgL = (avgL * (period - 1) + losses[i - 1]) / period;
    }
    result.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  }
  return result;
}

// ─── MACD ───

function macd(data: number[], fastP: number, slowP: number, signalP: number) {
  const fastE = ema(data, fastP), slowE = ema(data, slowP);
  const macdLine: (number | null)[] = data.map((_, i) => fastE[i] !== null && slowE[i] !== null ? fastE[i]! - slowE[i]! : null);
  const validMACD: number[] = []; const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (v !== null) { validMACD.push(v!); validIdx.push(i) } });
  const signalRaw = ema(validMACD, signalP);
  const signalLine: (number | null)[] = new Array(data.length).fill(null);
  signalRaw.forEach((v, i) => { if (v !== null) signalLine[validIdx[i]] = v });
  const histogram = data.map((_, i) => macdLine[i] !== null && signalLine[i] !== null ? macdLine[i]! - signalLine[i]! : null);
  return { macdLine, signalLine, histogram };
}

// ─── Ichimoku Cloud ───

function ichimoku(highs: number[], lows: number[], closes: number[], times: string[]): IchimokuPoint[] {
  const len = highs.length;
  const tenkan: (number | null)[] = new Array(len).fill(null);
  const kijun: (number | null)[] = new Array(len).fill(null);
  const senkouA: (number | null)[] = new Array(len).fill(null);
  const senkouB: (number | null)[] = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    if (i >= 8) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - 8; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
      tenkan[i] = (hh + ll) / 2;
    }
    if (i >= 25) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - 25; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
      kijun[i] = (hh + ll) / 2;
    }
  }

  // Senkou A = (tenkan + kijun) / 2 shifted forward 26
  for (let i = 0; i < len; i++) {
    if (tenkan[i] !== null && kijun[i] !== null) {
      const futureIdx = i + 26;
      if (futureIdx < len) senkouA[futureIdx] = (tenkan[i]! + kijun[i]!) / 2;
    }
  }

  // Senkou B = 52-period HH+LL/2 shifted forward 26
  for (let i = 51; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 51; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
    const futureIdx = i + 26;
    if (futureIdx < len) senkouB[futureIdx] = (hh + ll) / 2;
  }

  return times.map((time, i) => ({
    time, tenkan: tenkan[i], kijun: kijun[i], senkouA: senkouA[i], senkouB: senkouB[i],
  }));
}

// ─── SuperTrend ───

function superTrend(highs: number[], lows: number[], closes: number[], times: string[], multiplier = 3, atrPeriod = 10): SuperTrendPoint[] {
  const len = highs.length;
  const atrValues: number[] = [];
  const result: SuperTrendPoint[] = [];

  // ATR (True Range based)
  for (let i = 0; i < len; i++) {
    if (i === 0) { atrValues.push(highs[i] - lows[i]); continue }
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    if (i < atrPeriod) { atrValues.push((atrValues[i - 1] * (atrPeriod - 1) + tr) / atrPeriod) }
    else { atrValues.push((atrValues[i - 1] * (atrPeriod - 1) + tr) / atrPeriod) }
  }
  // Seed the first atrPeriod values with cumulative True Range average
  for (let i = 1; i < atrPeriod && i < len; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atrValues[i] = (atrValues[i - 1] * i + tr) / (i + 1);
  }

  let prevUpper = 0, prevLower = 0;
  let trendUp = true;

  for (let i = 0; i < len; i++) {
    const atr = atrValues[i];
    const mid = (highs[i] + lows[i]) / 2;
    const upper = mid + multiplier * atr;
    const lower = mid - multiplier * atr;

    if (i === 0) { trendUp = true; prevUpper = upper; prevLower = lower }
    else {
      if (closes[i] > prevLower) trendUp = true;
      else if (closes[i] < prevUpper) trendUp = false;
    }
    // Ensure bands don't cross
    const finalUpper = trendUp ? Math.min(upper, prevUpper) : upper;
    const finalLower = !trendUp ? Math.max(lower, prevLower) : lower;

    result.push({ time: times[i], upper: finalUpper, lower: finalLower, trendUp });
    prevUpper = finalUpper; prevLower = finalLower;
  }
  return result;
}

// ─── Order Blocks ───

function findOrderBlocks(candles: { time: string; open: number; high: number; low: number; close: number }[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const len = candles.length;
  if (len < 5) return blocks;

  for (let i = 2; i < len - 2; i++) {
    // Bullish OB: bearish candle followed by 2+ bullish candles breaking above
    if (candles[i].close < candles[i].open && candles[i + 1].close > candles[i + 1].open && candles[i + 2].close > candles[i + 2].open) {
      if (candles[i + 2].high > candles[i].high) {
        const strength = Math.min(Math.round(((candles[i + 2].close - candles[i].low) / candles[i].low) * 100), 10);
        blocks.push({ time: candles[i].time, price: candles[i].low, type: "bullish", strength });
      }
    }
    // Bearish OB: bullish candle followed by 2+ bearish candles breaking below
    if (candles[i].close > candles[i].open && candles[i + 1].close < candles[i + 1].open && candles[i + 2].close < candles[i + 2].open) {
      if (candles[i + 2].low < candles[i].low) {
        const strength = Math.min(Math.round(((candles[i].high - candles[i + 2].close) / candles[i].high) * 100), 10);
        blocks.push({ time: candles[i].time, price: candles[i].high, type: "bearish", strength });
      }
    }
  }
  return blocks.slice(-8);
}

// ─── Fair Value Gaps ───

function findFVG(candles: { time: string; high: number; low: number; close: number; open: number }[]): FVG[] {
  const gaps: FVG[] = [];
  if (candles.length < 3) return gaps;
  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i], c2 = candles[i + 1], c3 = candles[i + 2];
    // Bullish FVG: c3 low > c1 high (gap up that didn't fill)
    if (c3.low > c1.high) {
      gaps.push({ startTime: c2.time, endTime: c3.time, top: Math.min(c3.high, c1.high + (c3.low - c1.high) * 0.5), bottom: c1.high, type: "bullish" });
    }
    // Bearish FVG: c3 high < c1 low (gap down that didn't fill)
    if (c3.high < c1.low) {
      gaps.push({ startTime: c2.time, endTime: c3.time, top: c1.low, bottom: Math.max(c3.low, c1.low - (c1.low - c3.high) * 0.5), type: "bearish" });
    }
  }
  return gaps.slice(-6);
}

// ─── Volume Profile (simplified) ───

function calcVolumeProfile(highs: number[], lows: number[], volumes: number[], price: number): VolumeProfilePoint[] {
  const rows = 20;
  const range = Math.max(...highs) - Math.min(...lows);
  const step = range / rows;
  if (step <= 0) return [];
  const base = Math.min(...lows);

  const buckets = new Array(rows).fill(0);
  for (let i = 0; i < highs.length; i++) {
    const mid = (highs[i] + lows[i]) / 2;
    const idx = Math.min(Math.floor((mid - base) / step), rows - 1);
    buckets[idx] += volumes[i];
  }

  const totalVol = buckets.reduce((a, b) => a + b, 0);
  const pocIdx = buckets.indexOf(Math.max(...buckets));

  // Value area: find VAH and VAL (70% of volume around POC)
  let cumVol = buckets[pocIdx], vaLow = pocIdx, vaHigh = pocIdx;
  while (cumVol < totalVol * 0.7) {
    const below = vaLow > 0 ? buckets[vaLow - 1] : -1;
    const above = vaHigh < rows - 1 ? buckets[vaHigh + 1] : -1;
    if (below >= above && below >= 0) { vaLow--; cumVol += buckets[vaLow] }
    else if (above >= 0) { vaHigh++; cumVol += buckets[vaHigh] }
    else break;
  }

  const points: VolumeProfilePoint[] = [];
  for (let i = 0; i < rows; i++) {
    if (buckets[i] > 0) {
      points.push({
        price: base + step * (i + 0.5),
        volume: buckets[i],
        isPOC: i === pocIdx,
        isVA: i >= vaLow && i <= vaHigh,
      });
    }
  }
  return points;
}

// ─── Fibonacci Levels ───

function calcFibonacci(swingHigh: number, swingLow: number): { level: number; price: number }[] {
  const diff = swingHigh - swingLow;
  if (diff <= 0) return [];
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.414, 1.618];
  return levels.map((l) => ({ level: l, price: swingLow + diff * l }));
}

// ─── Trendlines (validated) ───
//
// A real trendline must be respected by price, not just connect two random
// swing points. Validation rules (institutional standard):
//   1. Anchor separation ≥ MIN_SEPARATION bars (no adjacent-point lines)
//   2. ≥ MIN_INTERMEDIATE_TOUCHES candles between the anchors must touch the
//      line within TOUCH_TOLERANCE (support → lows, resistance → highs)
//   3. Slope must be plausible (not vertical / absurd)
//   4. Line is projected forward to the last bar so it shows where
//      support/resistance would be TODAY
// Lines are ranked by touch count and the strongest are returned.

function findTrendlines(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  times: string[],
  highs: number[],
  lows: number[],
): Trendline[] {
  const lines: Trendline[] = [];
  const MIN_SEPARATION = 5;        // bars between anchors
  const TOUCH_TOLERANCE = 0.015;   // 1.5% relative tolerance for a touch
  const MIN_INTERMEDIATE_TOUCHES = 1; // touches between the two anchors
  const MAX_SLOPE_PCT = 0.02;      // max |slope| per bar as fraction of price
  const MAX_LINES_PER_TYPE = 2;

  const buildLine = (points: SwingPoint[], type: "support" | "resistance") => {
    const candidates: { line: Trendline; touches: number }[] = [];
    for (let a = 0; a < points.length - 1; a++) {
      for (let b = a + 1; b < points.length; b++) {
        const p1 = points[a], p2 = points[b];
        const i1 = times.indexOf(p1.time), i2 = times.indexOf(p2.time);
        if (i1 < 0 || i2 < 0 || i2 - i1 < MIN_SEPARATION) continue;
        const slope = (p2.price - p1.price) / (i2 - i1);
        const slopePct = Math.abs(slope) / Math.max(p1.price, 1);
        if (slopePct > MAX_SLOPE_PCT) continue; // vertical/absurd line
        // Count intermediate touches (price respecting the line)
        let touches = 0;
        for (let i = i1 + 1; i < i2; i++) {
          const linePrice = p1.price + slope * (i - i1);
          const ref = type === "support" ? lows[i] : highs[i];
          if (Math.abs(ref - linePrice) / Math.max(linePrice, 1) < TOUCH_TOLERANCE) touches++;
        }
        if (touches < MIN_INTERMEDIATE_TOUCHES) continue;
        // Project forward to the last bar
        const lastIdx = times.length - 1;
        const endPrice = p2.price + slope * (lastIdx - i2);
        candidates.push({
          line: {
            startTime: p1.time,
            endTime: times[lastIdx],
            startPrice: p1.price,
            endPrice,
            type,
          },
          touches,
        });
      }
    }
    // Rank: most touches first, then most recent anchor
    candidates.sort((x, y) => y.touches - x.touches || y.line.startTime.localeCompare(x.line.startTime));
    return candidates.slice(0, MAX_LINES_PER_TYPE).map((c) => c.line);
  };

  lines.push(...buildLine(swingLows, "support"));
  lines.push(...buildLine(swingHighs, "resistance"));
  return lines;
}

// ─── Swing Highs/Lows ───

function findSwings(highs: number[], lows: number[], times: string[], windowSize: number) {
  const swingHighs: SwingPoint[] = []; const swingLows: SwingPoint[] = [];
  for (let i = windowSize; i < highs.length - windowSize; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (j !== i && highs[j] >= highs[i]) isHigh = false;
      if (j !== i && lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh) swingHighs.push({ time: times[i], price: highs[i], type: "high" });
    if (isLow) swingLows.push({ time: times[i], price: lows[i], type: "low" });
  }
  return { highs: swingHighs, lows: swingLows };
}

// ─── Extended indicator math (Phase B) ───
// Formulas mirror the Python engine (backend/engine/technical_analysis_report.py)
// so the chart agrees with the platform's analysis.

/** Wilder-smoothed ATR. */
function atr(highs: number[], lows: number[], closes: number[], period: number, times: string[]): ATRPoint[] {
  const len = highs.length;
  const out: ATRPoint[] = [];
  if (len < period + 1) return out;
  const trs: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { trs.push(highs[i] - lows[i]); continue }
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let prev = 0;
  for (let j = 0; j < period; j++) prev += trs[j];
  prev /= period;
  out.push({ time: times[period - 1], value: prev });
  for (let i = period; i < len; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out.push({ time: times[i], value: prev });
  }
  return out;
}

/** ADX with +DI / -DI (Wilder). */
function adx(highs: number[], lows: number[], closes: number[], period: number, times: string[]): ADXPoint[] {
  const len = highs.length;
  const out: ADXPoint[] = [];
  if (len < period * 2) return out;
  const trs: number[] = [];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < len; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const smooth = (arr: number[]) => {
    const outArr: number[] = [];
    let sum = 0;
    for (let j = 0; j < period; j++) sum += arr[j];
    outArr.push(sum);
    for (let i = period; i < arr.length; i++) outArr.push(outArr[outArr.length - 1] - outArr[outArr.length - 1] / period + arr[i]);
    return outArr;
  };
  const trS = smooth(trs);
  const pdmS = smooth(plusDM);
  const mdmS = smooth(minusDM);
  const dxs: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = trS[i] === 0 ? 0 : (100 * pdmS[i]) / trS[i];
    const mdi = trS[i] === 0 ? 0 : (100 * mdmS[i]) / trS[i];
    dxs.push(pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi));
  }
  // ADX = Wilder smoothing of DX
  let adxVal = 0;
  for (let j = 0; j < period; j++) adxVal += dxs[j];
  adxVal /= period;
  const adxArr: number[] = new Array(dxs.length).fill(0);
  adxArr[period - 1] = adxVal;
  for (let i = period; i < dxs.length; i++) adxArr[i] = (adxArr[i - 1] * (period - 1) + dxs[i]) / period;
  // trs/plusDM are 1-indexed vs candles (index i corresponds to candle i+1)
  for (let i = period - 1; i < dxs.length; i++) {
    const candleIdx = i + 1;
    if (candleIdx < len) {
      const pdi = trS[i] === 0 ? 0 : (100 * pdmS[i]) / trS[i];
      const mdi = trS[i] === 0 ? 0 : (100 * mdmS[i]) / trS[i];
      out.push({ time: times[candleIdx], value: adxArr[i], plusDI: pdi, minusDI: mdi });
    }
  }
  return out;
}

/** Stochastic %K / %D. */
function stochastic(highs: number[], lows: number[], closes: number[], kPeriod: number, dPeriod: number, smooth: number): StochPoint[] {
  const len = highs.length;
  const out: StochPoint[] = [];
  if (len < kPeriod + dPeriod) return out;
  const rawK: (number | null)[] = new Array(len).fill(null);
  for (let i = kPeriod - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
    rawK[i] = hh === ll ? 50 : (100 * (closes[i] - ll)) / (hh - ll);
  }
  const smaArr = (arr: (number | null)[], p: number) => {
    const res: (number | null)[] = new Array(len).fill(null);
    for (let i = p - 1; i < len; i++) {
      let sum = 0; let ok = true;
      for (let j = i - p + 1; j <= i; j++) { if (arr[j] === null) { ok = false; break } sum += arr[j]! }
      if (ok) res[i] = sum / p;
    }
    return res;
  };
  const kSmooth = smaArr(rawK, smooth);
  const dSmooth = smaArr(kSmooth, dPeriod);
  for (let i = 0; i < len; i++) {
    if (kSmooth[i] !== null && dSmooth[i] !== null) {
      out.push({ time: "", k: kSmooth[i]!, d: dSmooth[i]! });
    }
  }
  return out;
}

/** CCI (Commodity Channel Index). */
function cci(highs: number[], lows: number[], closes: number[], period: number): CCIPoint[] {
  const len = highs.length;
  const out: CCIPoint[] = [];
  if (len < period) return out;
  const tp = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  for (let i = period - 1; i < len; i++) {
    let sma = 0;
    for (let j = i - period + 1; j <= i; j++) sma += tp[j];
    sma /= period;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - sma);
    md /= period;
    out.push({ time: "", value: md === 0 ? 0 : (tp[i] - sma) / (0.015 * md) });
  }
  return out;
}

/** OBV (On-Balance Volume). */
function obv(closes: number[], volumes: number[]): OBVPoint[] {
  const out: OBVPoint[] = [];
  let val = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i > 0) {
      if (closes[i] > closes[i - 1]) val += volumes[i];
      else if (closes[i] < closes[i - 1]) val -= volumes[i];
    }
    out.push({ time: "", value: val });
  }
  return out;
}

/** Williams %R. */
function williamsR(highs: number[], lows: number[], closes: number[], period: number): WilliamsRPoint[] {
  const len = highs.length;
  const out: WilliamsRPoint[] = [];
  if (len < period) return out;
  for (let i = period - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
    out.push({ time: "", value: hh === ll ? -50 : (-100 * (hh - closes[i])) / (hh - ll) });
  }
  return out;
}

/** Parabolic SAR (classic iterative algorithm). */
function parabolicSar(highs: number[], lows: number[], closes: number[], step: number, maxStep: number): PSARPoint[] {
  const len = highs.length;
  const out: PSARPoint[] = [];
  if (len < 2) return out;
  // Initial trend: first close >= first open approximation via first two closes
  let isUp = closes[1] >= closes[0];
  let sar = isUp ? lows[0] : highs[0];
  let ep = isUp ? highs[0] : lows[0];
  let af = step;
  for (let i = 0; i < len; i++) {
    out.push({ time: "", value: sar });
    if (isUp) {
      if (lows[i] < sar) {
        isUp = false;
        sar = ep;
        ep = lows[i];
        af = step;
      } else {
        if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, maxStep) }
      }
    } else {
      if (highs[i] > sar) {
        isUp = true;
        sar = ep;
        ep = highs[i];
        af = step;
      } else {
        if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, maxStep) }
      }
    }
    sar = sar + af * (ep - sar);
    if (isUp) sar = Math.min(sar, lows[i] - (i > 0 ? Math.abs(lows[i] - lows[i - 1]) * 0.01 : 0));
    else sar = Math.max(sar, highs[i] + (i > 0 ? Math.abs(highs[i] - highs[i - 1]) * 0.01 : 0));
  }
  return out;
}

/** Anchored VWAP (from the first bar of the series). */
function vwap(highs: number[], lows: number[], closes: number[], volumes: number[]): VWAPPoint[] {
  const out: VWAPPoint[] = [];
  let cumPV = 0, cumVol = 0;
  for (let i = 0; i < highs.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += tp * volumes[i];
    cumVol += volumes[i];
    out.push({ time: "", value: cumVol === 0 ? 0 : cumPV / cumVol });
  }
  return out;
}

// ─── Extended indicator math (Phase D) ───
// Formulas mirror the Python engine (backend/engine/technical_analysis_report.py)
// so the chart agrees with the platform's analysis.

/** Simple Moving Average series. */
function smaSeries(data: number[], period: number): SMAPoint[] {
  const out: SMAPoint[] = [];
  if (data.length < period) return out;
  for (let i = period - 1; i < data.length; i++) {
    out.push({ time: "", value: sma(data, period, i) });
  }
  return out;
}

/** Keltner Channels: EMA(period) ± mult × ATR(period). */
function keltnerChannels(highs: number[], lows: number[], closes: number[], period: number, mult: number): KeltnerPoint[] {
  const len = closes.length;
  const out: KeltnerPoint[] = [];
  if (len < period + 1) return out;
  const emaMid = ema(closes, period);
  // ATR (Wilder) aligned to candle index
  const atrVals: (number | null)[] = new Array(len).fill(null);
  const trs: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { trs.push(highs[i] - lows[i]); continue }
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let prev = 0;
  for (let j = 0; j < period; j++) prev += trs[j];
  prev /= period;
  atrVals[period - 1] = prev;
  for (let i = period; i < len; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    atrVals[i] = prev;
  }
  for (let i = period - 1; i < len; i++) {
    const mid = emaMid[i]!;
    const a = atrVals[i]!;
    out.push({ time: "", upper: mid + mult * a, middle: mid, lower: mid - mult * a });
  }
  return out;
}

/** Donchian Channels: highest high / lowest low over period, middle = midpoint. */
function donchianChannels(highs: number[], lows: number[], period: number): DonchianPoint[] {
  const len = highs.length;
  const out: DonchianPoint[] = [];
  if (len < period) return out;
  for (let i = period - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
    out.push({ time: "", upper: hh, middle: (hh + ll) / 2, lower: ll });
  }
  return out;
}

/** Aroon Up/Down: % of period since the most recent high/low. */
function aroon(highs: number[], lows: number[], period: number): AroonPoint[] {
  const len = highs.length;
  const out: AroonPoint[] = [];
  if (len < period) return out;
  for (let i = period - 1; i < len; i++) {
    let hhIdx = i, llIdx = i;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] >= highs[hhIdx]) hhIdx = j;
      if (lows[j] <= lows[llIdx]) llIdx = j;
    }
    out.push({
      time: "",
      up: ((period - (i - hhIdx)) / period) * 100,
      down: ((period - (i - llIdx)) / period) * 100,
    });
  }
  return out;
}

/** Money Flow Index (0-100). */
function mfi(highs: number[], lows: number[], closes: number[], volumes: number[], period: number): MFIPoint[] {
  const len = closes.length;
  const out: MFIPoint[] = [];
  if (len < period + 1) return out;
  const tp = closes.map((_, i) => (highs[i] + lows[i] + closes[i]) / 3);
  const rawFlow = tp.map((v, i) => v * volumes[i]);
  const posFlow: number[] = []; const negFlow: number[] = [];
  for (let i = 1; i < len; i++) {
    if (tp[i] > tp[i - 1]) { posFlow.push(rawFlow[i]); negFlow.push(0) }
    else if (tp[i] < tp[i - 1]) { posFlow.push(0); negFlow.push(rawFlow[i]) }
    else { posFlow.push(0); negFlow.push(0) }
  }
  // posFlow[j] corresponds to the flow between candle j and candle j+1
  for (let i = period; i < len; i++) {
    let posSum = 0, negSum = 0;
    for (let j = i - period + 1; j <= i; j++) { posSum += posFlow[j - 1]; negSum += negFlow[j - 1] }
    out.push({ time: "", value: negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum) });
  }
  return out;
}

/** Stochastic RSI: Stoch of RSI, K = SMA(3), D = SMA(K, 3). */
function stochRsi(closes: number[], period: number): StochRSIPoint[] {
  const len = closes.length;
  const out: StochRSIPoint[] = [];
  if (len < period * 2 + 4) return out;
  const rsiRaw = rsi(closes, period);
  const stochRaw: (number | null)[] = new Array(len).fill(null);
  for (let i = period * 2 - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (rsiRaw[j] === null) continue;
      hh = Math.max(hh, rsiRaw[j]!); ll = Math.min(ll, rsiRaw[j]!);
    }
    if (hh !== -Infinity && rsiRaw[i] !== null) {
      stochRaw[i] = hh === ll ? 50 : (100 * (rsiRaw[i]! - ll)) / (hh - ll);
    }
  }
  const smaArr = (arr: (number | null)[], p: number) => {
    const res: (number | null)[] = new Array(len).fill(null);
    for (let i = p - 1; i < len; i++) {
      let sum = 0; let ok = true;
      for (let j = i - p + 1; j <= i; j++) { if (arr[j] === null) { ok = false; break } sum += arr[j]! }
      if (ok) res[i] = sum / p;
    }
    return res;
  };
  const kSmooth = smaArr(stochRaw, 3);
  const dSmooth = smaArr(kSmooth, 3);
  for (let i = 0; i < len; i++) {
    if (kSmooth[i] !== null && dSmooth[i] !== null) {
      out.push({ time: "", k: kSmooth[i]!, d: dSmooth[i]! });
    }
  }
  return out;
}

/** Awesome Oscillator: SMA(median, fast) − SMA(median, slow). */
function awesomeOscillator(highs: number[], lows: number[], fast: number, slow: number): AOPoint[] {
  const len = highs.length;
  const out: AOPoint[] = [];
  if (len < slow) return out;
  const median = highs.map((h, i) => (h + lows[i]) / 2);
  for (let i = slow - 1; i < len; i++) {
    out.push({ time: "", value: sma(median, fast, i) - sma(median, slow, i) });
  }
  return out;
}

/** Rate of Change (%). */
function roc(closes: number[], period: number): ROCPoint[] {
  const len = closes.length;
  const out: ROCPoint[] = [];
  if (len < period + 1) return out;
  for (let i = period; i < len; i++) {
    const prev = closes[i - period];
    out.push({ time: "", value: prev === 0 ? 0 : ((closes[i] - prev) / prev) * 100 });
  }
  return out;
}

/** Momentum: close − close[n]. */
function momentum(closes: number[], period: number): MomentumPoint[] {
  const len = closes.length;
  const out: MomentumPoint[] = [];
  if (len < period + 1) return out;
  for (let i = period; i < len; i++) {
    out.push({ time: "", value: closes[i] - closes[i - period] });
  }
  return out;
}

/** TRIX: % rate of change of a triple EMA. */
function trix(closes: number[], period: number): TRIXPoint[] {
  const len = closes.length;
  const out: TRIXPoint[] = [];
  if (len < period * 3 - 1) return out;
  const e1 = ema(closes, period);
  const e1Valid = e1.slice(period - 1) as number[];
  const e2 = ema(e1Valid, period);
  const e2Valid = e2.slice(period - 1) as number[];
  const e3 = ema(e2Valid, period);
  // e3[j] corresponds to candle index 3*(period-1) + j
  for (let j = 1; j < e3.length; j++) {
    const prev = e3[j - 1];
    const curr = e3[j];
    if (prev === null || curr === null || prev === 0) continue;
    out.push({ time: "", value: ((curr - prev) / prev) * 100 });
  }
  return out;
}

/** Ultimate Oscillator: weighted average of 3 BP/TR windows. */
function ultimateOscillator(highs: number[], lows: number[], closes: number[], fast: number, mid: number, slow: number): UOPoint[] {
  const len = closes.length;
  const out: UOPoint[] = [];
  if (len < slow + 1) return out;
  const bp: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < len; i++) {
    const prevClose = closes[i - 1];
    bp.push(closes[i] - Math.min(lows[i], prevClose));
    tr.push(Math.max(highs[i], prevClose) - Math.min(lows[i], prevClose));
  }
  const sum = (arr: number[], start: number, end: number) => {
    let s = 0;
    for (let j = start; j <= end; j++) s += arr[j];
    return s;
  };
  for (let i = slow; i < len; i++) {
    const trFast = sum(tr, i - fast + 1, i);
    const trMid = sum(tr, i - mid + 1, i);
    const trSlow = sum(tr, i - slow + 1, i);
    const avgFast = trFast === 0 ? 0 : sum(bp, i - fast + 1, i) / trFast;
    const avgMid = trMid === 0 ? 0 : sum(bp, i - mid + 1, i) / trMid;
    const avgSlow = trSlow === 0 ? 0 : sum(bp, i - slow + 1, i) / trSlow;
    out.push({ time: "", value: (100 * (4 * avgFast + 2 * avgMid + avgSlow)) / 7 });
  }
  return out;
}

/** Percentage Price Oscillator: (EMAfast−EMAslow)/EMAslow×100, signal = EMA(9). */
function ppo(closes: number[], fastP: number, slowP: number, signalP: number): PPOPoint[] {
  const len = closes.length;
  const out: PPOPoint[] = [];
  if (len < slowP + signalP) return out;
  const fastE = ema(closes, fastP);
  const slowE = ema(closes, slowP);
  const ppoLine: (number | null)[] = new Array(len).fill(null);
  for (let i = slowP - 1; i < len; i++) {
    const slow = slowE[i]!;
    ppoLine[i] = slow === 0 ? 0 : ((fastE[i]! - slow) / slow) * 100;
  }
  const validPPO: number[] = []; const validIdx: number[] = [];
  ppoLine.forEach((v, i) => { if (v !== null) { validPPO.push(v!); validIdx.push(i) } });
  const signalRaw = ema(validPPO, signalP);
  const signalLine: (number | null)[] = new Array(len).fill(null);
  signalRaw.forEach((v, i) => { if (v !== null) signalLine[validIdx[i]] = v });
  for (let i = 0; i < len; i++) {
    if (ppoLine[i] !== null && signalLine[i] !== null) {
      out.push({ time: "", value: ppoLine[i]!, signal: signalLine[i]!, histogram: ppoLine[i]! - signalLine[i]! });
    }
  }
  return out;
}

/** Relative Vigor Index: smoothed (close−open) / (high−low), signal = SMA(4) shifted 1 bar. */
function rvi(opens: number[], highs: number[], lows: number[], closes: number[], period: number): RVIPoint[] {
  const len = closes.length;
  const out: RVIPoint[] = [];
  if (len < period + 4) return out;
  const num: number[] = []; const den: number[] = [];
  for (let i = 0; i < len; i++) {
    num.push(closes[i] - opens[i]);
    den.push(highs[i] - lows[i]);
  }
  const numSma: (number | null)[] = new Array(len).fill(null);
  const denSma: (number | null)[] = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    numSma[i] = sma(num, period, i);
    denSma[i] = sma(den, period, i);
  }
  const rviLine: (number | null)[] = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    rviLine[i] = denSma[i] === 0 ? 0 : numSma[i]! / denSma[i]!;
  }
  // Signal = 4-period SMA of RVI shifted forward by 1 bar
  const signalLine: (number | null)[] = new Array(len).fill(null);
  for (let i = period + 3; i < len; i++) {
    let sum = 0; let ok = true;
    for (let j = i - 4; j <= i - 1; j++) { if (rviLine[j] === null) { ok = false; break } sum += rviLine[j]! }
    if (ok) signalLine[i] = sum / 4;
  }
  for (let i = 0; i < len; i++) {
    if (rviLine[i] !== null && signalLine[i] !== null) {
      out.push({ time: "", value: rviLine[i]!, signal: signalLine[i]! });
    }
  }
  return out;
}

/** Chande Momentum Oscillator (−100..100). */
function cmo(closes: number[], period: number): CMOPoint[] {
  const len = closes.length;
  const out: CMOPoint[] = [];
  if (len < period + 1) return out;
  for (let i = period; i < len; i++) {
    let upSum = 0, downSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) upSum += diff;
      else downSum += -diff;
    }
    const total = upSum + downSum;
    out.push({ time: "", value: total === 0 ? 0 : (100 * (upSum - downSum)) / total });
  }
  return out;
}

/** Force Index: (close−prevClose) × volume, EMA-smoothed. */
function forceIndex(closes: number[], volumes: number[], period: number): ForceIndexPoint[] {
  const len = closes.length;
  const out: ForceIndexPoint[] = [];
  if (len < period + 1) return out;
  const fi: number[] = [];
  for (let i = 1; i < len; i++) fi.push((closes[i] - closes[i - 1]) * volumes[i]);
  const fiEma = ema(fi, period);
  for (let i = period - 1; i < fiEma.length; i++) {
    if (fiEma[i] !== null) out.push({ time: "", value: fiEma[i]! });
  }
  return out;
}

/** Ease of Movement: distance moved / box ratio, SMA-smoothed. */
function easeOfMovement(highs: number[], lows: number[], volumes: number[], period: number): EOMPoint[] {
  const len = highs.length;
  const out: EOMPoint[] = [];
  if (len < period + 1) return out;
  const raw: number[] = [];
  for (let i = 1; i < len; i++) {
    const dist = (highs[i] + lows[i]) / 2 - (highs[i - 1] + lows[i - 1]) / 2;
    const range = highs[i] - lows[i];
    const boxRatio = range === 0 ? 0 : (volumes[i] / 100000000) / range;
    raw.push(boxRatio === 0 ? 0 : dist / boxRatio);
  }
  for (let i = period - 1; i < raw.length; i++) {
    out.push({ time: "", value: sma(raw, period, i) });
  }
  return out;
}

/** Mass Index: sum of EMA(range,9)/EMA(EMA(range,9),9) over period. */
function massIndex(highs: number[], lows: number[], period: number): MassIndexPoint[] {
  const len = highs.length;
  const out: MassIndexPoint[] = [];
  if (len < period + 16) return out;
  const range = highs.map((h, i) => h - lows[i]);
  const e1 = ema(range, 9);
  const e1Valid = e1.slice(8) as number[];
  const e2 = ema(e1Valid, 9);
  // e2[j] corresponds to candle index 8 + j
  const ratio: (number | null)[] = new Array(len).fill(null);
  for (let j = 8; j < e2.length; j++) {
    const idx = 8 + j;
    if (idx < len && e2[j] !== null && e2[j] !== 0) {
      ratio[idx] = e1[idx]! / e2[j]!;
    }
  }
  for (let i = period + 15; i < len; i++) {
    let sum = 0; let ok = true;
    for (let j = i - period + 1; j <= i; j++) { if (ratio[j] === null) { ok = false; break } sum += ratio[j]! }
    if (ok) out.push({ time: "", value: sum });
  }
  return out;
}

/** Klinger Oscillator: EMA(VF, fast) − EMA(VF, slow), signal = EMA(13). */
function klinger(highs: number[], lows: number[], closes: number[], fast: number, slow: number): KlingerPoint[] {
  const len = closes.length;
  const out: KlingerPoint[] = [];
  if (len < slow + 12) return out;
  const trend: number[] = [0];
  const dm: number[] = [0];
  const cm: number[] = [0];
  const vf: number[] = [0];
  for (let i = 1; i < len; i++) {
    const hlc = highs[i] + lows[i] + closes[i];
    const prevHlc = highs[i - 1] + lows[i - 1] + closes[i - 1];
    trend.push(hlc > prevHlc ? 1 : -1);
    dm.push(highs[i] - lows[i]);
    cm.push(cm[i - 1] + dm[i] * trend[i]);
    vf.push(trend[i] === trend[i - 1] ? cm[i] - cm[i - 1] + dm[i] : dm[i]);
  }
  const vfEmaFast = ema(vf, fast);
  const vfEmaSlow = ema(vf, slow);
  const kvo: (number | null)[] = new Array(len).fill(null);
  for (let i = slow - 1; i < len; i++) {
    if (vfEmaFast[i] !== null && vfEmaSlow[i] !== null) kvo[i] = vfEmaFast[i]! - vfEmaSlow[i]!;
  }
  const validKVO: number[] = []; const validIdx: number[] = [];
  kvo.forEach((v, i) => { if (v !== null) { validKVO.push(v!); validIdx.push(i) } });
  const signalRaw = ema(validKVO, 13);
  const signalLine: (number | null)[] = new Array(len).fill(null);
  signalRaw.forEach((v, i) => { if (v !== null) signalLine[validIdx[i]] = v });
  for (let i = 0; i < len; i++) {
    if (kvo[i] !== null && signalLine[i] !== null) {
      out.push({ time: "", value: kvo[i]!, signal: signalLine[i]! });
    }
  }
  return out;
}

/** Detrended Price Oscillator: close shifted back by period/2+1 minus SMA. */
function dpo(closes: number[], period: number): DPOPoint[] {
  const len = closes.length;
  const out: DPOPoint[] = [];
  if (len < period) return out;
  const shift = Math.floor(period / 2) + 1;
  const startIdx = Math.max(period - 1, shift);
  for (let i = startIdx; i < len; i++) {
    out.push({ time: "", value: closes[i - shift] - sma(closes, period, i) });
  }
  return out;
}

/** Elder Ray: bull = high − EMA(period), bear = low − EMA(period). */
function elderRay(highs: number[], lows: number[], closes: number[], period: number): ElderRayPoint[] {
  const len = closes.length;
  const out: ElderRayPoint[] = [];
  if (len < period) return out;
  const emaLine = ema(closes, period);
  for (let i = period - 1; i < len; i++) {
    const e = emaLine[i]!;
    out.push({ time: "", bull: highs[i] - e, bear: lows[i] - e });
  }
  return out;
}

/** Envelopes: SMA(period) ± pct%. */
function envelopes(closes: number[], period: number, pct: number): EnvelopePoint[] {
  const len = closes.length;
  const out: EnvelopePoint[] = [];
  if (len < period) return out;
  for (let i = period - 1; i < len; i++) {
    const m = sma(closes, period, i);
    out.push({ time: "", upper: m * (1 + pct / 100), lower: m * (1 - pct / 100) });
  }
  return out;
}

/** Chaikin Money Flow: sum(MFV) / sum(volume) over period. */
function cmf(highs: number[], lows: number[], closes: number[], volumes: number[], period: number): CMFPoint[] {
  const len = closes.length;
  const out: CMFPoint[] = [];
  if (len < period) return out;
  const mfv: number[] = [];
  for (let i = 0; i < len; i++) {
    const range = highs[i] - lows[i];
    const mfm = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    mfv.push(mfm * volumes[i]);
  }
  for (let i = period - 1; i < len; i++) {
    let mfvSum = 0, volSum = 0;
    for (let j = i - period + 1; j <= i; j++) { mfvSum += mfv[j]; volSum += volumes[j] }
    out.push({ time: "", value: volSum === 0 ? 0 : mfvSum / volSum });
  }
  return out;
}

// ─── Compute All ───

export interface OHLCVInput { time: string; open: number; high: number; low: number; close: number; volume: number }

export function computeIndicators(candles: OHLCVInput[], settings?: Partial<IndicatorSettings>): ComputedIndicators {
  const s = {
    rsiPeriod: settings?.rsiPeriod ?? 14,
    macdFast: settings?.macdFast ?? 12,
    macdSlow: settings?.macdSlow ?? 26,
    macdSignal: settings?.macdSignal ?? 9,
    bbPeriod: settings?.bbPeriod ?? 20,
    bbStd: settings?.bbStd ?? 2,
    adxPeriod: settings?.adxPeriod ?? 14,
    stochK: settings?.stochK ?? 14,
    stochD: settings?.stochD ?? 3,
    stochSmooth: settings?.stochSmooth ?? 3,
    cciPeriod: settings?.cciPeriod ?? 20,
    atrPeriod: settings?.atrPeriod ?? 14,
    superTrendMultiplier: settings?.superTrendMultiplier ?? 3,
    superTrendPeriod: settings?.superTrendPeriod ?? 10,
    psarStep: settings?.psarStep ?? 0.02,
    psarMax: settings?.psarMax ?? 0.2,
    smaPeriod: settings?.smaPeriod ?? 20,
    keltnerPeriod: settings?.keltnerPeriod ?? 20,
    keltnerMult: settings?.keltnerMult ?? 2,
    donchianPeriod: settings?.donchianPeriod ?? 20,
    aroonPeriod: settings?.aroonPeriod ?? 25,
    mfiPeriod: settings?.mfiPeriod ?? 14,
    rocPeriod: settings?.rocPeriod ?? 12,
    momPeriod: settings?.momPeriod ?? 10,
    stochRsiPeriod: settings?.stochRsiPeriod ?? 14,
    aoFast: settings?.aoFast ?? 5,
    aoSlow: settings?.aoSlow ?? 34,
    cmfPeriod: settings?.cmfPeriod ?? 20,
    trixPeriod: settings?.trixPeriod ?? 15,
    uoFast: settings?.uoFast ?? 7,
    uoMid: settings?.uoMid ?? 14,
    uoSlow: settings?.uoSlow ?? 28,
    ppoFast: settings?.ppoFast ?? 12,
    ppoSlow: settings?.ppoSlow ?? 26,
    rviPeriod: settings?.rviPeriod ?? 10,
    envPeriod: settings?.envPeriod ?? 20,
    envPct: settings?.envPct ?? 2.5,
    fiPeriod: settings?.fiPeriod ?? 13,
    eomPeriod: settings?.eomPeriod ?? 14,
    massPeriod: settings?.massPeriod ?? 25,
    klingerFast: settings?.klingerFast ?? 34,
    klingerSlow: settings?.klingerSlow ?? 55,
    dpoPeriod: settings?.dpoPeriod ?? 20,
    erPeriod: settings?.erPeriod ?? 14,
    cmoPeriod: settings?.cmoPeriod ?? 14,
    williamsPeriod: settings?.williamsPeriod ?? 14,
  };
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const opens = candles.map((c) => c.open);
  const vol = candles.map((c) => c.volume);
  const times = candles.map((c) => c.time);

  const zipTimes = <T extends { time: string }>(arr: T[], startIdx: number): T[] =>
    arr.map((p, i) => ({ ...p, time: times[startIdx + i] ?? times[times.length - 1] }));

  // EMAs
  const buildEMA = (raw: (number | null)[]) => times.map((t, i) => raw[i] !== null ? { time: t, value: raw[i]! } : null).filter(Boolean) as EMALine[];
  const ema9Raw = ema(closes, 9), ema20Raw = ema(closes, 20), ema50Raw = ema(closes, 50), ema200Raw = ema(closes, 200);
  const ema9 = buildEMA(ema9Raw); const ema20 = buildEMA(ema20Raw); const ema50 = buildEMA(ema50Raw); const ema200 = buildEMA(ema200Raw);

  // Bollinger
  const bbRaw = bollingerBands(closes, s.bbPeriod, s.bbStd);
  const bollinger = times.map((t, i) => bbRaw.upper[i] !== null ? { time: t, upper: bbRaw.upper[i]!, middle: bbRaw.middle[i]!, lower: bbRaw.lower[i]! } : null).filter(Boolean) as BollingerBand[];

  // RSI
  const rsiRaw = rsi(closes, s.rsiPeriod);
  const rsiPoints = times.map((t, i) => rsiRaw[i] !== null ? { time: t, value: rsiRaw[i]! } : null).filter(Boolean) as RSIPoint[];

  // MACD
  const macdRaw = macd(closes, s.macdFast, s.macdSlow, s.macdSignal);
  const macdPoints = times.map((t, i) => macdRaw.macdLine[i] !== null && macdRaw.signalLine[i] !== null && macdRaw.histogram[i] !== null
    ? { time: t, macd: macdRaw.macdLine[i]!, signal: macdRaw.signalLine[i]!, histogram: macdRaw.histogram[i]! } : null).filter(Boolean) as MACDPoint[];

  // Swings
  const swings = findSwings(highs, lows, times, 3);
  const swingHighs = swings.highs.slice(-10);
  const swingLows = swings.lows.slice(-10);

  // Pivot
  const lc = candles[candles.length - 2] || candles[candles.length - 1];
  const pivotPoint = lc ? { pivot: (lc.high + lc.low + lc.close) / 3, r1: 2 * ((lc.high + lc.low + lc.close) / 3) - lc.low, s1: 2 * ((lc.high + lc.low + lc.close) / 3) - lc.high } : null;

  // Ichimoku
  const ichimokuPoints = ichimoku(highs, lows, closes, times);

  // SuperTrend
  const superTrendPoints = superTrend(highs, lows, closes, times, s.superTrendMultiplier, s.superTrendPeriod);

  // Order Blocks
  const orderBlocks = findOrderBlocks(candles);

  // FVGs
  const fvgs = findFVG(candles);

  // Volume Profile
  const lastPrice = closes[closes.length - 1];
  const volumeProfile = calcVolumeProfile(highs, lows, vol, lastPrice);

  // Fibonacci (from major swing high to low over last 60 periods)
  const lookback = Math.min(60, highs.length);
  const fibHigh = Math.max(...highs.slice(-lookback));
  const fibLow = Math.min(...lows.slice(-lookback));
  const fibonacci = calcFibonacci(fibHigh, fibLow);

  // Trendlines (validated: touch count, slope, separation, forward projection)
  const trendlines = findTrendlines(swingHighs, swingLows, times, highs, lows);

  // Chart patterns (algorithmic detection with confidence scoring)
  // regimeFilter + dedup keep the chart consistent with the Patterns tab.
  // Feature 3: apply the user's saved screen dials (if any).
  const screenConfig = loadScreenConfig() ?? undefined;
  const patterns = detectPatterns(candles, swingHighs, swingLows, { regimeFilter: true, dedup: true, screenConfig });

  // Extended indicators (Phase B)
  const adxPoints = adx(highs, lows, closes, s.adxPeriod, times);
  const stochPoints = zipTimes(stochastic(highs, lows, closes, s.stochK, s.stochD, s.stochSmooth), s.stochSmooth + s.stochD - 2);
  const cciPoints = zipTimes(cci(highs, lows, closes, s.cciPeriod), s.cciPeriod - 1);
  const obvPoints = zipTimes(obv(closes, vol), 0);
  const psarPoints = zipTimes(parabolicSar(highs, lows, closes, s.psarStep, s.psarMax), 0);
  const vwapPoints = zipTimes(vwap(highs, lows, closes, vol), 0);
  const atrPoints = atr(highs, lows, closes, s.atrPeriod, times);
  const williamsRPoints = zipTimes(williamsR(highs, lows, closes, s.williamsPeriod), s.williamsPeriod - 1);

  // Extended indicators (Phase D)
  const smaPoints = zipTimes(smaSeries(closes, s.smaPeriod), s.smaPeriod - 1);
  const keltnerPoints = zipTimes(keltnerChannels(highs, lows, closes, s.keltnerPeriod, s.keltnerMult), s.keltnerPeriod - 1);
  const donchianPoints = zipTimes(donchianChannels(highs, lows, s.donchianPeriod), s.donchianPeriod - 1);
  const aroonPoints = zipTimes(aroon(highs, lows, s.aroonPeriod), s.aroonPeriod - 1);
  const mfiPoints = zipTimes(mfi(highs, lows, closes, vol, s.mfiPeriod), s.mfiPeriod);
  const stochRsiPoints = zipTimes(stochRsi(closes, s.stochRsiPeriod), s.stochRsiPeriod * 2 + 3);
  const aoPoints = zipTimes(awesomeOscillator(highs, lows, s.aoFast, s.aoSlow), s.aoSlow - 1);
  const rocPoints = zipTimes(roc(closes, s.rocPeriod), s.rocPeriod);
  const momentumPoints = zipTimes(momentum(closes, s.momPeriod), s.momPeriod);
  const trixPoints = zipTimes(trix(closes, s.trixPeriod), s.trixPeriod * 3 - 2);
  const uoPoints = zipTimes(ultimateOscillator(highs, lows, closes, s.uoFast, s.uoMid, s.uoSlow), s.uoSlow);
  const ppoPoints = zipTimes(ppo(closes, s.ppoFast, s.ppoSlow, 9), s.ppoSlow + 7);
  const rviPoints = zipTimes(rvi(opens, highs, lows, closes, s.rviPeriod), s.rviPeriod + 3);
  const cmoPoints = zipTimes(cmo(closes, s.cmoPeriod), s.cmoPeriod);
  const forceIndexPoints = zipTimes(forceIndex(closes, vol, s.fiPeriod), s.fiPeriod);
  const eomPoints = zipTimes(easeOfMovement(highs, lows, vol, s.eomPeriod), s.eomPeriod);
  const massIndexPoints = zipTimes(massIndex(highs, lows, s.massPeriod), s.massPeriod + 15);
  const klingerPoints = zipTimes(klinger(highs, lows, closes, s.klingerFast, s.klingerSlow), s.klingerSlow + 11);
  const dpoPoints = zipTimes(dpo(closes, s.dpoPeriod), Math.max(s.dpoPeriod - 1, Math.floor(s.dpoPeriod / 2) + 1));
  const elderRayPoints = zipTimes(elderRay(highs, lows, closes, s.erPeriod), s.erPeriod - 1);
  const envelopePoints = zipTimes(envelopes(closes, s.envPeriod, s.envPct), s.envPeriod - 1);
  const cmfPoints = zipTimes(cmf(highs, lows, closes, vol, s.cmfPeriod), s.cmfPeriod - 1);

  return { ema9, ema20, ema50, ema200, bollinger, rsi: rsiPoints, macd: macdPoints, swingHighs, swingLows, pivotPoint, ichimoku: ichimokuPoints, superTrend: superTrendPoints, orderBlocks, fvgs, volumeProfile, fibonacci, trendlines, patterns, adx: adxPoints, stoch: stochPoints, cci: cciPoints, obv: obvPoints, psar: psarPoints, vwap: vwapPoints, atr: atrPoints, williamsR: williamsRPoints, sma: smaPoints, keltner: keltnerPoints, donchian: donchianPoints, aroon: aroonPoints, mfi: mfiPoints, stochRsi: stochRsiPoints, ao: aoPoints, roc: rocPoints, momentum: momentumPoints, trix: trixPoints, uo: uoPoints, ppo: ppoPoints, rvi: rviPoints, cmo: cmoPoints, forceIndex: forceIndexPoints, eom: eomPoints, massIndex: massIndexPoints, klinger: klingerPoints, dpo: dpoPoints, elderRay: elderRayPoints, envelopes: envelopePoints, cmf: cmfPoints };
}
