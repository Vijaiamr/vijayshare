// lib/patterns.ts — Algorithmic Chart Pattern Detection Engine
//
// Detects 10 chart patterns from OHLCV data with strict multi-confirmation rules.
// Targets >90% precision (no false positives) at the cost of recall (may miss some).
// Every detection includes a calibrated confidence score (0–100).
//
// Reference: Bulkowski's Encyclopedia of Chart Patterns (3rd Ed.)
//
// ─── Patterns detected ────────────────────────────────────────────────────────────
//   1. Head & Shoulders          (bearish reversal, 85% reliability)
//   2. Inverse Head & Shoulders  (bullish reversal)
//   3. Double Top                (bearish reversal, 80%)
//   4. Double Bottom             (bullish reversal, 80%)
//   5. Bull Flag                 (bullish continuation, 82%)
//   6. Bear Flag                 (bearish continuation)
//   7. Ascending Triangle        (bullish continuation, 82%)
//   8. Descending Triangle       (bearish continuation, 80%)
//   9. Falling Wedge             (bullish reversal/continuation, 78%)
//  10. Cup & Handle              (bullish continuation, 80%)
//
// ─── Confidence scoring ───────────────────────────────────────────────────────────
//   Each detector computes a weighted score (0–100) from multiple confirmation rules.
//   Patterns with confidence < MIN_CONFIDENCE are suppressed.
//   Each confirmed rule is listed in `confirmations[]` for full transparency.
//
// ─── Integration ──────────────────────────────────────────────────────────────────
//   import { detectPatterns } from "@/lib/patterns";
//   const patterns = detectPatterns(candles, swingHighs, swingLows);
//   // patterns is DetectedPattern[] — empty array if nothing found
// ─────────────────────────────────────────────────────────────────────────────────

import type { OHLCVInput } from "@/lib/indicators";

// ─── Types ────────────────────────────────────────────────────────────────────────

export type PatternType =
  | "head_and_shoulders"
  | "inverse_head_and_shoulders"
  | "double_top"
  | "double_bottom"
  | "bull_flag"
  | "bear_flag"
  | "ascending_triangle"
  | "descending_triangle"
  | "falling_wedge"
  | "cup_and_handle"
  // Phases 1–5 (experimental until calibrated — see EXPERIMENTAL_PATTERNS)
  | "symmetrical_triangle"
  | "rising_wedge"
  | "triple_top"
  | "triple_bottom"
  | "rounding_top"
  | "rounding_bottom"
  | "island_reversal";

export interface TrendLineDef {
  startTime: string;
  endTime: string;
  startPrice: number;
  endPrice: number;
  style: "solid" | "dashed" | "dotted";
  color: string;
  width: 1 | 2;
  label?: string;
}

export interface MarkerDef {
  time: string;
  label: string;
  color: string;
  position: "aboveBar" | "belowBar";
}

export interface DetectedPattern {
  type: PatternType;
  direction: "bullish" | "bearish";
  confidence: number; // 0–100, calibrated
  lines: TrendLineDef[];
  markers: MarkerDef[];
  entry: number | null;        // suggested entry price (null if not yet confirmed)
  stopLoss: number | null;     // suggested stop-loss
  target: number | null;       // measured-move target
  riskReward: number | null;   // calculated R:R ratio (target - entry) / (entry - stopLoss)
  status: "forming" | "active" | "completed" | "failed";
  triggerPrice: number | null; // price level that confirms the pattern
  orderType: "limit" | "stop" | "market" | null; // recommended order type
  invalidation: string;        // what breaks the pattern
  confirmations: string[];     // list of confirmation rules met
}

// ─── Pattern Display Metadata ──────────────────────────────────────────────────────

/** Human-readable labels for charts/tooltips */
export const PATTERN_LABELS: Record<PatternType, { abbr: string; full: string; description: string }> = {
  head_and_shoulders:          { abbr: "H&S",   full: "Head & Shoulders",          description: "Bearish reversal — three peaks with middle highest, neckline break confirms" },
  inverse_head_and_shoulders:  { abbr: "IH&S",  full: "Inverse Head & Shoulders",  description: "Bullish reversal — three troughs with middle lowest, neckline break confirms" },
  double_top:                  { abbr: "2Top",  full: "Double Top",                description: "Bearish reversal — two peaks at similar level, support break confirms" },
  double_bottom:               { abbr: "2Bot",  full: "Double Bottom",             description: "Bullish reversal — two troughs at similar level, resistance break confirms" },
  bull_flag:                   { abbr: "BullF", full: "Bull Flag",                 description: "Bullish continuation — sharp rally (pole) + shallow pullback (flag)" },
  bear_flag:                   { abbr: "BearF", full: "Bear Flag",                 description: "Bearish continuation — sharp decline (pole) + shallow bounce (flag)" },
  ascending_triangle:          { abbr: "AscT",  full: "Ascending Triangle",        description: "Bullish continuation — flat resistance + rising support" },
  descending_triangle:         { abbr: "DesT",  full: "Descending Triangle",       description: "Bearish continuation — flat support + falling resistance" },
  falling_wedge:               { abbr: "FW",    full: "Falling Wedge",             description: "Bullish reversal — contracting range with downward slope" },
  cup_and_handle:              { abbr: "C&H",   full: "Cup & Handle",              description: "Bullish continuation — U-shaped recovery + small pullback" },
  symmetrical_triangle:        { abbr: "SymT",  full: "Symmetrical Triangle",      description: "Bilateral continuation — converging lower highs & higher lows; breakout side decides" },
  rising_wedge:                { abbr: "RW",    full: "Rising Wedge",              description: "Bearish continuation — ascending converging range; breakdown confirms" },
  triple_top:                  { abbr: "3Top",  full: "Triple Top",                description: "Bearish reversal — three peaks at one level; support break confirms" },
  triple_bottom:               { abbr: "3Bot",  full: "Triple Bottom",             description: "Bullish reversal — three troughs at one level; resistance break confirms" },
  rounding_top:                { abbr: "Dome",  full: "Rounding Top",              description: "Bearish reversal — smooth dome with distribution volume" },
  rounding_bottom:             { abbr: "Saucer", full: "Rounding Bottom",          description: "Bullish reversal — smooth saucer with expanding volume on the break" },
  island_reversal:             { abbr: "Isl",   full: "Island Reversal",           description: "Reversal — price cluster trapped between two opposite gaps; gap side decides" },
};

/** Get abbreviated label for a pattern type */
export function patternAbbr(type: PatternType): string {
  return PATTERN_LABELS[type]?.abbr ?? type;
}

/** Get full description for a pattern type */
export function patternDescription(type: PatternType): string {
  return PATTERN_LABELS[type]?.description ?? "";
}

// ─── Constants ────────────────────────────────────────────────────────────────────

// Tunable "screen dials" (Feature 3). These are `let` so detectPatterns can
// override them for the duration of a call (mirroring the backend ScreenConfig
// override) and restore them afterwards. Defaults match the backend constants.
let MIN_CONFIDENCE = 85; // patterns below this raw score are suppressed
let MIN_RR = 1.5; // minimum risk:reward ratio to accept a pattern

// Per-pattern reliability weights — RECALIBRATED post Phase R (mirrored from
// backend engine/pattern_engine.py; see scripts/reliability_calibration.json).
// Weights are RANKING priors only — the dispatcher applies ONE uniform
// MIN_CONFIDENCE gate. Unlisted patterns default to 1.0.
// Weights recalibrated AFTER the F2 repair (backend direction-aware initial
// stop). Pre-F2 bearish numbers were artifacts: every short was phantom-stopped
// on bar 1 by a stop armed BELOW its entry, printing ~100% fake losses.
// ── Phase Q Quality Pass (2026-08-24) — condensed mirror of the backend
// evidence trail (full version: backend engine/pattern_engine.py header):
//   Q1  mandatory-break + 2xATR-freshness gates on six continuation detectors;
//       dispatcher regimeFilter/dedup opt-ins wired on production paths.
//   Q2  Wilder-smoothed ATR (atr14 below), operation-parity with backend _atr.
//   Q3  entry checklists carry only measured facts (volume-on-break measured,
//       neckline facts type-scoped, IHNS decline semantics fixed).
//   Q4  fabricated failure-mode probabilities removed (empty until calibrated).
//   Q5  parity audit adopted triple_top/rising_wedge weights missed post-F2.

const PATTERN_RELIABILITY: Partial<Record<PatternType, number>> = {
  // Recalibrated AFTER the Q1 quality pass (mandatory-break + 2xATR-freshness
  // gates on the six continuation detectors). Gates collapsed several
  // populations because junk signals no longer fire; weights measured on
  // pre-Q1 populations were retired to defaults where n < 15.
  // Source: backend scripts/reliability_calibration.json (2026-08-24).
  bear_flag: 1.0, // Q1: n=3 insufficient; was 0.65 on dead population
  bull_flag: 1.0, // Q1: n=10 insufficient; was 0.9 pre-gate
  cup_and_handle: 0.9, // 44.4% WR [25,66], -0.11R/trade, n=22 (2026-09-03)
  falling_wedge: 1.15, // 32.5% WR [20,48], +0.48R/trade, n=72 (2026-09-03)
  head_and_shoulders: 0.65, // 50.0% WR [30,70], -0.42R/trade, n=30 (2026-09-03; was 0.8)
  inverse_head_and_shoulders: 1.1, // 93.3% WR [70,99], +0.23R/trade, n=16 (2026-09-03; was default 1.0)
  descending_triangle: 1.0, // insufficient data (n=3)
  // Phases 1-5 graduate (calibrated with --experimental, n >= 15):
  // symmetrical_triangle: ST autopsy exhausted all levers (retest fails
  // -0.25R; k=2.0 target already optimal; best cell bullish/5-15% height
  // +0.004R n=179). No config adopted — post-hoc filter mining prohibited.
  symmetrical_triangle: 0.9, // 27.6% WR [23,33], -0.18R/trade, n=405
  triple_top: 0.65, // 8.3% WR [1,35], -0.73R/trade, n=15 (Q5 audit catch: derived post-F2, never wired)
  rising_wedge: 1.1, // retest@1.0x: +0.25R/trade, n=16 (EXPERIMENTAL)
  // triple_bottom: default 1.0 — 47.8% WR [29,67], +0.04R/trade, n=24
  // NOTE: the client ranks by raw confidence (mirrors the backend dispatcher);
  // these weights gate the backend simulator and document the priors here.
};

// Phase R geometry constants (mirrored from backend engine/pattern_engine.py)
let PATTERN_COOLDOWN_BARS = 20; // min bars between same-signature emissions
let STOP_CUSHION_PCT = 0.01; // stops sit 1% beyond the invalidation level
let TARGET_MULT_CONTINUATION = 2.0; // measured-move multiple for continuations
let TARGET_MULT_REVERSAL = 1.0; // measured-move multiple for reversals
let REVERSAL_MIN_RR = 0.8; // relaxed classical floor — reversals win on rate
const REVERSAL_PATTERNS = new Set<string>([
  "head_and_shoulders",
  "inverse_head_and_shoulders",
  "double_top",
  "double_bottom",
  "triple_top",
  "triple_bottom",
  "rounding_top",
  "rounding_bottom",
  "island_reversal",
]);

/** Per-family risk:reward floor (reversals use the relaxed classical floor). */
function rrFloorFor(type: string): number {
  return REVERSAL_PATTERNS.has(type) ? REVERSAL_MIN_RR : MIN_RR;
}

let PEAK_EQUALITY_PCT = 0.05; // 5% max difference for "equal" peaks/troughs
let FLAG_POLE_MIN_PCT = 0.05; // minimum 5% pole move for flags
let TRIANGLE_MIN_TOUCHES = 4; // minimum total touches for triangles
let CUP_MIN_BARS = 20; // minimum bars for cup formation

// ─── Utility helpers ──────────────────────────────────────────────────────────────

/** Find candle index by time string. */
function idx(candles: { time: string }[], time: string): number {
  return candles.findIndex((c) => c.time === time);
}

/** Linear interpolation of a line between two points at a target time. */
function interpolate(
  p1: { time: string; price: number },
  p2: { time: string; price: number },
  targetTime: string,
  candles: { time: string }[],
): number | null {
  const i1 = idx(candles, p1.time);
  const i2 = idx(candles, p2.time);
  const iT = idx(candles, targetTime);
  if (i1 < 0 || i2 < 0 || iT < 0 || i2 === i1) return null;
  return p1.price + ((p2.price - p1.price) * (iT - i1)) / (i2 - i1);
}

/** Get the most recent swing point before a given time. */
function swingBefore(
  swings: { time: string; price: number }[],
  beforeTime: string,
): { time: string; price: number } | null {
  for (let i = swings.length - 1; i >= 0; i--) {
    if (swings[i].time < beforeTime) return swings[i];
  }
  return null;
}

/** Get the swing point at or immediately after a given time. */
function swingAfter(
  swings: { time: string; price: number }[],
  afterTime: string,
): { time: string; price: number } | null {
  for (const s of swings) {
    if (s.time >= afterTime) return s;
  }
  return null;
}

/** Get the swing point exactly at a given time (or closest before). */
function swingAtOrBefore(
  swings: { time: string; price: number }[],
  time: string,
): { time: string; price: number } | null {
  let best: { time: string; price: number } | null = null;
  for (const s of swings) {
    if (s.time <= time) best = s;
  }
  return best;
}

/** Get swing points between two times (inclusive). */
function swingsBetween(
  swings: { time: string; price: number }[],
  fromTime: string,
  toTime: string,
): { time: string; price: number }[] {
  return swings.filter((s) => s.time >= fromTime && s.time <= toTime);
}

/** Get the minimum swing low between two times. */
function minSwingBetween(
  swings: { time: string; price: number }[],
  fromTime: string,
  toTime: string,
): { time: string; price: number } | null {
  const inRange = swingsBetween(swings, fromTime, toTime);
  if (inRange.length === 0) return null;
  return inRange.reduce((a, b) => (a.price < b.price ? a : b));
}

/** Get the maximum swing high between two times. */
function maxSwingBetween(
  swings: { time: string; price: number }[],
  fromTime: string,
  toTime: string,
): { time: string; price: number } | null {
  const inRange = swingsBetween(swings, fromTime, toTime);
  if (inRange.length === 0) return null;
  return inRange.reduce((a, b) => (a.price > b.price ? a : b));
}

/** Average volume over a range of candles. */
function avgVolume(candles: OHLCVInput[], fromIdx: number, toIdx: number): number {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, fromIdx); i <= Math.min(toIdx, candles.length - 1); i++) {
    sum += candles[i].volume;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** Find the high pivot index closest to a time. */
function swingHighAt(
  swingHighs: { time: string; price: number }[],
  time: string,
): { time: string; price: number } | null {
  return swingHighs.find((s) => s.time === time) ?? null;
}

function swingLowAt(
  swingLows: { time: string; price: number }[],
  time: string,
): { time: string; price: number } | null {
  return swingLows.find((s) => s.time === time) ?? null;
}

/** Compute pattern status by checking historical price action after formation.
 *  @param candles  — full candle array
 *  @param endIdx   — index of last candle in pattern formation
 *  @param entry    — suggested entry (null = trigger not yet hit)
 *  @param stopLoss — stop price
 *  @param target   — take-profit price
 *  @param direction — trade direction
 *  @returns status + best available triggerPrice
 */
function calcStatus(
  candles: OHLCVInput[],
  endIdx: number,
  entry: number | null,
  stopLoss: number | null,
  target: number | null,
  direction: "bullish" | "bearish",
): { status: "forming" | "active" | "completed" | "failed"; triggerPrice: number | null; entryPrice: number | null } {
  if (entry === null) {
    // Entry not yet triggered → still forming; use the trigger level as triggerPrice
    return { status: "forming", triggerPrice: null, entryPrice: null };
  }

  // Entry was triggered at some point — scan candles after endIdx.
  // Phase R repair: chronological first-hit-wins. The old version accumulated
  // stop/target hits independently and let target win — a trade that stopped
  // out on bar 3 but touched target on bar 40 reported "completed".
  // Within a bar the stop is checked first (conservative).
  for (let i = endIdx + 1; i < candles.length; i++) {
    const c = candles[i];
    if (direction === "bullish") {
      if (stopLoss !== null && c.low <= stopLoss)
        return { status: "failed", triggerPrice: null, entryPrice: entry };
      if (target !== null && c.high >= target)
        return { status: "completed", triggerPrice: null, entryPrice: entry };
    } else {
      if (stopLoss !== null && c.high >= stopLoss)
        return { status: "failed", triggerPrice: null, entryPrice: entry };
      if (target !== null && c.low <= target)
        return { status: "completed", triggerPrice: null, entryPrice: entry };
    }
  }
  return { status: "active", triggerPrice: null, entryPrice: entry };
}

/** Compute risk/reward ratio (null if incalculable). */
function calcRR(entry: number | null, stopLoss: number | null, target: number | null): number | null {
  if (entry === null || stopLoss === null || target === null || entry === stopLoss) return null;
  return Math.abs((target - entry) / (entry - stopLoss));
}

// ─── 1. Head & Shoulders (bearish reversal) ─────────────────────────────────────

function detectHNS(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (swingHighs.length < 3 || swingLows.length < 2) return null;

  // Examine the most recent swings for the pattern
  const recentHighs = swingHighs.slice(-7);
  const recentLows = swingLows.slice(-7);

  for (let i = 0; i <= recentHighs.length - 3; i++) {
    const ls = recentHighs[i];     // left shoulder
    const hd = recentHighs[i + 1]; // head
    const rs = recentHighs[i + 2]; // right shoulder

    // Essential 1: head must be highest
    if (hd.price <= ls.price || hd.price <= rs.price) continue;

    // Essential 2: shoulders roughly equal
    const shoulderAvg = (ls.price + rs.price) / 2;
    const shoulderDiff = Math.abs(ls.price - rs.price) / shoulderAvg;
    if (shoulderDiff > 0.08) continue;

    // Essential 3: left shoulder time < head time < right shoulder time
    if (!(ls.time < hd.time && hd.time < rs.time)) continue;

    // Find the troughs (neckline points)
    const t1 = maxSwingBetween(recentLows, ls.time, hd.time);   // trough between LS & H
    const t2 = maxSwingBetween(recentLows, hd.time, rs.time);   // trough between H & RS
    if (!t1 || !t2) continue;

    // Essential 4: troughs must exist and have valid prices
    if (t1.price <= 0 || t2.price <= 0) continue;

    // Get latest close
    const latestCandle = candles[candles.length - 1];
    const latestIdx = candles.length - 1;

    // Interpolate neckline value at right shoulder and latest time
    const neckAtRS = interpolate(t1, t2, rs.time, candles);
    const neckAtLatest = interpolate(t1, t2, latestCandle.time, candles);
    if (neckAtRS === null || neckAtLatest === null) continue;

    // Check if price broke below neckline
    const breakIdx = idx(candles, rs.time);
    let brokeBelowNeckline = false;
    let breakBarIdx = -1;
    for (let j = Math.max(0, breakIdx); j < candles.length; j++) {
      const nv = interpolate(t1, t2, candles[j].time, candles);
      if (nv !== null && candles[j].close < nv && candles[j].low < nv) {
        brokeBelowNeckline = true;
        breakBarIdx = j;
        break;
      }
    }

    // ── Confidence scoring ──
    let score = 0;
    const confs: string[] = [];

    // Shoulder symmetry (0–20)
    const symScore = 20 * (1 - shoulderDiff / 0.08);
    score += Math.max(0, Math.round(symScore));
    if (shoulderDiff < 0.03) confs.push("Shoulders symmetrical (±3%)");

    // Head height above neckline (0–20)
    const headHeight = (hd.price - Math.min(t1.price, t2.price)) / hd.price;
    if (headHeight > 0.03 && headHeight < 0.25) {
      score += 20;
      confs.push("Head height ≥3% above neckline");
    } else if (headHeight > 0.02) {
      score += 10;
    }

    // Volume pattern (0–20)
    const lsVol = avgVolume(candles, idx(candles, ls.time) - 2, idx(candles, ls.time) + 2);
    const hdVol = avgVolume(candles, idx(candles, hd.time) - 2, idx(candles, hd.time) + 2);
    const rsVol = avgVolume(candles, idx(candles, rs.time) - 2, idx(candles, rs.time) + 2);
    if (lsVol > hdVol && hdVol > rsVol) {
      score += 20;
      confs.push("Volume declining left→head→right shoulder");
    } else if (lsVol > rsVol) {
      score += 8;
    }

    // Neckline break (0–20)
    if (brokeBelowNeckline) {
      const breakPrice = candles[breakBarIdx].close;
      const breakPct = (neckAtRS - breakPrice) / neckAtRS;
      if (breakPct > 0.03) { score += 20; confs.push("Neckline break >3%"); }
      else if (breakPct > 0.01) { score += 12; confs.push("Neckline break confirmed"); }
      else score += 8;
    } else {
      // No break yet — check if close to neckline
      const pctAbove = (latestCandle.close - neckAtLatest) / neckAtLatest;
      if (pctAbove < 0.01) score += 4;
    }

    // Neckline slope (0–10)
    const slope = (t2.price - t1.price) / t1.price;
    if (Math.abs(slope) < 0.01) { score += 10; confs.push("Neckline nearly flat"); }
    else if (Math.abs(slope) < 0.03) score += 5;

    // Pattern width — more bars = more reliable (0–10)
    const lsIdx = idx(candles, ls.time);
    const rsIdx = idx(candles, rs.time);
    if (lsIdx >= 0 && rsIdx >= 0) {
      const width = rsIdx - lsIdx;
      if (width >= 30) { score += 10; confs.push("Pattern spans 30+ bars"); }
      else if (width >= 15) score += 5;
    }

    const confidence = Math.min(Math.round(score), 100);
    if (confidence < MIN_CONFIDENCE) continue;

    // ── Generate output ──
    const lines: TrendLineDef[] = [];
    const markers: MarkerDef[] = [];

    // Neckline
    lines.push({
      startTime: t1.time, endTime: t2.time,
      startPrice: t1.price, endPrice: t2.price,
      style: "dashed", color: "#ef4444", width: 2, label: "Neckline",
    });

    // Extend neckline projection to right
    const projEndTime = candles[candles.length - 1].time;
    const projEndPrice = interpolate(t1, t2, projEndTime, candles);
    if (projEndPrice !== null) {
      lines.push({
        startTime: t2.time, endTime: projEndTime,
        startPrice: t2.price, endPrice: projEndPrice,
        style: "dotted", color: "rgba(239,68,68,0.3)", width: 1,
      });
    }

    // Markers
    markers.push({ time: ls.time, label: "LS", color: "#f59e0b", position: "aboveBar" });
    markers.push({ time: hd.time, label: "H", color: "#ef4444", position: "aboveBar" });
    markers.push({ time: rs.time, label: "RS", color: "#f59e0b", position: "aboveBar" });
    markers.push({ time: latestCandle.time, label: `H&S ${confidence}%`, color: "#ef4444", position: "belowBar" });

    // Measured target (1.5× for realistic R:R)
    const patternHeight = hd.price - neckAtRS;
    const measuredTarget = neckAtRS - patternHeight * TARGET_MULT_REVERSAL;

    const entryPrice = brokeBelowNeckline ? latestCandle.close : null;
    const stopPrice = Math.max(rs.price, hd.price) * (1 + STOP_CUSHION_PCT);
    const targetPrice = measuredTarget > 0 ? measuredTarget : null;
    const pStatus = calcStatus(candles, rsIdx, entryPrice, stopPrice, targetPrice, "bearish");

    return {
      type: "head_and_shoulders",
      direction: "bearish",
      confidence,
      lines,
      markers,
      entry: pStatus.entryPrice,
      stopLoss: stopPrice,
      target: targetPrice,
      riskReward: calcRR(pStatus.entryPrice, stopPrice, targetPrice),
      status: pStatus.status,
      triggerPrice: pStatus.triggerPrice ?? neckAtRS,
      orderType: "stop",
      invalidation: "Price closes above right shoulder high or above the head",
      confirmations: confs,
    };
  }

  return null;
}

// ─── 2. Inverse Head & Shoulders (bullish reversal) ─────────────────────────────

function detectIHNS(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (swingHighs.length < 2 || swingLows.length < 3) return null;

  const recentLows = swingLows.slice(-7);
  const recentHighs = swingHighs.slice(-7);

  for (let i = 0; i <= recentLows.length - 3; i++) {
    const ls = recentLows[i];       // left shoulder
    const hd = recentLows[i + 1];   // head
    const rs = recentLows[i + 2];   // right shoulder

    // Essential 1: head must be lowest
    if (hd.price >= ls.price || hd.price >= rs.price) continue;

    // Essential 2: shoulders roughly equal
    const shoulderAvg = (ls.price + rs.price) / 2;
    const shoulderDiff = Math.abs(ls.price - rs.price) / shoulderAvg;
    if (shoulderDiff > 0.08) continue;

    // Essential 3: time order
    if (!(ls.time < hd.time && hd.time < rs.time)) continue;

    // Find neckline points (peaks between shoulders and head)
    const n1 = minSwingBetween(recentHighs, ls.time, hd.time);  // peak between LS and H
    const n2 = minSwingBetween(recentHighs, hd.time, rs.time);  // peak between H and RS
    if (!n1 || !n2) continue;

    // Interpolate neckline
    const neckAtRS = interpolate(n1, n2, rs.time, candles);
    const latestCandle = candles[candles.length - 1];
    const neckAtLatest = interpolate(n1, n2, latestCandle.time, candles);
    if (neckAtRS === null || neckAtLatest === null) continue;

    // Check for breakout above neckline
    const breakIdx = idx(candles, rs.time);
    let brokeAboveNeckline = false;
    let breakBarIdx = -1;
    for (let j = Math.max(0, breakIdx); j < candles.length; j++) {
      const nv = interpolate(n1, n2, candles[j].time, candles);
      if (nv !== null && candles[j].close > nv && candles[j].high > nv) {
        brokeAboveNeckline = true;
        breakBarIdx = j;
        break;
      }
    }

    // ── Confidence scoring ──
    let score = 0;
    const confs: string[] = [];

    // Shoulder symmetry (0–20)
    const symScore = 20 * (1 - shoulderDiff / 0.08);
    score += Math.max(0, Math.round(symScore));
    if (shoulderDiff < 0.03) confs.push("Shoulders symmetrical (±3%)");

    // Head depth (0–20)
    const headDepth = (Math.max(n1.price, n2.price) - hd.price) / hd.price;
    if (headDepth > 0.03 && headDepth < 0.25) {
      score += 20;
      confs.push("Head depth ≥3% below neckline");
    } else if (headDepth > 0.02) {
      score += 10;
    }

    // Volume: should be high on head or right shoulder (accumulation)
    const hdVol = avgVolume(candles, idx(candles, hd.time) - 2, idx(candles, hd.time) + 2);
    const rsVol = avgVolume(candles, idx(candles, rs.time) - 2, idx(candles, rs.time) + 2);
    const avgVol = avgVolume(candles, Math.max(0, idx(candles, ls.time) - 5), idx(candles, rs.time) + 2);
    if (hdVol > avgVol * 1.2 || rsVol > avgVol * 1.2) {
      score += 15;
      confs.push("Volume elevated on head or right shoulder (accumulation)");
    }

    // Neckline breakout (0–25)
    if (brokeAboveNeckline) {
      const breakPrice = candles[breakBarIdx].close;
      const breakPct = (breakPrice - neckAtRS) / neckAtRS;
      if (breakPct > 0.03) { score += 25; confs.push("Neckline break >3%"); }
      else if (breakPct > 0.01) { score += 15; confs.push("Neckline break confirmed"); }
      else score += 10;
    } else {
      const pctBelow = (neckAtLatest - latestCandle.close) / neckAtLatest;
      if (pctBelow < 0.01) score += 5;
    }

    // Pattern width (0–10)
    const lsIdx = idx(candles, ls.time);
    const rsIdx = idx(candles, rs.time);
    if (lsIdx >= 0 && rsIdx >= 0) {
      const width = rsIdx - lsIdx;
      if (width >= 30) { score += 10; confs.push("Pattern spans 30+ bars"); }
      else if (width >= 15) score += 5;
    }

    // Neckline slope (0–10)
    const slope = (n2.price - n1.price) / n1.price;
    if (Math.abs(slope) < 0.01) { score += 10; confs.push("Neckline nearly flat"); }
    else if (Math.abs(slope) < 0.03) score += 5;

    const confidence = Math.min(Math.round(score), 100);
    if (confidence < MIN_CONFIDENCE) continue;

    // ── Generate output ──
    const lines: TrendLineDef[] = [];
    const markers: MarkerDef[] = [];

    lines.push({
      startTime: n1.time, endTime: n2.time,
      startPrice: n1.price, endPrice: n2.price,
      style: "dashed", color: "#22c55e", width: 2, label: "Neckline",
    });

    const projEndPrice = interpolate(n1, n2, latestCandle.time, candles);
    if (projEndPrice !== null) {
      lines.push({
        startTime: n2.time, endTime: latestCandle.time,
        startPrice: n2.price, endPrice: projEndPrice,
        style: "dotted", color: "rgba(34,197,94,0.3)", width: 1,
      });
    }

    markers.push({ time: ls.time, label: "LS", color: "#22c55e", position: "belowBar" });
    markers.push({ time: hd.time, label: "H", color: "#22c55e", position: "belowBar" });
    markers.push({ time: rs.time, label: "RS", color: "#22c55e", position: "belowBar" });
    markers.push({ time: latestCandle.time, label: `IH&S ${confidence}%`, color: "#22c55e", position: "aboveBar" });

    const patternHeight = neckAtRS - hd.price;
    const target = neckAtRS + patternHeight * TARGET_MULT_REVERSAL;

    const entryPrice = brokeAboveNeckline ? latestCandle.close : null;
    const stopPrice = Math.min(rs.price, hd.price) * (1 - STOP_CUSHION_PCT);
    const pStatus = calcStatus(candles, rsIdx, entryPrice, stopPrice, target, "bullish");

    return {
      type: "inverse_head_and_shoulders",
      direction: "bullish",
      confidence,
      lines,
      markers,
      entry: pStatus.entryPrice,
      stopLoss: stopPrice,
      target: target,
      riskReward: calcRR(pStatus.entryPrice, stopPrice, target),
      status: pStatus.status,
      triggerPrice: pStatus.triggerPrice ?? neckAtRS,
      orderType: "stop",
      invalidation: "Price closes below right shoulder low or below the head",
      confirmations: confs,
    };
  }

  return null;
}

// ─── 3. Double Top (bearish reversal) ───────────────────────────────────────────

function detectDoubleTop(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (swingHighs.length < 2 || swingLows.length < 1) return null;

  const recentHighs = swingHighs.slice(-5);

  for (let i = 0; i <= recentHighs.length - 2; i++) {
    const p1 = recentHighs[i];
    const p2 = recentHighs[i + 1];

    // Essential 1: peaks must be at similar price (±5%)
    const peakAvg = (p1.price + p2.price) / 2;
    const peakDiff = Math.abs(p1.price - p2.price) / peakAvg;
    if (peakDiff > PEAK_EQUALITY_PCT) continue;

    // Essential 2: p1 before p2
    if (!(p1.time < p2.time)) continue;

    // Find the trough between peaks
    const valley = minSwingBetween(swingLows, p1.time, p2.time);
    if (!valley) continue;

    // Essential 3: valley must be significantly lower than peaks
    const valleyDepth = (peakAvg - valley.price) / peakAvg;
    if (valleyDepth < 0.02) continue;

    // Check for breakdown below valley
    const valleyIdx = idx(candles, valley.time);
    let brokeBelow = false;
    let breakBar = -1;
    const startCheck = Math.max(valleyIdx, idx(candles, p2.time));
    for (let j = startCheck; j < candles.length; j++) {
      if (candles[j].close < valley.price && candles[j].low < valley.price) {
        brokeBelow = true;
        breakBar = j;
        break;
      }
    }

    // ── Scoring ──
    let score = 0;
    const confs: string[] = [];

    // Peak equality (0–20)
    const eqScore = 20 * (1 - peakDiff / PEAK_EQUALITY_PCT);
    score += Math.max(0, Math.round(eqScore));
    if (peakDiff < 0.02) confs.push("Peaks within ±2%");

    // Valley depth (0–20)
    if (valleyDepth > 0.05) { score += 20; confs.push("Valley depth >5%"); }
    else if (valleyDepth > 0.03) score += 12;

    // Volume: 2nd peak should be lower volume (0–15)
    const v1 = avgVolume(candles, idx(candles, p1.time) - 2, idx(candles, p1.time) + 2);
    const v2 = avgVolume(candles, idx(candles, p2.time) - 2, idx(candles, p2.time) + 2);
    if (v2 < v1 * 0.9) { score += 15; confs.push("Volume lower on 2nd peak"); }
    else if (v2 < v1) score += 8;

    // Breakdown (0–25)
    if (brokeBelow) {
      const breakPct = (valley.price - candles[breakBar].close) / valley.price;
      if (breakPct > 0.03) { score += 25; confs.push("Breakdown >3% below valley"); }
      else if (breakPct > 0.01) { score += 15; confs.push("Breakdown confirmed"); }
      else score += 10;
    } else {
      const latestClose = candles[candles.length - 1].close;
      const pctAbove = (latestClose - valley.price) / valley.price;
      if (pctAbove < 0.01) score += 5;
    }

    // Pattern width (0–10)
    const i1 = idx(candles, p1.time);
    const i2Idx = idx(candles, p2.time);
    if (i1 >= 0 && i2Idx >= 0 && (i2Idx - i1) >= 10) {
      score += 10;
      confs.push("Pattern spans 10+ bars");
    }

    // Measured move (0–10)
    const measuredMove = (peakAvg - valley.price) * 2;
    const latestClose = candles[candles.length - 1].close;
    if (valley.price - measuredMove > 0) score += 5;

    const confidence = Math.min(Math.round(score), 100);
    if (confidence < MIN_CONFIDENCE) continue;

    // ── Output ──
    const lines: TrendLineDef[] = [];
    const markers: MarkerDef[] = [];

    // Valley (support) line
    lines.push({
      startTime: p1.time, endTime: candles[candles.length - 1].time,
      startPrice: valley.price, endPrice: valley.price,
      style: "solid", color: "#ef4444", width: 1, label: "Support",
    });

    markers.push({ time: p1.time, label: "DT", color: "#ef4444", position: "aboveBar" });
    markers.push({ time: p2.time, label: "DT", color: "#ef4444", position: "aboveBar" });
    markers.push({ time: candles[candles.length - 1].time, label: `D. Top ${confidence}%`, color: "#ef4444", position: "belowBar" });

    const entryPrice = brokeBelow ? candles[breakBar].close : null;
    const stopPrice = peakAvg * (1 + STOP_CUSHION_PCT);
    const targetPrice =
      valley.price - (peakAvg - valley.price) * TARGET_MULT_REVERSAL;
    const dtEndIdx = idx(candles, p2.time);
    const pStatus = calcStatus(candles, dtEndIdx, entryPrice, stopPrice, targetPrice, "bearish");

    return {
      type: "double_top",
      direction: "bearish",
      confidence,
      lines,
      markers,
      entry: pStatus.entryPrice,
      stopLoss: stopPrice,
      target: targetPrice > 0 ? targetPrice : null,
      riskReward: calcRR(pStatus.entryPrice, stopPrice, targetPrice),
      status: pStatus.status,
      triggerPrice: pStatus.triggerPrice ?? valley.price,
      orderType: "stop",
      invalidation: "Price closes above the higher of the two peaks",
      confirmations: confs,
    };
  }

  return null;
}

// ─── 4. Double Bottom (bullish reversal) ────────────────────────────────────────

function detectDoubleBottom(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (swingLows.length < 2 || swingHighs.length < 1) return null;

  const recentLows = swingLows.slice(-5);

  for (let i = 0; i <= recentLows.length - 2; i++) {
    const t1 = recentLows[i];
    const t2 = recentLows[i + 1];

    const troughAvg = (t1.price + t2.price) / 2;
    const troughDiff = Math.abs(t1.price - t2.price) / troughAvg;
    if (troughDiff > PEAK_EQUALITY_PCT) continue;
    if (!(t1.time < t2.time)) continue;

    const peak = maxSwingBetween(swingHighs, t1.time, t2.time);
    if (!peak) continue;

    const peakHeight = (peak.price - troughAvg) / troughAvg;
    if (peakHeight < 0.02) continue;

    // Check for breakout above peak
    const peakIdx = idx(candles, peak.time);
    let brokeAbove = false;
    let breakBar = -1;
    const startCheck = Math.max(peakIdx, idx(candles, t2.time));
    for (let j = startCheck; j < candles.length; j++) {
      if (candles[j].close > peak.price && candles[j].high > peak.price) {
        brokeAbove = true;
        breakBar = j;
        break;
      }
    }

    // ── Scoring ──
    let score = 0;
    const confs: string[] = [];

    const eqScore = 20 * (1 - troughDiff / PEAK_EQUALITY_PCT);
    score += Math.max(0, Math.round(eqScore));
    if (troughDiff < 0.02) confs.push("Troughs within ±2%");

    if (peakHeight > 0.05) { score += 20; confs.push("Peak height >5%"); }
    else if (peakHeight > 0.03) score += 12;

    const v1 = avgVolume(candles, idx(candles, t1.time) - 2, idx(candles, t1.time) + 2);
    const v2 = avgVolume(candles, idx(candles, t2.time) - 2, idx(candles, t2.time) + 2);
    if (v2 > v1) { score += 15; confs.push("Volume higher on 2nd trough (accumulation)"); }

    if (brokeAbove) {
      const breakPct = (candles[breakBar].close - peak.price) / peak.price;
      if (breakPct > 0.03) { score += 25; confs.push("Breakout >3% above peak"); }
      else if (breakPct > 0.01) { score += 15; confs.push("Breakout confirmed"); }
      else score += 10;
    } else {
      const latestClose = candles[candles.length - 1].close;
      const pctBelow = (peak.price - latestClose) / peak.price;
      if (pctBelow < 0.01) score += 5;
    }

    const i1 = idx(candles, t1.time);
    const i2Idx = idx(candles, t2.time);
    if (i1 >= 0 && i2Idx >= 0 && (i2Idx - i1) >= 10) {
      score += 10;
      confs.push("Pattern spans 10+ bars");
    }

    const confidence = Math.min(Math.round(score), 100);
    if (confidence < MIN_CONFIDENCE) continue;

    const lines: TrendLineDef[] = [];
    const markers: MarkerDef[] = [];

    lines.push({
      startTime: t1.time, endTime: candles[candles.length - 1].time,
      startPrice: peak.price, endPrice: peak.price,
      style: "solid", color: "#22c55e", width: 1, label: "Resistance",
    });

    markers.push({ time: t1.time, label: "DB", color: "#22c55e", position: "belowBar" });
    markers.push({ time: t2.time, label: "DB", color: "#22c55e", position: "belowBar" });
    markers.push({ time: candles[candles.length - 1].time, label: `D. Bot ${confidence}%`, color: "#22c55e", position: "aboveBar" });

    const entryPrice = brokeAbove ? candles[breakBar].close : null;
    const stopPrice = troughAvg * (1 - STOP_CUSHION_PCT);
    const targetPrice =
      peak.price + (peak.price - troughAvg) * TARGET_MULT_REVERSAL;
    const dbEndIdx = idx(candles, t2.time);
    const pStatus = calcStatus(candles, dbEndIdx, entryPrice, stopPrice, targetPrice, "bullish");

    return {
      type: "double_bottom",
      direction: "bullish",
      confidence,
      lines,
      markers,
      entry: pStatus.entryPrice,
      stopLoss: stopPrice,
      target: targetPrice,
      riskReward: calcRR(pStatus.entryPrice, stopPrice, targetPrice),
      status: pStatus.status,
      triggerPrice: pStatus.triggerPrice ?? peak.price,
      orderType: "stop",
      invalidation: "Price closes below the lower of the two troughs",
      confirmations: confs,
    };
  }

  return null;
}

// ─── 5. Bull Flag (bullish continuation) ────────────────────────────────────────

function detectBullFlag(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Need enough data
  if (candles.length < 15) return null;

  const lookback = Math.min(60, candles.length);
  const startIdx = candles.length - lookback;

  // Step 1: Find a sharp upward move (the pole)
  let bestPole: { start: number; end: number; risePct: number } | null = null;
  // Phase R repair: pole ends before the current breakout bar — otherwise a
  // genuine breakout extends the best pole to the last bar, no flag remains,
  // and the detector bails on the poleEnd guard.
  for (let i = startIdx; i < candles.length - 5; i++) {
    for (let j = i + 3; j < Math.min(i + 15, candles.length - 1); j++) {
      const rise = (candles[j].close - candles[i].close) / candles[i].close;
      if (rise >= FLAG_POLE_MIN_PCT && rise < 0.5) {
        if (!bestPole || rise > bestPole.risePct) {
          bestPole = { start: i, end: j, risePct: rise };
        }
      }
    }
  }
  if (!bestPole) return null;

  // Step 2: After the pole, look for a counter-trend consolidation (flag)
  // Flag = price drifts down in a parallel channel
  const poleEnd = bestPole.end;
  if (poleEnd >= candles.length - 3) return null; // need bars after pole

  const flagCandles = candles.slice(poleEnd + 1);
  if (flagCandles.length < 3) return null;

  // Phase R repair: the flag body excludes the current bar — today's bar is
  // the potential breakout bar. The old range included its own high, so
  // `latestClose > flagHigh` was mathematically impossible.
  const priorFlag = flagCandles.slice(0, -1);
  const flagStart = flagCandles[0];
  const flagEnd = priorFlag[priorFlag.length - 1];
  if (flagEnd.close >= flagStart.close) return null; // must drift down

  // Check for channel-like behavior (flag should be roughly parallel)
  const flagSwings = swingsBetween(swingHighs, flagStart.time, flagEnd.time)
    .concat(swingsBetween(swingLows, flagStart.time, flagEnd.time))
    .sort((a, b) => a.time.localeCompare(b.time));
  if (flagSwings.length < 3) return null;

  // Check for breakout above flag
  const latestClose = candles[candles.length - 1].close;
  const flagHigh = Math.max(...priorFlag.map((c) => c.high));
  let brokeOut = latestClose > flagHigh;
  // Q1 quality gate: continuation patterns ARE the trade — an unconfirmed
  // flag floods the dispatcher top-3 with dormant geometry.
  if (!brokeOut) return null;
  const atrFlag = atr14(candles);
  if (atrFlag > 0 && latestClose - flagHigh > 2.0 * atrFlag) return null; // stale breakout

  // ── Scoring ──
  let score = 40; // base score for having a pole + flag structure
  const confs: string[] = [];

  // Pole strength (0–15)
  if (bestPole.risePct > 0.1) { score += 15; confs.push("Flagpole rise >10%"); }
  else if (bestPole.risePct > 0.07) score += 8;

  // Flag depth (0–15)
  const flagDrop = (flagStart.close - flagEnd.close) / flagStart.close;
  if (flagDrop > 0.02 && flagDrop < 0.15) { score += 15; confs.push("Flag retrace 2–15%"); }
  else if (flagDrop <= 0.02) { score += 5; }

  // Flag duration relative to pole (0–10)
  const poleBars = bestPole.end - bestPole.start;
  const flagBars = flagCandles.length;
  if (flagBars <= poleBars * 1.5) { score += 10; confs.push("Flag shorter than pole"); }

  // Volume contraction during flag (0–15)
  const poleVol = avgVolume(candles, bestPole.start, bestPole.end);
  const flagVol = avgVolume(candles, poleEnd + 1, candles.length - 1);
  if (flagVol < poleVol * 0.8) { score += 15; confs.push("Volume contracting during flag"); }
  else if (flagVol < poleVol) score += 7;

  // Breakout (0–20)
  if (brokeOut) {
    const breakPct = (latestClose - flagHigh) / flagHigh;
    if (breakPct > 0.02) { score += 20; confs.push("Breakout >2% above flag"); }
    else score += 10;
  }

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;

  // ── Output ──
  const flagHighTime = flagCandles.reduce((a, b) => (a.high > b.high ? a : b)).time;
  const flagLowTime = flagCandles.reduce((a, b) => (a.low < b.low ? a : b)).time;
  const flagLowPrice = Math.min(...priorFlag.map((c) => c.low));

  const lines: TrendLineDef[] = [];
  const markers: MarkerDef[] = [];

  // Flag channel (upper and lower trendlines)
  // Upper: connect first flag bar high to last flag bar high (approximate parallel)
  const upperLineEndPrice = flagEnd.close + (flagCandles[0].close - flagCandles[0].close) * 0.1; // flat-ish
  const lowerLineEndPrice = flagLowPrice;

  lines.push({
    startTime: flagStart.time, endTime: flagEnd.time,
    startPrice: flagStart.high, endPrice: flagEnd.high,
    style: "dashed", color: "#22c55e", width: 1, label: "Flag",
  });
  lines.push({
    startTime: flagStart.time, endTime: flagEnd.time,
    startPrice: flagStart.low, endPrice: flagLowPrice,
    style: "dashed", color: "#22c55e", width: 1,
  });

  markers.push({ time: candles[bestPole.start].time, label: "Pole", color: "#22c55e", position: "belowBar" });
  markers.push({ time: flagEnd.time, label: `Flag ${confidence}%`, color: "#22c55e", position: "aboveBar" });

  const bfEntryPrice = brokeOut ? latestClose : null;
  const target = (bfEntryPrice ?? flagHigh) + (bestPole.risePct * candles[bestPole.start].close);
  const bfStopPrice = flagLowPrice * (1 - STOP_CUSHION_PCT);
  const bfEndIdx = idx(candles, flagEnd.time);
  const bfStatus = calcStatus(candles, bfEndIdx, bfEntryPrice, bfStopPrice, target, "bullish");

  return {
    type: "bull_flag",
    direction: "bullish",
    confidence,
    lines,
    markers,
    entry: bfStatus.entryPrice,
    stopLoss: bfStopPrice,
    target: target,
    riskReward: calcRR(bfStatus.entryPrice, bfStopPrice, target),
    status: bfStatus.status,
    triggerPrice: bfStatus.triggerPrice ?? (brokeOut ? null : Math.max(flagStart.high, flagEnd.high)),
    orderType: "stop",
    invalidation: "Price breaks below the flag's lower trendline",
    confirmations: confs,
  };
}

// ─── 6. Bear Flag (bearish continuation) ────────────────────────────────────────

function detectBearFlag(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (candles.length < 15) return null;

  const lookback = Math.min(60, candles.length);
  const startIdx = candles.length - lookback;

  // Step 1: Find sharp downward move (pole)
  let bestPole: { start: number; end: number; dropPct: number } | null = null;
  // Phase R repair (bear mirror): pole ends before the breakdown bar.
  for (let i = startIdx; i < candles.length - 5; i++) {
    for (let j = i + 3; j < Math.min(i + 15, candles.length - 1); j++) {
      const drop = (candles[i].close - candles[j].close) / candles[i].close;
      if (drop >= FLAG_POLE_MIN_PCT && drop < 0.5) {
        if (!bestPole || drop > bestPole.dropPct) {
          bestPole = { start: i, end: j, dropPct: drop };
        }
      }
    }
  }
  if (!bestPole) return null;

  const poleEnd = bestPole.end;
  if (poleEnd >= candles.length - 3) return null;

  const flagCandles = candles.slice(poleEnd + 1);
  if (flagCandles.length < 3) return null;

  // Phase R repair (bear mirror): flag body excludes the breakdown bar.
  const priorFlag = flagCandles.slice(0, -1);
  const flagStart = flagCandles[0];
  const flagEnd = priorFlag[priorFlag.length - 1];
  if (flagEnd.close <= flagStart.close) return null; // must drift up (counter-trend)

  const latestClose = candles[candles.length - 1].close;
  const flagLow = Math.min(...priorFlag.map((c) => c.low));
  let brokeDown = latestClose < flagLow;
  // Q1 quality gate (bear mirror): confirmed breakdowns only.
  if (!brokeDown) return null;
  const atrFlagB = atr14(candles);
  if (atrFlagB > 0 && flagLow - latestClose > 2.0 * atrFlagB) return null; // stale breakdown

  // ── Scoring ──
  let score = 40;
  const confs: string[] = [];

  if (bestPole.dropPct > 0.1) { score += 15; confs.push("Flagpole drop >10%"); }
  else if (bestPole.dropPct > 0.07) score += 8;

  const flagRise = (flagEnd.close - flagStart.close) / flagStart.close;
  if (flagRise > 0.02 && flagRise < 0.15) { score += 15; confs.push("Flag rise 2–15%"); }
  else if (flagRise <= 0.02) score += 5;

  const poleBars = bestPole.end - bestPole.start;
  const flagBars = flagCandles.length;
  if (flagBars <= poleBars * 1.5) score += 10;

  const poleVol = avgVolume(candles, bestPole.start, bestPole.end);
  const flagVol = avgVolume(candles, poleEnd + 1, candles.length - 1);
  if (flagVol < poleVol * 0.8) { score += 15; confs.push("Volume contracting during flag"); }
  else if (flagVol < poleVol) score += 7;

  if (brokeDown) {
    const breakPct = (flagLow - latestClose) / flagLow;
    if (breakPct > 0.02) { score += 20; confs.push("Breakdown >2% below flag"); }
    else score += 10;
  }

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;

  const lines: TrendLineDef[] = [];
  const markers: MarkerDef[] = [];

  lines.push({
    startTime: flagStart.time, endTime: flagEnd.time,
    startPrice: flagStart.low, endPrice: flagEnd.low,
    style: "dashed", color: "#ef4444", width: 1, label: "Flag",
  });
  lines.push({
    startTime: flagStart.time, endTime: flagEnd.time,
    startPrice: flagStart.high, endPrice: flagEnd.high,
    style: "dashed", color: "#ef4444", width: 1,
  });

  markers.push({ time: candles[bestPole.start].time, label: "Pole", color: "#ef4444", position: "aboveBar" });
  markers.push({ time: flagEnd.time, label: `Flag ${confidence}%`, color: "#ef4444", position: "belowBar" });

  const bfEntryPrice = brokeDown ? latestClose : null;
  const target = (bfEntryPrice ?? flagLow) - (bestPole.dropPct * candles[bestPole.start].close);
  // Mirror consistency repair: stop anchored to the whole flag body's high
  // (previously the single latest bar's high — arbitrarily tight vs bull side).
  const bodyHigh = Math.max(...priorFlag.map((c) => c.high));
  const bfStopPrice = bodyHigh * (1 + STOP_CUSHION_PCT);
  const bfTargetPrice = target > 0 ? target : null;
  const bfEndIdx = idx(candles, flagEnd.time);
  const bfStatus = calcStatus(candles, bfEndIdx, bfEntryPrice, bfStopPrice, bfTargetPrice, "bearish");

  return {
    type: "bear_flag",
    direction: "bearish",
    confidence,
    lines,
    markers,
    entry: bfStatus.entryPrice,
    stopLoss: bfStopPrice,
    target: bfTargetPrice,
    riskReward: calcRR(bfStatus.entryPrice, bfStopPrice, bfTargetPrice),
    status: bfStatus.status,
    triggerPrice: bfStatus.triggerPrice ?? (brokeDown ? null : Math.min(flagStart.low, flagEnd.low)),
    orderType: "stop",
    invalidation: "Price breaks above the flag's upper trendline",
    confirmations: confs,
  };
}

// ─── 7. Ascending Triangle (bullish continuation) ──────────────────────────────

function detectAscTriangle(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (swingHighs.length < 2 || swingLows.length < 2) return null;

  // An ascending triangle has:
  //   - Flat resistance: at least 2 swing highs at similar price
  //   - Rising support: at least 2 swing lows, each higher than the last

  const recentHighs = swingHighs.slice(-6);
  const recentLows = swingLows.slice(-6);

  // Find a flat resistance level from recent highs
  for (let hi = 0; hi <= recentHighs.length - 2; hi++) {
    const rh1 = recentHighs[hi];
    const rh2 = recentHighs[hi + 1];

    // Check highs are at similar level
    const resAvg = (rh1.price + rh2.price) / 2;
    if (Math.abs(rh1.price - rh2.price) / resAvg > 0.03) continue;

    // Find at least 2 rising lows within the triangle timeframe
    // Use swingLows (full 10 entries) to maximise coverage, not recentLows (only 6)
    const lowsBefore = swingsBetween(swingLows, rh1.time, rh2.time).slice(-4);
    if (lowsBefore.length < 2) continue;

    for (let li = 0; li <= lowsBefore.length - 2; li++) {
      const rl1 = lowsBefore[li];
      const rl2 = lowsBefore[li + 1];

      // Rising low check
      if (rl2.price <= rl1.price) continue;

      // Lows must be within or near the triangle timeframe
      // Allow some flexibility — at least one low should be after rh1
      if (rl2.time < rh1.time) continue;

      const supportRise = (rl2.price - rl1.price) / rl1.price;
      if (supportRise < 0.005) continue; // was 0.01, relaxed

      // Check for breakout above resistance
      const latestClose = candles[candles.length - 1].close;
      let brokeOut = latestClose > resAvg * 1.01;
      // Q1 quality gate: confirmed breakouts only; reject stale runs.
      if (!brokeOut) continue;
      const atrAsc = atr14(candles);
      if (atrAsc > 0 && latestClose - resAvg > 2.0 * atrAsc) continue;

      // ── Scoring ──
      let score = 35;
      const confs: string[] = [];

      // Resistance touches (0–20)
      const resTightness = 20 * (1 - Math.abs(rh1.price - rh2.price) / resAvg / 0.03);
      score += Math.max(0, Math.round(resTightness));
      if (Math.abs(rh1.price - rh2.price) / resAvg < 0.015) confs.push("Resistance level tight (±1.5%)");

      // Rising support (0–20)
      if (supportRise > 0.03) { score += 20; confs.push("Rising support slope >3%"); }
      else if (supportRise > 0.015) score += 10;

      // Volume contracting (0–15)
      const volStart = avgVolume(candles, idx(candles, rh1.time) - 2, idx(candles, rh1.time) + 2);
      const volEnd = avgVolume(candles, Math.max(0, candles.length - 5), candles.length - 1);
      if (volEnd < volStart * 0.8) { score += 15; confs.push("Volume declining during formation"); }
      else if (volEnd < volStart) score += 7;

      // Breakout (0–20)
      if (brokeOut) {
        const breakPct = (latestClose - resAvg) / resAvg;
        if (breakPct > 0.03) { score += 20; confs.push("Breakout >3% above resistance"); }
        else if (breakPct > 0.01) { score += 12; confs.push("Breakout confirmed"); }
        else score += 8;
      }

      // Total touches (0–10)
      const totalTouches = swingsBetween(recentHighs, rh1.time, rh2.time).length +
        swingsBetween(recentLows, rl1.time, rl2.time).length;
      if (totalTouches >= 4) { score += 10; confs.push("4+ touches on triangle boundaries"); }

      const confidence = Math.min(Math.round(score), 100);
      if (confidence < MIN_CONFIDENCE) continue;

      // ── Output ──
      const lines: TrendLineDef[] = [];
      const markers: MarkerDef[] = [];

      // Resistance line
      lines.push({
        startTime: rh1.time, endTime: candles[candles.length - 1].time,
        startPrice: resAvg, endPrice: resAvg,
        style: "solid", color: "#ef4444", width: 1, label: "Resistance",
      });

      // Support line (rising) — project the slope through the two anchors
      // forward to the last candle so the line doesn't bend at the second anchor.
      const supportProjEnd = interpolate(
        { time: rl1.time, price: rl1.price },
        { time: rl2.time, price: rl2.price },
        candles[candles.length - 1].time,
        candles,
      );
      lines.push({
        startTime: rl1.time, endTime: candles[candles.length - 1].time,
        startPrice: rl1.price, endPrice: supportProjEnd ?? rl2.price,
        style: "solid", color: "#22c55e", width: 1, label: "Support",
      });

      markers.push({ time: rh2.time, label: `Asc △ ${confidence}%`, color: "#8b5cf6", position: "belowBar" });

      const atEntryPrice = brokeOut ? latestClose : null;
      const target =
        (atEntryPrice ?? resAvg) + (resAvg - rl1.price) * TARGET_MULT_CONTINUATION;
      const atStopPrice = rl1.price * (1 - STOP_CUSHION_PCT);
      const atEndIdx = idx(candles, rh2.time);
      const atStatus = calcStatus(candles, atEndIdx, atEntryPrice, atStopPrice, target, "bullish");

      return {
        type: "ascending_triangle",
        direction: "bullish",
        confidence,
        lines,
        markers,
        entry: atStatus.entryPrice,
        stopLoss: atStopPrice,
        target: target,
        riskReward: calcRR(atStatus.entryPrice, atStopPrice, target),
        status: atStatus.status,
        triggerPrice: atStatus.triggerPrice ?? (brokeOut ? null : resAvg),
        orderType: "stop",
        invalidation: "Price closes below the rising support line",
        confirmations: confs,
      };
    }
  }

  return null;
}

// ─── 8. Descending Triangle (bearish continuation) ─────────────────────────────

function detectDescTriangle(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  if (swingHighs.length < 2 || swingLows.length < 2) return null;

  const recentHighs = swingHighs.slice(-6);
  const recentLows = swingLows.slice(-6);

  // Find flat support from recent lows
  for (let li = 0; li <= recentLows.length - 2; li++) {
    const rl1 = recentLows[li];
    const rl2 = recentLows[li + 1];

    const supAvg = (rl1.price + rl2.price) / 2;
    if (Math.abs(rl1.price - rl2.price) / supAvg > 0.03) continue;

    // Find at least 2 declining highs within the triangle timeframe
    // Use swingHighs (full 10 entries) to maximise coverage
    const highsBefore = swingsBetween(swingHighs, rl1.time, rl2.time).slice(-4);
    if (highsBefore.length < 2) continue;

    for (let hi = 0; hi <= highsBefore.length - 2; hi++) {
      const rh1 = highsBefore[hi];
      const rh2 = highsBefore[hi + 1];

      if (rh2.price >= rh1.price) continue; // must be declining
      if (rh1.time < rl1.time || rh2.time > rl2.time) continue; // must be within timeframe

      const declinePct = (rh1.price - rh2.price) / rh1.price;
      if (declinePct < 0.005) continue; // was 0.01, relaxed

      const latestClose = candles[candles.length - 1].close;
      let brokeDown = latestClose < supAvg * 0.99;
      // Q1 quality gate: confirmed breakdowns only; reject stale runs.
      if (!brokeDown) continue;
      const atrDesc = atr14(candles);
      if (atrDesc > 0 && supAvg - latestClose > 2.0 * atrDesc) continue;

      let score = 35;
      const confs: string[] = [];

      const supTightness = 20 * (1 - Math.abs(rl1.price - rl2.price) / supAvg / 0.03);
      score += Math.max(0, Math.round(supTightness));
      if (Math.abs(rl1.price - rl2.price) / supAvg < 0.015) confs.push("Support level tight (±1.5%)");

      if (declinePct > 0.03) { score += 20; confs.push("Declining resistance slope >3%"); }
      else if (declinePct > 0.015) score += 10;

      const volStart = avgVolume(candles, idx(candles, rl1.time) - 2, idx(candles, rl1.time) + 2);
      const volEnd = avgVolume(candles, Math.max(0, candles.length - 5), candles.length - 1);
      if (volEnd < volStart * 0.8) { score += 15; confs.push("Volume declining during formation"); }
      else if (volEnd < volStart) score += 7;

      if (brokeDown) {
        const breakPct = (supAvg - latestClose) / supAvg;
        if (breakPct > 0.03) { score += 20; confs.push("Breakdown >3% below support"); }
        else if (breakPct > 0.01) { score += 12; confs.push("Breakdown confirmed"); }
        else score += 8;
      }

      const totalTouches = swingsBetween(recentLows, rl1.time, rl2.time).length +
        swingsBetween(recentHighs, rh1.time, rh2.time).length;
      if (totalTouches >= 4) { score += 10; confs.push("4+ touches on triangle boundaries"); }

      const confidence = Math.min(Math.round(score), 100);
      if (confidence < MIN_CONFIDENCE) continue;

      const lines: TrendLineDef[] = [];
      const markers: MarkerDef[] = [];

      lines.push({
        startTime: rl1.time, endTime: candles[candles.length - 1].time,
        startPrice: supAvg, endPrice: supAvg,
        style: "solid", color: "#22c55e", width: 1, label: "Support",
      });
      // Resistance line (falling) — project the slope through the two anchors
      // forward to the last candle so the line doesn't bend at the second anchor.
      const resistanceProjEnd = interpolate(
        { time: rh1.time, price: rh1.price },
        { time: rh2.time, price: rh2.price },
        candles[candles.length - 1].time,
        candles,
      );
      lines.push({
        startTime: rh1.time, endTime: candles[candles.length - 1].time,
        startPrice: rh1.price, endPrice: resistanceProjEnd ?? rh2.price,
        style: "solid", color: "#ef4444", width: 1, label: "Resistance",
      });

      markers.push({ time: rl2.time, label: `Desc △ ${confidence}%`, color: "#8b5cf6", position: "aboveBar" });

      const dtEntryPrice = brokeDown ? latestClose : null;
      const target =
        (dtEntryPrice ?? supAvg) - (rh1.price - supAvg) * TARGET_MULT_CONTINUATION;
      const dtStopPrice = rh1.price * (1 + STOP_CUSHION_PCT);
      const dtTargetPrice = target > 0 ? target : null;
      const dtEndIdx = idx(candles, rl2.time);
      const dtStatus = calcStatus(candles, dtEndIdx, dtEntryPrice, dtStopPrice, dtTargetPrice, "bearish");

      return {
        type: "descending_triangle",
        direction: "bearish",
        confidence,
        lines,
        markers,
        entry: dtStatus.entryPrice,
        stopLoss: dtStopPrice,
        target: dtTargetPrice,
        riskReward: calcRR(dtStatus.entryPrice, dtStopPrice, dtTargetPrice),
        status: dtStatus.status,
        triggerPrice: dtStatus.triggerPrice ?? (brokeDown ? null : supAvg),
        orderType: "stop",
        invalidation: "Price closes above the declining resistance line",
        confirmations: confs,
      };
    }
  }

  return null;
}

// ─── 9. Falling Wedge (bullish reversal/continuation) ──────────────────────────

function detectFallingWedge(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Falling wedge: converging trendlines sloping down.
  // Upper line (connecting swing highs) is steeper than lower line (connecting swing lows).
  // Breaks upward.

  const recentHighs = swingHighs.slice(-5);
  const recentLows = swingLows.slice(-5);

  if (recentHighs.length < 2 || recentLows.length < 2) return null;

  // Take the last 2 swing highs and last 2 swing lows
  const h1 = recentHighs[recentHighs.length - 2];
  const h2 = recentHighs[recentHighs.length - 1];
  const l1 = recentLows[recentLows.length - 2];
  const l2 = recentLows[recentLows.length - 1];

  // Both must be sloping down
  if (h2.price >= h1.price || l2.price >= l1.price) return null;

  // Time order: highs and lows must interleave or at least overlap
  const wedgeStart = Math.min(idx(candles, h1.time), idx(candles, l1.time));
  const wedgeEnd = Math.max(idx(candles, h2.time), idx(candles, l2.time));
  if (wedgeStart < 0 || wedgeEnd < 0) return null;
  // Wedge must span at least 5 bars to be meaningful
  if (wedgeEnd - wedgeStart < 5) return null;
  // Relaxed: require the two lows to occur after the first high
  // This ensures the wedge is sloping down in time (not inverted)
  if (idx(candles, l2.time) <= idx(candles, h1.time)) return null;

  // Upper line slope (should be steeper than lower line)
  const upperSlope = (h2.price - h1.price) / h1.price;
  const lowerSlope = (l2.price - l1.price) / l1.price;

  // Upper should be MORE negative (steeper down) than lower
  if (upperSlope >= lowerSlope) return null;

  // Phase R repair: convergence strength is tiered by how much steeper the
  // upper line is. The old check awarded +20 for `upperSteeper` — a boolean
  // guaranteed true by the guard above (tautology).
  const slopeGap = lowerSlope - upperSlope;

  // Check for upward breakout
  const latestClose = candles[candles.length - 1].close;
  const recentUpper = interpolate(h1, h2, candles[candles.length - 1].time, candles);
  let brokeOut = false;
  if (recentUpper !== null) {
    brokeOut = latestClose > recentUpper;
  }
  // Q1 quality gate: confirmed breakouts only; reject stale runs.
  if (!brokeOut || recentUpper === null) return null;
  const atrFw = atr14(candles);
  if (atrFw > 0 && latestClose - recentUpper > 2.0 * atrFw) return null;

  // ── Scoring ──
  let score = 30;
  const confs: string[] = [];

  // Convergence confirmation (0–20, tiered)
  if (slopeGap > 0.05) { score += 20; confs.push("Strong trendline convergence"); }
  else if (slopeGap > 0.02) { score += 12; confs.push("Moderate trendline convergence"); }
  else { score += 5; confs.push("Weak trendline convergence"); }

  // Number of touches (0–15)
  const totalTouches = recentHighs.length + recentLows.length;
  if (totalTouches >= 4) { score += 15; confs.push("4+ swing points defining the wedge"); }
  else if (totalTouches >= 3) score += 8;

  // Wedge width (0–15)
  const wedgeFirstIdx = Math.min(idx(candles, h1.time), idx(candles, l1.time));
  const wedgeLastIdx = Math.max(idx(candles, h2.time), idx(candles, l2.time));
  if (wedgeFirstIdx >= 0 && wedgeLastIdx >= 0 && (wedgeLastIdx - wedgeFirstIdx) >= 15) {
    score += 15;
    confs.push("Wedge spans 15+ bars");
  }

  // Volume contracting (0–15)
  const volStart = avgVolume(candles, Math.max(0, wedgeFirstIdx - 2), wedgeFirstIdx + 2);
  const volEnd = avgVolume(candles, Math.max(0, candles.length - 5), candles.length - 1);
  if (volEnd < volStart * 0.7) { score += 15; confs.push("Volume declining during wedge"); }
  else if (volEnd < volStart) score += 7;

  // Breakout above upper line (0–20)
  if (brokeOut && recentUpper !== null) {
    const breakPct = (latestClose - recentUpper) / recentUpper;
    if (breakPct > 0.02) { score += 20; confs.push("Breakout >2% above upper trendline"); }
    else score += 10;
  }

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;

  // ── Output ──
  const lines: TrendLineDef[] = [];
  const markers: MarkerDef[] = [];

  // Upper line (resistance) — project the slope through h1→h2 to the last candle
  const fwUpperProjEnd = interpolate(
    { time: h1.time, price: h1.price },
    { time: h2.time, price: h2.price },
    candles[candles.length - 1].time,
    candles,
  );
  lines.push({
    startTime: h1.time, endTime: candles[candles.length - 1].time,
    startPrice: h1.price, endPrice: fwUpperProjEnd ?? h2.price,
    style: "solid", color: "#ef4444", width: 1, label: "Resistance",
  });

  // Lower line (support) — project the slope through l1→l2 to the last candle
  const fwLowerProjEnd = interpolate(
    { time: l1.time, price: l1.price },
    { time: l2.time, price: l2.price },
    candles[candles.length - 1].time,
    candles,
  );
  lines.push({
    startTime: l1.time, endTime: candles[candles.length - 1].time,
    startPrice: l1.price, endPrice: fwLowerProjEnd ?? l2.price,
    style: "solid", color: "#22c55e", width: 1, label: "Support",
  });

  markers.push({ time: l2.time, label: `F. Wedge ${confidence}%`, color: "#22c55e", position: "aboveBar" });

  const fwEntryPrice = brokeOut ? latestClose : null;
  const fwStopPrice = l2.price * (1 - STOP_CUSHION_PCT);
  const fwTarget =
    (fwEntryPrice ?? h2.price) +
    (h1.price - l1.price) * TARGET_MULT_CONTINUATION;
  const fwEndIdx = idx(candles, l2.time);
  const fwStatus = calcStatus(candles, fwEndIdx, fwEntryPrice, fwStopPrice, fwTarget, "bullish");

  return {
    type: "falling_wedge",
    direction: "bullish",
    confidence,
    lines,
    markers,
    entry: fwStatus.entryPrice,
    stopLoss: fwStopPrice,
    target: fwTarget,
    riskReward: calcRR(fwStatus.entryPrice, fwStopPrice, fwTarget),
    status: fwStatus.status,
    triggerPrice: fwStatus.triggerPrice ?? (brokeOut ? null : h2.price),
    orderType: "stop",
    invalidation: "Price closes below the lower trendline",
    confirmations: confs,
  };
}

// ─── 10. Cup & Handle (bullish continuation) ───────────────────────────────────

function detectCupHandle(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Cup: U-shaped trough (rounded bottom) preceded by a down-move and followed by an up-move
  // Handle: small pullback after the cup's right rim, then breakout

  if (candles.length < CUP_MIN_BARS) return null;

  // Simplified approach:
  // 1. Find the lowest low in the last 60 bars (bottom of cup)
  const lookback = Math.min(60, candles.length);
  const startSearch = candles.length - lookback;

  let cupBottomIdx = startSearch;
  let cupBottomPrice = candles[startSearch].low;
  for (let i = startSearch; i < candles.length; i++) {
    if (candles[i].low < cupBottomPrice) {
      cupBottomPrice = candles[i].low;
      cupBottomIdx = i;
    }
  }

  // 2. The cup bottom should be roughly in the middle third of the lookback window
  if (cupBottomIdx < startSearch + lookback * 0.2 || cupBottomIdx > startSearch + lookback * 0.8) return null;

  // 3. Left side: price declined into the bottom
  const leftStartPrice = candles[startSearch].close;
  const leftDecline = (leftStartPrice - cupBottomPrice) / leftStartPrice;
  if (leftDecline < 0.05) return null; // need at least 5% decline

  // 4. Right side: price rose from bottom
  const rightEndIdx = candles.length - 1;
  const rightRise = (candles[rightEndIdx].close - cupBottomPrice) / cupBottomPrice;
  if (rightRise < 0.03) return null; // need at least 3% rise

  // 5. The cup should be U-shaped (not V-shaped)
  // Check for a period of sideways/base near the bottom (at least 3 bars within 2% of bottom)
  let baseBars = 0;
  for (let i = cupBottomIdx - 2; i <= cupBottomIdx + 2; i++) {
    if (i >= 0 && i < candles.length) {
      const pctFromBottom = (candles[i].close - cupBottomPrice) / cupBottomPrice;
      if (pctFromBottom < 0.02) baseBars++;
    }
  }
  const uShape = baseBars >= 3;

  // 6. Handle: small pullback in the last few bars (right side of cup)
  const handleLookback = Math.min(10, candles.length - cupBottomIdx);
  const handleStart = candles.length - handleLookback;
  const handleDrop = (candles[handleStart].close - candles[candles.length - 1].close) / candles[handleStart].close;
  const hasHandle = handleDrop > 0.01 && handleDrop < 0.15; // small pullback

  // 7. Check for breakout above the cup's right rim
  // Rim = highest point before the handle (or before the end)
  let rimPrice = 0;
  let rimTime = "";
  for (let i = cupBottomIdx + 3; i < handleStart; i++) {
    if (candles[i].high > rimPrice) {
      rimPrice = candles[i].high;
      rimTime = candles[i].time;
    }
  }
  if (rimPrice === 0) return null;

  const latestClose = candles[candles.length - 1].close;
  let brokeOut = latestClose > rimPrice;
  // Q1 quality gate: confirmed rim breakouts only; reject stale runs.
  if (!brokeOut) return null;
  const atrCup = atr14(candles);
  if (atrCup > 0 && latestClose - rimPrice > 2.0 * atrCup) return null;

  // ── Scoring ──
  let score = 20;
  const confs: string[] = [];

  // Cup depth (0–20)
  const cupDepth = (leftStartPrice - cupBottomPrice) / leftStartPrice;
  if (cupDepth > 0.1 && cupDepth < 0.5) { score += 20; confs.push("Cup depth 10–50%"); }
  else if (cupDepth > 0.05) score += 10;

  // U-shape (0–20)
  if (uShape) { score += 20; confs.push("Rounded (U-shaped) bottom"); }
  else score += 5;

  // Handle (0–20)
  if (hasHandle) {
    score += 20;
    confs.push("Handle pullback present (1–15%)");
  }

  // Cup width (0–15)
  if (lookback >= 40) {
    score += 15;
    confs.push("Cup spans 40+ bars (long-term formation)");
  } else if (lookback >= 25) {
    score += 8;
  }

  // Volume: left side higher, bottom low, right side increasing (0–15)
  const leftVol = avgVolume(candles, startSearch, cupBottomIdx - 2);
  const bottomVol = avgVolume(candles, Math.max(0, cupBottomIdx - 2), cupBottomIdx + 2);
  const rightVol = avgVolume(candles, cupBottomIdx + 3, candles.length - 1);
  if (bottomVol < leftVol && rightVol > bottomVol) {
    score += 15;
    confs.push("Volume contraction at bottom, expansion on right side");
  } else if (bottomVol < leftVol) {
    score += 7;
  }

  // Breakout (0–10)
  if (brokeOut) {
    const breakPct = (latestClose - rimPrice) / rimPrice;
    if (breakPct > 0.02) { score += 10; confs.push("Breakout >2% above rim"); }
    else score += 5;
  }

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;

  // ── Output ──
  const lines: TrendLineDef[] = [];
  const markers: MarkerDef[] = [];

  // Cup rim line
  lines.push({
    startTime: rimTime, endTime: candles[candles.length - 1].time,
    startPrice: rimPrice, endPrice: rimPrice,
    style: "dashed", color: "#8b5cf6", width: 1, label: "Rim",
  });

  if (hasHandle) {
    markers.push({ time: candles[candles.length - 1].time, label: `C&H ${confidence}%`, color: "#8b5cf6", position: "aboveBar" });
  } else {
    markers.push({ time: rimTime, label: "Cup", color: "#8b5cf6", position: "aboveBar" });
  }

  const chEntryPrice = brokeOut ? latestClose : null;
  const target =
    (chEntryPrice ?? rimPrice) + cupDepth * cupBottomPrice * TARGET_MULT_CONTINUATION;
  const chStopPrice = cupBottomPrice * (1 - STOP_CUSHION_PCT);
  const chEndIdx = idx(candles, rimTime);
  const chStatus = calcStatus(candles, chEndIdx, chEntryPrice, chStopPrice, target, "bullish");

  return {
    type: "cup_and_handle",
    direction: "bullish",
    confidence,
    lines,
    markers,
    entry: chStatus.entryPrice,
    stopLoss: chStopPrice,
    target: target,
    riskReward: calcRR(chStatus.entryPrice, chStopPrice, target),
    status: chStatus.status,
    triggerPrice: chStatus.triggerPrice ?? (brokeOut ? null : rimPrice * 1.01),
    orderType: "stop",
    invalidation: "Price closes below the cup's bottom",
    confirmations: confs,
  };
}

// ─── Phases 1–5: experimental classical patterns (mirrored from backend) ──────
// Mirrors engine/pattern_engine.py Phases 0–5. These detectors stay disabled
// until the reliability calibration has produced weights for them; while
// enabled they sit under a probation confidence cap so an unvalidated pattern
// can never outrank a validated setup scoring 90+.

// Patterns detected but NOT yet enabled in production (post-F2 calibration
// verdicts in backend scripts/reliability_calibration.json):
// rising_wedge 28.6% WR, -0.31R, n=129 (real but negative net of costs);
// triple_top 8.3% WR, -0.73R, n=15; rounding_top/rounding_bottom/
// island_reversal insufficient trades.
const EXPERIMENTAL_PATTERNS = new Set<string>([
  "rising_wedge",
  "triple_top",
  "rounding_top",
  "rounding_bottom",
  "island_reversal",
]);
const ENABLE_EXPERIMENTAL_PATTERNS = false;
const EXPERIMENTAL_CONFIDENCE_CAP = 89;

// Patterns with measured NEGATIVE expectancy that still pass the confidence
// gate. Kept in the engine for calibration/backtest but excluded from
// production output until a fresh calibration shows >= +0.10R.
// Mirrors backend engine/pattern_engine.py LOW_EDGE_PATTERNS (2026-09-03 cal):
//   head_and_shoulders: 50.0% WR, -0.42R/trade, n=30
//   symmetrical_triangle: 26.2% WR, -0.19R/trade, n=409
//   bull_flag: 14.3% WR, -0.56R/trade, n=9
//   cup_and_handle: 44.4% WR, -0.11R/trade, n=22 (added 2026-09-03)
// NOTE: falling_wedge is deliberately NOT gated (+0.48R, n=72 — positive edge).
const LOW_EDGE_PATTERNS = new Set<string>([
  "head_and_shoulders",
  "symmetrical_triangle",
  "bull_flag",
  "cup_and_handle",
]);
const ENABLE_LOW_EDGE_PATTERNS = false;

// Rising wedge entry-model rework (mirror of backend constants; full evidence
// trail in backend engine/pattern_engine.py):
//   break entry sweep:  -0.29..-0.40R at every target multiple (n=164-350)
//   retest entry sweep: +0.106R at 1.0x (n=47); negative at 1.5x/2.0x
//   holdout 60/40:      IS -0.168R (n=26) vs OOS +0.402R (n=23)
// Official standard-universe calibration: +0.25R (n=16, 55.6% WR [27,81]).
// Stays experimental-gated one more cycle (overlapping samples, post-hoc
// selection); graduates if the next fresh-data recalibration prints
// >= +0.10R with combined n >= 50.
let RISING_WEDGE_TARGET_MULT = 1.0;
const RISING_WEDGE_ENTRY_MODE = "retest";

/** True Range of bar i (requires i >= 1) — mirrors backend `_tr`. */
function trAt(candles: OHLCVInput[], i: number): number {
  return Math.max(
    candles[i].high - candles[i].low,
    Math.abs(candles[i].high - candles[i - 1].close),
    Math.abs(candles[i].low - candles[i - 1].close),
  );
}

/**
 * ATR at the last bar — Wilder-smoothed (Q2 repair, mirrors backend `_atr`).
 * Seed = simple mean of the first `period` TRs, then recursive smoothing
 * atr = (prev*(period-1) + tr) / period. Fewer than `period` TRs available →
 * simple mean of what exists (deterministic short-window fallback).
 */
function atr14(candles: OHLCVInput[], period: number = 14): number {
  const n = candles.length;
  if (n < 2) return 0;
  const trCount = n - 1; // TRs exist for bars 1..n-1
  if (trCount < period) {
    let total = 0;
    for (let i = 1; i < n; i++) total += trAt(candles, i);
    return total / trCount;
  }
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trAt(candles, i);
  atr /= period;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + trAt(candles, i)) / period;
  }
  return atr;
}

/** True gap list: bar range fully separated from the prior bar's range. */
function findGaps(
  candles: OHLCVInput[],
  minGapPct: number,
): { idx: number; time: string; direction: "up" | "down"; sizePct: number }[] {
  const gaps: { idx: number; time: string; direction: "up" | "down"; sizePct: number }[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (prev.close <= 0) continue;
    if (cur.low > prev.high) {
      const size = (cur.low - prev.high) / prev.close;
      if (size >= minGapPct)
        gaps.push({ idx: i, time: cur.time, direction: "up", sizePct: size });
    } else if (cur.high < prev.low) {
      const size = (prev.low - cur.high) / prev.close;
      if (size >= minGapPct)
        gaps.push({ idx: i, time: cur.time, direction: "down", sizePct: size });
    }
  }
  return gaps;
}

// ─── Symmetrical Triangle (bilateral continuation) ──────────────────────────────

function detectSymTriangle(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Lower highs + higher lows between converging lines (chart_patterns.md §17).
  // Bilateral: direction comes from the breakout side. Only a FRESH break is
  // reported — dormant geometry floods the top-3 dispatcher slots.
  const n = candles.length;
  if (n < 40 || swingHighs.length < 2 || swingLows.length < 2) return null;

  const rh = swingHighs.slice(-6);
  const rl = swingLows.slice(-6);
  const latestClose = candles[n - 1].close;

  // Non-adjacent high pairs (span <= 4 swings): a bounce between the two
  // defining highs always registers its own swing high, so adjacent-only
  // pairing would never see past it.
  for (let hi = 0; hi < rh.length - 1; hi++) {
    for (let hj = hi + 1; hj < Math.min(hi + 5, rh.length); hj++) {
      const h1 = rh[hi];
      const h2 = rh[hj];
      if (!(h1.time < h2.time) || h2.price >= h1.price) continue;

      const lowsBetween = swingsBetween(rl, h1.time, candles[n - 1].time).slice(-3);
      for (let li = 0; li < lowsBetween.length - 1; li++) {
        const l1 = lowsBetween[li];
        const l2 = lowsBetween[li + 1];
        if (!(l1.time < l2.time) || l2.price <= l1.price) continue;
        if (l1.time <= h1.time) continue; // formation must interleave: H before L

        const iH1 = idx(candles, h1.time);
        const iH2 = idx(candles, h2.time);
        const iL1 = idx(candles, l1.time);
        const iL2 = idx(candles, l2.time);
        if (iH1 < 0 || iL1 < 0 || iH2 <= iH1 || iL2 <= iL1) continue;

        const upperStart = interpolate(h1, h2, l1.time, candles);
        const lowerEnd = interpolate(l1, l2, h2.time, candles);
        if (upperStart === null || lowerEnd === null) continue;
        if (lowerEnd >= upperStart) continue; // lines cross inside the formation

        const upperNow = interpolate(h1, h2, candles[n - 1].time, candles);
        const lowerNow = interpolate(l1, l2, candles[n - 1].time, candles);
        if (upperNow === null || lowerNow === null) continue;
        if (upperNow <= lowerNow) continue; // apex already passed

        const brokeUp = latestClose > upperNow;
        const brokeDown = latestClose < lowerNow;
        if (brokeUp && brokeDown) continue;
        if (!brokeUp && !brokeDown) continue; // only actionable on the break
        const atr = atr14(candles);
        const resRef = brokeUp ? upperNow : lowerNow;
        if (atr > 0 && Math.abs(latestClose - resRef) > 2.0 * atr) continue; // stale break

        let score = 35;
        const confs: string[] = [];

        // Convergence is the defining property — hard gate at 15% narrowing.
        const widthStart = upperStart - l1.price;
        const widthNow = upperNow - lowerNow;
        if (widthStart <= 0 || widthNow <= 0) continue;
        const compression = 1 - widthNow / widthStart;
        if (compression <= 0.15) continue;
        if (compression > 0.35) { score += 20; confs.push("Strong line convergence"); }
        else { score += 12; confs.push("Moderate line convergence"); }

        // Touches (0–15)
        const touches =
          swingsBetween(swingHighs, h1.time, h2.time).length + 2 +
          swingsBetween(swingLows, l1.time, l2.time).length + 2;
        if (touches >= 5) { score += 15; confs.push("5+ boundary touches"); }
        else if (touches >= 4) score += 10;

        // Volume contraction (0–15)
        const volStartIdx = Math.min(iH1, iL1);
        const volStart = avgVolume(candles, volStartIdx, volStartIdx + 4);
        const volEnd = avgVolume(candles, Math.max(0, n - 5), n - 1);
        if (volEnd < volStart * 0.75) { score += 15; confs.push("Volume contracting into apex"); }
        else if (volEnd < volStart) score += 7;

        // Breakout (0–25) — guaranteed present (gated above)
        const bp = Math.abs(latestClose - resRef) / resRef;
        if (bp > 0.02) {
          score += 25;
          confs.push(brokeUp ? "Breakout > upper line >2%" : "Breakdown > lower line >2%");
        } else {
          score += 15;
          confs.push("Breakout confirmed");
        }

        const confidence = Math.min(Math.round(score), 100);
        if (confidence < MIN_CONFIDENCE) continue;

        // Measured move: triangle height at the first touch pair
        const direction = brokeUp ? "bullish" : "bearish";
        const height = Math.abs(h1.price - l1.price);
        const entryPrice = latestClose;
        const stopPrice = brokeDown
          ? upperNow * (1 + STOP_CUSHION_PCT)
          : lowerNow * (1 - STOP_CUSHION_PCT);
        const target = brokeDown
          ? latestClose - height * TARGET_MULT_CONTINUATION
          : latestClose + height * TARGET_MULT_CONTINUATION;
        const targetPrice = target > 0 ? target : null;

        // Project both trendlines through their anchors forward to the last
        // candle so they don't bend at the second anchor.
        const symUpperProjEnd = interpolate(h1, h2, candles[n - 1].time, candles);
        const symLowerProjEnd = interpolate(l1, l2, candles[n - 1].time, candles);
        const lines: TrendLineDef[] = [
          { startTime: h1.time, endTime: candles[n - 1].time, startPrice: h1.price, endPrice: symUpperProjEnd ?? h2.price, style: "solid", color: "#ef4444", width: 1, label: "Resistance" },
          { startTime: l1.time, endTime: candles[n - 1].time, startPrice: l1.price, endPrice: symLowerProjEnd ?? l2.price, style: "solid", color: "#22c55e", width: 1, label: "Support" },
        ];
        const markers: MarkerDef[] = [
          { time: candles[n - 1].time, label: `SymTri ${confidence}%`, color: brokeUp ? "#22c55e" : "#ef4444", position: brokeUp ? "belowBar" : "aboveBar" },
        ];
        const st = calcStatus(candles, Math.max(iH2, iL2), entryPrice, stopPrice, targetPrice, direction);

        return {
          type: "symmetrical_triangle",
          direction,
          confidence,
          lines,
          markers,
          entry: st.entryPrice,
          stopLoss: stopPrice,
          target: targetPrice,
          riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
          status: st.status,
          triggerPrice: st.triggerPrice ?? null,
          orderType: "stop",
          invalidation: brokeUp
            ? "Price closes back below the lower trendline"
            : "Price closes back above the upper trendline",
          confirmations: confs,
        };
      }
    }
  }
  return null;
}

// ─── Rising Wedge (bearish continuation) ────────────────────────────────────────

function detectRisingWedge(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Both trendlines rise, lower rises faster (converging); breaks down (§13).
  // Mirror of the repaired falling-wedge logic with the same structural fix:
  // non-adjacent high pairs + lows scanned from the first high to series end.
  const n = candles.length;
  if (n < 40 || swingHighs.length < 2 || swingLows.length < 2) return null;

  const recentHighs = swingHighs.slice(-6);
  const recentLows = swingLows.slice(-6);
  const latestClose = candles[n - 1].close;

  for (let hi = 0; hi < recentHighs.length - 1; hi++) {
    for (let hj = hi + 1; hj < Math.min(hi + 5, recentHighs.length); hj++) {
      const h1 = recentHighs[hi];
      const h2 = recentHighs[hj];
      if (!(h1.time < h2.time) || h2.price <= h1.price) continue;

      const lowsBetween = swingsBetween(recentLows, h1.time, candles[n - 1].time).slice(-3);
      for (let li = 0; li < lowsBetween.length - 1; li++) {
        const l1 = lowsBetween[li];
        const l2 = lowsBetween[li + 1];
        if (!(l1.time < l2.time) || l2.price <= l1.price) continue;
        if (l1.time <= h1.time) continue; // formation must interleave: H before L

        const iH1 = idx(candles, h1.time);
        const iH2 = idx(candles, h2.time);
        const iL1 = idx(candles, l1.time);
        const iL2 = idx(candles, l2.time);
        if (iH1 < 0 || iH2 < 0 || iL1 < 0 || iL2 < 0 || iH2 <= iH1 || iL2 <= iL1) continue;

        const upperSlope = (h2.price - h1.price) / (iH2 - iH1);
        const lowerSlope = (l2.price - l1.price) / (iL2 - iL1);
        if (upperSlope <= 0 || lowerSlope <= 0) continue;
        const slopeGap = lowerSlope - upperSlope;
        if (slopeGap <= 0) continue;
        // At least moderate convergence required — parallel-ish lines are a
        // channel, not a wedge.
        if (slopeGap <= 0.2 * Math.abs(upperSlope)) continue;

        const upperNow = interpolate(h1, h2, candles[n - 1].time, candles);
        const lowerNow = interpolate(l1, l2, candles[n - 1].time, candles);
        if (upperNow === null || lowerNow === null || lowerNow >= upperNow) continue;

        const atr = atr14(candles);
        let bp: number;
        if (RISING_WEDGE_ENTRY_MODE === "retest") {
          // Retest entry model: never short the breakdown bar itself (sweep-
          // verified deficit). Require a decisive close below the lower line
          // within the last 10 bars, then enter on the pullback to the line's
          // underside. Invalidate if the break failed (close above upper line).
          let breakBar = -1;
          let breakLine: number | null = null;
          for (let j = n - 2; j >= Math.max(0, n - 12); j--) {
            const lj = interpolate(l1, l2, candles[j].time, candles);
            if (lj !== null && candles[j].close < lj) { breakBar = j; breakLine = lj; break; }
          }
          if (breakBar < 0 || breakLine === null || atr <= 0) continue;
          if (latestClose < lowerNow - 0.35 * atr || latestClose > upperNow) continue;
          bp = (breakLine - candles[breakBar].close) / breakLine;
        } else {
          if (!(latestClose < lowerNow)) continue; // continuation patterns ARE the trade
          if (atr > 0 && lowerNow - latestClose > 2.0 * atr) continue; // stale break
          bp = (lowerNow - latestClose) / lowerNow;
        }

        // Regime gate: a rising wedge is a CONTINUATION structure only in a
        // downtrend; in an uptrend the same shape is a reversal warning.
        // Mirror of backend `_sma` gate (skip without 50 bars of context).
        if (n < 50) continue;
        let smaSum = 0;
        for (let si = n - 50; si < n; si++) smaSum += candles[si].close;
        if (latestClose >= smaSum / 50) continue;

        let score = 35;
        const confs: string[] = [];
        const relGap = slopeGap / Math.max(Math.abs(upperSlope), 1e-9);
        if (relGap > 0.5) { score += 20; confs.push("Strong trendline convergence"); }
        else { score += 12; confs.push("Moderate trendline convergence"); }

        const totalTouches =
          swingsBetween(recentHighs, h1.time, h2.time).length + 2 + lowsBetween.length;
        if (totalTouches >= 5) { score += 15; confs.push("5+ swing points defining the wedge"); }
        else if (totalTouches >= 4) score += 10;

        const wedgeFirst = Math.min(iH1, iL1);
        const wedgeLast = Math.max(iH2, iL2);
        if (wedgeLast - wedgeFirst >= 15) { score += 15; confs.push("Wedge spans 15+ bars"); }

        const volStart = avgVolume(candles, Math.max(0, wedgeFirst - 2), wedgeFirst + 2);
        const volEnd = avgVolume(candles, Math.max(0, n - 5), n - 1);
        if (volEnd < volStart * 0.7) { score += 15; confs.push("Volume declining during wedge"); }
        else if (volEnd < volStart) score += 7;

        if (bp > 0.02) { score += 25; confs.push("Breakdown >2% below lower line"); }
        else { score += 15; confs.push("Breakdown confirmed"); }

        const confidence = Math.min(Math.round(score), 100);
        if (confidence < MIN_CONFIDENCE) continue;

        const entryPrice = latestClose;
        const height = Math.max(upperNow, h2.price) - Math.min(lowerNow, l1.price);
        const stopPrice = upperNow * (1 + STOP_CUSHION_PCT);
        const target = latestClose - height * RISING_WEDGE_TARGET_MULT;
        const targetPrice = target > 0 ? target : null;

        // Project both wedge lines through their anchors to the last candle
        const rwUpperProjEnd = interpolate(
          { time: h1.time, price: h1.price },
          { time: h2.time, price: h2.price },
          candles[n - 1].time,
          candles,
        );
        const rwLowerProjEnd = interpolate(
          { time: l1.time, price: l1.price },
          { time: l2.time, price: l2.price },
          candles[n - 1].time,
          candles,
        );
        const lines: TrendLineDef[] = [
          { startTime: h1.time, endTime: candles[n - 1].time, startPrice: h1.price, endPrice: rwUpperProjEnd ?? h2.price, style: "solid", color: "#ef4444", width: 1, label: "Resistance" },
          { startTime: l1.time, endTime: candles[n - 1].time, startPrice: l1.price, endPrice: rwLowerProjEnd ?? l2.price, style: "solid", color: "#22c55e", width: 1, label: "Support" },
        ];
        const markers: MarkerDef[] = [
          { time: candles[n - 1].time, label: `R. Wedge ${confidence}%`, color: "#ef4444", position: "aboveBar" },
        ];
        const st = calcStatus(candles, wedgeLast, entryPrice, stopPrice, targetPrice, "bearish");

        return {
          type: "rising_wedge",
          direction: "bearish",
          confidence,
          lines,
          markers,
          entry: st.entryPrice,
          stopLoss: stopPrice,
          target: targetPrice,
          riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
          status: st.status,
          triggerPrice: st.triggerPrice ?? null,
          orderType: "stop",
          invalidation: "Price closes back above the upper trendline",
          confirmations: confs,
        };
      }
    }
  }
  return null;
}

// ─── Triple Top (bearish reversal) ──────────────────────────────────────────────

function detectTripleTop(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Three equal peaks, two similar troughs between, breakdown confirms (§5).
  if (swingHighs.length < 3 || swingLows.length < 2) return null;
  const n = candles.length;
  const recent = swingHighs.slice(-7);

  for (let i = 0; i < recent.length - 2; i++) {
    const p1 = recent[i];
    const p2 = recent[i + 1];
    const p3 = recent[i + 2];
    if (!(p1.time < p2.time && p2.time < p3.time)) continue;
    const peakAvg = (p1.price + p2.price + p3.price) / 3;
    const maxDev = Math.max(
      Math.abs(p1.price - peakAvg), Math.abs(p2.price - peakAvg), Math.abs(p3.price - peakAvg),
    ) / peakAvg;
    if (maxDev > PEAK_EQUALITY_PCT) continue;

    const t1 = minSwingBetween(swingLows, p1.time, p2.time);
    const t2 = minSwingBetween(swingLows, p2.time, p3.time);
    if (!t1 || !t2) continue;
    const support = Math.min(t1.price, t2.price);
    if ((peakAvg - support) / peakAvg < 0.02) continue;

    const iP1 = idx(candles, p1.time);
    const iP3 = idx(candles, p3.time);
    const iT2 = idx(candles, t2.time);
    let breakBar = -1;
    for (let j = Math.max(iP3, iT2); j < n; j++) {
      if (candles[j].close < support && candles[j].low < support) { breakBar = j; break; }
    }

    let score = 30;
    const confs: string[] = [];
    score += Math.max(0, Math.round(20 * (1 - maxDev / PEAK_EQUALITY_PCT)));
    const v1 = avgVolume(candles, iP1 - 2, iP1 + 2);
    const v3 = avgVolume(candles, iP3 - 2, iP3 + 2);
    if (v3 < v1 * 0.8) { score += 15; confs.push("Volume lower on 3rd peak"); }
    else if (v3 < v1) score += 8;
    if (breakBar >= 0) {
      const bp = (support - candles[breakBar].close) / support;
      if (bp > 0.02) { score += 25; confs.push("Breakdown >2% below support"); }
      else { score += 15; confs.push("Breakdown confirmed"); }
    } else {
      if ((candles[n - 1].close - support) / support < 0.01) score += 5;
    }
    if (iP3 - iP1 >= 15) { score += 10; confs.push("Pattern spans 15+ bars"); }
    const troughSim = Math.abs(t1.price - t2.price) / Math.max(t1.price, 1e-9);
    if (troughSim < 0.03) { score += 10; confs.push("Intervening troughs at similar level"); }

    const confidence = Math.min(Math.round(score), 100);
    if (confidence < MIN_CONFIDENCE) continue;

    const entryPrice = breakBar >= 0 ? candles[breakBar].close : null;
    const stopPrice = peakAvg * (1 + STOP_CUSHION_PCT);
    const target = support - (peakAvg - support) * TARGET_MULT_REVERSAL;
    const targetPrice = target > 0 ? target : null;

    const lines: TrendLineDef[] = [
      { startTime: p1.time, endTime: candles[n - 1].time, startPrice: peakAvg, endPrice: peakAvg, style: "solid", color: "#ef4444", width: 1, label: "Peak level" },
      { startTime: t1.time, endTime: candles[n - 1].time, startPrice: support, endPrice: support, style: "dashed", color: "#22c55e", width: 1, label: "Support" },
    ];
    const markers: MarkerDef[] = [
      { time: p3.time, label: `3Top ${confidence}%`, color: "#ef4444", position: "aboveBar" },
    ];
    const st = calcStatus(candles, Math.max(iP3, iT2), entryPrice, stopPrice, targetPrice, "bearish");

    return {
      type: "triple_top",
      direction: "bearish",
      confidence,
      lines,
      markers,
      entry: st.entryPrice,
      stopLoss: stopPrice,
      target: targetPrice,
      riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
      status: st.status,
      triggerPrice: st.triggerPrice ?? (entryPrice === null ? support : null),
      orderType: "stop",
      invalidation: "Price closes above the peak level",
      confirmations: confs,
    };
  }
  return null;
}

// ─── Triple Bottom (bullish reversal) ───────────────────────────────────────────

function detectTripleBottom(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Three equal troughs, two similar peaks between, breakout confirms (§6).
  if (swingLows.length < 3 || swingHighs.length < 2) return null;
  const n = candles.length;
  const recent = swingLows.slice(-7);

  for (let i = 0; i < recent.length - 2; i++) {
    const t1 = recent[i];
    const t2 = recent[i + 1];
    const t3 = recent[i + 2];
    if (!(t1.time < t2.time && t2.time < t3.time)) continue;
    const troughAvg = (t1.price + t2.price + t3.price) / 3;
    const maxDev = Math.max(
      Math.abs(t1.price - troughAvg), Math.abs(t2.price - troughAvg), Math.abs(t3.price - troughAvg),
    ) / troughAvg;
    if (maxDev > PEAK_EQUALITY_PCT) continue;

    const m1 = maxSwingBetween(swingHighs, t1.time, t2.time);
    const m2 = maxSwingBetween(swingHighs, t2.time, t3.time);
    if (!m1 || !m2) continue;
    const resistance = Math.max(m1.price, m2.price);
    if ((resistance - troughAvg) / troughAvg < 0.02) continue;

    const iT1 = idx(candles, t1.time);
    const iT3 = idx(candles, t3.time);
    const iM2 = idx(candles, m2.time);
    let breakBar = -1;
    for (let j = Math.max(iT3, iM2); j < n; j++) {
      if (candles[j].close > resistance && candles[j].high > resistance) { breakBar = j; break; }
    }

    let score = 30;
    const confs: string[] = [];
    score += Math.max(0, Math.round(20 * (1 - maxDev / PEAK_EQUALITY_PCT)));
    const v1 = avgVolume(candles, iT1 - 2, iT1 + 2);
    const v3 = avgVolume(candles, iT3 - 2, iT3 + 2);
    if (v3 > v1 * 1.1) { score += 15; confs.push("Volume higher on 3rd bottom (accumulation)"); }
    else if (v3 > v1) score += 8;
    if (breakBar >= 0) {
      const bp = (candles[breakBar].close - resistance) / resistance;
      if (bp > 0.02) { score += 25; confs.push("Breakout >2% above resistance"); }
      else { score += 15; confs.push("Breakout confirmed"); }
    } else {
      if ((resistance - candles[n - 1].close) / resistance < 0.01) score += 5;
    }
    if (iT3 - iT1 >= 15) { score += 10; confs.push("Pattern spans 15+ bars"); }
    const peakSim = Math.abs(m1.price - m2.price) / Math.max(m1.price, 1e-9);
    if (peakSim < 0.03) { score += 10; confs.push("Intervening peaks at similar level"); }

    const confidence = Math.min(Math.round(score), 100);
    if (confidence < MIN_CONFIDENCE) continue;

    const entryPrice = breakBar >= 0 ? candles[breakBar].close : null;
    const stopPrice = troughAvg * (1 - STOP_CUSHION_PCT);
    const target = resistance + (resistance - troughAvg) * TARGET_MULT_REVERSAL;
    const targetPrice = target > 0 ? target : null;

    const lines: TrendLineDef[] = [
      { startTime: t1.time, endTime: candles[n - 1].time, startPrice: troughAvg, endPrice: troughAvg, style: "solid", color: "#22c55e", width: 1, label: "Trough level" },
      { startTime: m1.time, endTime: candles[n - 1].time, startPrice: resistance, endPrice: resistance, style: "dashed", color: "#ef4444", width: 1, label: "Resistance" },
    ];
    const markers: MarkerDef[] = [
      { time: t3.time, label: `3Bot ${confidence}%`, color: "#22c55e", position: "belowBar" },
    ];
    const st = calcStatus(candles, Math.max(iT3, iM2), entryPrice, stopPrice, targetPrice, "bullish");

    return {
      type: "triple_bottom",
      direction: "bullish",
      confidence,
      lines,
      markers,
      entry: st.entryPrice,
      stopLoss: stopPrice,
      target: targetPrice,
      riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
      status: st.status,
      triggerPrice: st.triggerPrice ?? (entryPrice === null ? resistance : null),
      orderType: "stop",
      invalidation: "Price closes below the trough level",
      confirmations: confs,
    };
  }
  return null;
}

// ─── Rounding Bottom / Rounding Top (reversal saucers) ──────────────────────────

/** Segment-mean curve used by both rounding detectors (mirrors `_rounding_shape`). */
function roundingShape(closes: number[], seg = 6): number[] | null {
  const means: number[] = [];
  for (let k = 0; k + seg <= closes.length; k += seg) {
    let total = 0;
    for (let j = k; j < k + seg; j++) total += closes[j];
    means.push(total / seg);
  }
  return means.length >= 5 ? means : null;
}

function detectRoundingBottom(
  candles: OHLCVInput[],
  _swingHighs: { time: string; price: number }[],
  _swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Smooth U-shaped saucer after a decline; volume U confirms (§8).
  const n = candles.length;
  if (n < 45) return null;
  const window = candles.slice(-60);
  const means = roundingShape(window.map((c) => c.close));
  if (!means) return null;
  const third = Math.floor(means.length / 3);
  const left = means.slice(0, third);
  const mid = means.slice(third, 2 * third);
  const right = means.slice(2 * third);
  const leftSlope = (left[left.length - 1] - left[0]) / Math.abs(left[0]);
  const rightSlope = (right[right.length - 1] - right[0]) / Math.abs(right[0]);
  const midSlope = (mid[mid.length - 1] - mid[0]) / Math.abs(mid[0]);
  if (leftSlope > -0.01 || rightSlope < 0.01 || Math.abs(midSlope) > 0.02) return null;
  const bottom = Math.min(...means);
  const leftHigh = Math.max(...window.slice(0, 20).map((c) => c.high));
  const depth = (leftHigh - bottom) / leftHigh;
  if (depth < 0.05) return null;

  let score = 35;
  const confs: string[] = [];
  if (depth > 0.12) { score += 20; confs.push("Saucer depth >12%"); }
  else if (depth > 0.08) score += 12;
  const overallDir = means[means.length - 1] - means[0];
  let turns = 0;
  for (let k = 1; k < means.length; k++) {
    if ((means[k] - means[k - 1]) * overallDir < 0) turns++;
  }
  if (turns <= 2) { score += 15; confs.push("Smooth arc (few direction changes)"); }
  else if (turns <= 4) score += 7;
  const volStart = avgVolume(candles, n - 60, n - 45);
  const volMid = avgVolume(candles, n - 30, n - 16);
  const volEnd = avgVolume(candles, n - 8, n - 1);
  if (volEnd > volMid * 1.2 && volMid < volStart) {
    score += 15;
    confs.push("Volume U-shape (contracting then expanding)");
  } else if (volEnd > volMid) score += 7;
  const neckline = leftHigh;
  const latestClose = candles[n - 1].close;
  const brokeOut = latestClose > neckline;
  if (brokeOut) {
    const bp = (latestClose - neckline) / neckline;
    if (bp > 0.02) { score += 25; confs.push("Breakout >2% above neckline"); }
    else { score += 15; confs.push("Breakout confirmed"); }
  } else if ((neckline - latestClose) / neckline < 0.02) score += 5;

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;
  const entryPrice = brokeOut ? latestClose : null;
  const stopPrice = bottom * (1 - STOP_CUSHION_PCT);
  const target = neckline + (neckline - bottom) * TARGET_MULT_REVERSAL;
  const targetPrice = target > 0 ? target : null;

  const lines: TrendLineDef[] = [
    { startTime: window[0].time, endTime: candles[n - 1].time, startPrice: neckline, endPrice: neckline, style: "dashed", color: "#22c55e", width: 1, label: "Neckline" },
  ];
  const markers: MarkerDef[] = [
    { time: candles[n - 1].time, label: `Saucer ${confidence}%`, color: "#22c55e", position: "belowBar" },
  ];
  const st = calcStatus(candles, n - 1, entryPrice, stopPrice, targetPrice, "bullish");

  return {
    type: "rounding_bottom",
    direction: "bullish",
    confidence,
    lines,
    markers,
    entry: st.entryPrice,
    stopLoss: stopPrice,
    target: targetPrice,
    riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
    status: st.status,
    triggerPrice: st.triggerPrice ?? (entryPrice === null ? neckline : null),
    orderType: "stop",
    invalidation: "Price closes back below the saucer low",
    confirmations: confs,
  };
}

function detectRoundingTop(
  candles: OHLCVInput[],
  _swingHighs: { time: string; price: number }[],
  _swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Smooth dome after an advance; distribution volume confirms (§7).
  const n = candles.length;
  if (n < 45) return null;
  const window = candles.slice(-60);
  const means = roundingShape(window.map((c) => c.close));
  if (!means) return null;
  const third = Math.floor(means.length / 3);
  const left = means.slice(0, third);
  const mid = means.slice(third, 2 * third);
  const right = means.slice(2 * third);
  const leftSlope = (left[left.length - 1] - left[0]) / Math.abs(left[0]);
  const rightSlope = (right[right.length - 1] - right[0]) / Math.abs(right[0]);
  const midSlope = (mid[mid.length - 1] - mid[0]) / Math.abs(mid[0]);
  if (leftSlope < 0.01 || rightSlope > -0.01 || Math.abs(midSlope) > 0.02) return null;
  const dome = Math.max(...means);
  const leftLow = Math.min(...window.slice(0, 20).map((c) => c.low));
  const height = (dome - leftLow) / Math.max(leftLow, 1e-9);
  if (height < 0.05) return null;

  let score = 35;
  const confs: string[] = [];
  if (height > 0.12) { score += 20; confs.push("Dome height >12%"); }
  else if (height > 0.08) score += 12;
  const overallDir = means[means.length - 1] - means[0];
  let turns = 0;
  for (let k = 1; k < means.length; k++) {
    if ((means[k] - means[k - 1]) * overallDir < 0) turns++;
  }
  if (turns <= 2) { score += 15; confs.push("Smooth arc (few direction changes)"); }
  else if (turns <= 4) score += 7;
  const volStart = avgVolume(candles, n - 60, n - 45);
  const volMid = avgVolume(candles, n - 30, n - 16);
  const volEnd = avgVolume(candles, n - 8, n - 1);
  if (volEnd > volMid * 1.2 && volMid < volStart) {
    score += 15;
    confs.push("Volume expanding on the downside (distribution)");
  } else if (volEnd > volMid) score += 7;
  const neckline = leftLow;
  const latestClose = candles[n - 1].close;
  const brokeDown = latestClose < neckline;
  if (brokeDown) {
    const bp = (neckline - latestClose) / neckline;
    if (bp > 0.02) { score += 25; confs.push("Breakdown >2% below neckline"); }
    else { score += 15; confs.push("Breakdown confirmed"); }
  } else if ((latestClose - neckline) / neckline < 0.02) score += 5;

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;
  const entryPrice = brokeDown ? latestClose : null;
  const stopPrice = dome * (1 + STOP_CUSHION_PCT);
  const target = neckline - (dome - neckline) * TARGET_MULT_REVERSAL;
  const targetPrice = target > 0 ? target : null;

  const lines: TrendLineDef[] = [
    { startTime: window[0].time, endTime: candles[n - 1].time, startPrice: neckline, endPrice: neckline, style: "dashed", color: "#ef4444", width: 1, label: "Neckline" },
  ];
  const markers: MarkerDef[] = [
    { time: candles[n - 1].time, label: `Dome ${confidence}%`, color: "#ef4444", position: "aboveBar" },
  ];
  const st = calcStatus(candles, n - 1, entryPrice, stopPrice, targetPrice, "bearish");

  return {
    type: "rounding_top",
    direction: "bearish",
    confidence,
    lines,
    markers,
    entry: st.entryPrice,
    stopLoss: stopPrice,
    target: targetPrice,
    riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
    status: st.status,
    triggerPrice: st.triggerPrice ?? (entryPrice === null ? neckline : null),
    orderType: "stop",
    invalidation: "Price closes back above the dome high",
    confirmations: confs,
  };
}

// ─── Island Reversal (gap-isolated reversal) ────────────────────────────────────

function detectIslandReversal(
  candles: OHLCVInput[],
  _swingHighs: { time: string; price: number }[],
  _swingLows: { time: string; price: number }[],
): DetectedPattern | null {
  // Gap away, isolated range, gap back — trapped traders unwind (§10).
  // Direction opposes the first gap.
  const n = candles.length;
  if (n < 30) return null;
  const gaps = findGaps(candles, 0.004);

  let best: { g1: number; g2: number; direction: "bullish" | "bearish" } | null = null;
  for (let a = 0; a < gaps.length; a++) {
    for (let b = a + 1; b < gaps.length; b++) {
      const g1 = gaps[a];
      const g2 = gaps[b];
      if (g2.direction === g1.direction) continue;
      const islandLen = g2.idx - g1.idx;
      if (islandLen < 2 || islandLen > 15) continue;
      if (g2.idx < n - 12) continue;
      best = {
        g1: g1.idx,
        g2: g2.idx,
        direction: g1.direction === "up" ? "bearish" : "bullish",
      };
    }
  }
  if (!best) return null;
  const { g1: gi1, g2: gi2, direction } = best;

  const island = candles.slice(gi1, gi2);
  const islHigh = Math.max(...island.map((c) => c.high));
  const islLow = Math.min(...island.map((c) => c.low));
  const islHeight = islHigh - islLow;

  let score = 40;
  const confs: string[] = [];
  const baseVol = gi1 >= 2 ? avgVolume(candles, gi1 - 20, gi1 - 1) : 0;
  const gapVol = (candles[gi1].volume + candles[gi2].volume) / 2;
  if (baseVol > 0 && gapVol > baseVol * 1.2) { score += 15; confs.push("High volume on both gaps"); }
  const firstGapSizePct = gaps.filter((g) => g.idx === gi1).map((g) => g.sizePct)[0] ?? 0;
  if (firstGapSizePct > 0.01) { score += 10; confs.push("Clean separation gap >1%"); }
  if (islHeight / Math.max(islHigh, 1e-9) < 0.05) { score += 10; confs.push("Compact island"); }
  const latestClose = candles[n - 1].close;
  const confirmed = direction === "bearish" ? latestClose < islLow : latestClose > islHigh;
  if (confirmed) {
    score += 20;
    confs.push(direction === "bearish"
      ? "Price left the island to the downside"
      : "Price left the island to the upside");
  }

  const confidence = Math.min(Math.round(score), 100);
  if (confidence < MIN_CONFIDENCE) return null;
  const entryPrice = latestClose;
  const stopPrice = direction === "bearish"
    ? islHigh * (1 + STOP_CUSHION_PCT)
    : islLow * (1 - STOP_CUSHION_PCT);
  const rawTarget = direction === "bearish"
    ? latestClose - islHeight * TARGET_MULT_REVERSAL
    : latestClose + islHeight * TARGET_MULT_REVERSAL;
  const targetPrice = rawTarget > 0 ? rawTarget : null;

  const markers: MarkerDef[] = [
    {
      time: candles[gi1].time,
      label: `Island ${confidence}%`,
      color: direction === "bearish" ? "#ef4444" : "#22c55e",
      position: direction === "bearish" ? "aboveBar" : "belowBar",
    },
  ];
  const st = calcStatus(candles, n - 1, entryPrice, stopPrice, targetPrice, direction);

  return {
    type: "island_reversal",
    direction,
    confidence,
    lines: [],
    markers,
    entry: st.entryPrice,
    stopLoss: stopPrice,
    target: targetPrice,
    riskReward: calcRR(st.entryPrice, stopPrice, targetPrice),
    status: st.status,
    triggerPrice: st.triggerPrice ?? null,
    orderType: "stop",
    invalidation: direction === "bearish"
      ? "Price closes back above the island high"
      : "Price closes back below the island low",
    confirmations: confs,
  };
}


// ─── Main export: run all detectors ──────────────────────────────────────────────

// R10 repair mirror: trend-alignment applies only to continuation patterns
// (reversals form AGAINST the prevailing trend by definition).
const CONTINUATION_PATTERNS = new Set<string>([
  "bull_flag",
  "bear_flag",
  "ascending_triangle",
  "descending_triangle",
  "cup_and_handle",
  "rising_wedge",
  "symmetrical_triangle",
]);

// Q1.4 mirror: cross-call emission memory (opt-in via dedup option), keyed on
// type|direction|rounded levels -> last emission time. Mirrors the backend's
// _EMISSION_MEMORY and simulate_trades' R4 cooldown semantics.
const EMISSION_MEMORY = new Map<string, string>();
const EMISSION_MEMORY_CAP = 4096;

function emissionSignature(p: DetectedPattern): string {
  const r = (x: number | null) => (x === null ? -1 : Math.round(x * 100));
  return `${p.type}|${p.direction}|${r(p.entry)}|${r(p.stopLoss)}|${r(p.target)}`;
}

// ─── Feature 3: ScreenConfig (adjustable "screen dials") ─────────────────────────
// Mirrors the backend `ScreenConfig` dataclass in engine/pattern_engine.py.
// Every field defaults to the current hardcoded constant so existing callers
// are unaffected. detectPatterns overrides the module-level `let` constants
// from this config for the duration of a call, then restores them.

export interface ScreenConfig {
  minConfidence?: number;
  minRr?: number;
  peakEqualityPct?: number;
  flagPoleMinPct?: number;
  triangleMinTouches?: number;
  cupMinBars?: number;
  stopCushionPct?: number;
  targetMultContinuation?: number;
  targetMultReversal?: number;
  reversalMinRr?: number;
  patternCooldownBars?: number;
  risingWedgeTargetMult?: number;
}

/** Slider bounds for the Settings UI (mirrors backend ScreenConfig.BOUNDS). */
export const SCREEN_CONFIG_BOUNDS: Record<keyof ScreenConfig, [number, number]> = {
  minConfidence: [50, 100],
  minRr: [0.5, 5.0],
  peakEqualityPct: [0.01, 0.15],
  flagPoleMinPct: [0.01, 0.15],
  triangleMinTouches: [2, 10],
  cupMinBars: [10, 60],
  stopCushionPct: [0.005, 0.05],
  targetMultContinuation: [1.0, 4.0],
  targetMultReversal: [0.5, 3.0],
  reversalMinRr: [0.3, 2.0],
  patternCooldownBars: [5, 60],
  risingWedgeTargetMult: [0.5, 3.0],
};

/** Human-readable labels for the Settings UI. */
export const SCREEN_CONFIG_LABELS: Record<keyof ScreenConfig, string> = {
  minConfidence: "Min Confidence (%)",
  minRr: "Min Risk:Reward",
  peakEqualityPct: "Peak Equality Tolerance",
  flagPoleMinPct: "Flag Pole Min Move",
  triangleMinTouches: "Triangle Min Touches",
  cupMinBars: "Cup Min Bars",
  stopCushionPct: "Stop Cushion",
  targetMultContinuation: "Continuation Target Mult",
  targetMultReversal: "Reversal Target Mult",
  reversalMinRr: "Reversal Min RR",
  patternCooldownBars: "Pattern Cooldown (bars)",
  risingWedgeTargetMult: "Rising Wedge Target Mult",
};

/** Default (factory) ScreenConfig — matches the hardcoded constants. */
export function defaultScreenConfig(): ScreenConfig {
  return {
    minConfidence: 85,
    minRr: 1.5,
    peakEqualityPct: 0.05,
    flagPoleMinPct: 0.05,
    triangleMinTouches: 4,
    cupMinBars: 20,
    stopCushionPct: 0.01,
    targetMultContinuation: 2.0,
    targetMultReversal: 1.0,
    reversalMinRr: 0.8,
    patternCooldownBars: 20,
    risingWedgeTargetMult: 1.0,
  };
}

/** Apply a ScreenConfig to the module-level constants; returns saved values. */
function applyScreenConfig(cfg?: ScreenConfig): Partial<ScreenConfig> {
  if (!cfg) return {};
  const saved: Partial<ScreenConfig> = {};
  const map: Record<keyof ScreenConfig, () => void> = {
    minConfidence: () => { saved.minConfidence = MIN_CONFIDENCE; MIN_CONFIDENCE = cfg.minConfidence ?? MIN_CONFIDENCE; },
    minRr: () => { saved.minRr = MIN_RR; MIN_RR = cfg.minRr ?? MIN_RR; },
    peakEqualityPct: () => { saved.peakEqualityPct = PEAK_EQUALITY_PCT; PEAK_EQUALITY_PCT = cfg.peakEqualityPct ?? PEAK_EQUALITY_PCT; },
    flagPoleMinPct: () => { saved.flagPoleMinPct = FLAG_POLE_MIN_PCT; FLAG_POLE_MIN_PCT = cfg.flagPoleMinPct ?? FLAG_POLE_MIN_PCT; },
    triangleMinTouches: () => { saved.triangleMinTouches = TRIANGLE_MIN_TOUCHES; TRIANGLE_MIN_TOUCHES = cfg.triangleMinTouches ?? TRIANGLE_MIN_TOUCHES; },
    cupMinBars: () => { saved.cupMinBars = CUP_MIN_BARS; CUP_MIN_BARS = cfg.cupMinBars ?? CUP_MIN_BARS; },
    stopCushionPct: () => { saved.stopCushionPct = STOP_CUSHION_PCT; STOP_CUSHION_PCT = cfg.stopCushionPct ?? STOP_CUSHION_PCT; },
    targetMultContinuation: () => { saved.targetMultContinuation = TARGET_MULT_CONTINUATION; TARGET_MULT_CONTINUATION = cfg.targetMultContinuation ?? TARGET_MULT_CONTINUATION; },
    targetMultReversal: () => { saved.targetMultReversal = TARGET_MULT_REVERSAL; TARGET_MULT_REVERSAL = cfg.targetMultReversal ?? TARGET_MULT_REVERSAL; },
    reversalMinRr: () => { saved.reversalMinRr = REVERSAL_MIN_RR; REVERSAL_MIN_RR = cfg.reversalMinRr ?? REVERSAL_MIN_RR; },
    patternCooldownBars: () => { saved.patternCooldownBars = PATTERN_COOLDOWN_BARS; PATTERN_COOLDOWN_BARS = cfg.patternCooldownBars ?? PATTERN_COOLDOWN_BARS; },
    risingWedgeTargetMult: () => { saved.risingWedgeTargetMult = RISING_WEDGE_TARGET_MULT; RISING_WEDGE_TARGET_MULT = cfg.risingWedgeTargetMult ?? RISING_WEDGE_TARGET_MULT; },
  };
  (Object.keys(map) as (keyof ScreenConfig)[]).forEach((k) => map[k]());
  return saved;
}

/** Restore module-level constants saved by applyScreenConfig. */
function restoreScreenConfig(saved: Partial<ScreenConfig>): void {
  if (saved.minConfidence !== undefined) MIN_CONFIDENCE = saved.minConfidence;
  if (saved.minRr !== undefined) MIN_RR = saved.minRr;
  if (saved.peakEqualityPct !== undefined) PEAK_EQUALITY_PCT = saved.peakEqualityPct;
  if (saved.flagPoleMinPct !== undefined) FLAG_POLE_MIN_PCT = saved.flagPoleMinPct;
  if (saved.triangleMinTouches !== undefined) TRIANGLE_MIN_TOUCHES = saved.triangleMinTouches;
  if (saved.cupMinBars !== undefined) CUP_MIN_BARS = saved.cupMinBars;
  if (saved.stopCushionPct !== undefined) STOP_CUSHION_PCT = saved.stopCushionPct;
  if (saved.targetMultContinuation !== undefined) TARGET_MULT_CONTINUATION = saved.targetMultContinuation;
  if (saved.targetMultReversal !== undefined) TARGET_MULT_REVERSAL = saved.targetMultReversal;
  if (saved.reversalMinRr !== undefined) REVERSAL_MIN_RR = saved.reversalMinRr;
  if (saved.patternCooldownBars !== undefined) PATTERN_COOLDOWN_BARS = saved.patternCooldownBars;
  if (saved.risingWedgeTargetMult !== undefined) RISING_WEDGE_TARGET_MULT = saved.risingWedgeTargetMult;
}

export function detectPatterns(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
  opts?: { regimeFilter?: boolean; dedup?: boolean; screenConfig?: ScreenConfig },
): DetectedPattern[] {
  if (candles.length < 20 || swingHighs.length < 2 || swingLows.length < 2) return [];
  const regimeFilter = opts?.regimeFilter ?? false;
  const dedup = opts?.dedup ?? false;

  // Feature 3: apply user-adjustable screen dials for the duration of this
  // call, then restore the defaults (mirrors the backend ScreenConfig override).
  const saved = applyScreenConfig(opts?.screenConfig);
  try {
    return detectPatternsInner(candles, swingHighs, swingLows, regimeFilter, dedup);
  } finally {
    restoreScreenConfig(saved);
  }
}

function detectPatternsInner(
  candles: OHLCVInput[],
  swingHighs: { time: string; price: number }[],
  swingLows: { time: string; price: number }[],
  regimeFilter: boolean,
  dedup: boolean,
): DetectedPattern[] {
  const results: DetectedPattern[] = [];

  const detectors = [
    detectHNS,
    detectIHNS,
    detectDoubleTop,
    detectDoubleBottom,
    detectBullFlag,
    detectBearFlag,
    detectAscTriangle,
    detectDescTriangle,
    detectFallingWedge,
    detectCupHandle,
    detectSymTriangle,
    detectRisingWedge,
    detectTripleTop,
    detectTripleBottom,
    detectRoundingTop,
    detectRoundingBottom,
    detectIslandReversal,
  ];

  for (const detect of detectors) {
    try {
      const pattern = detect(candles, swingHighs, swingLows);
      if (pattern) {
        // Phase R repair: ONE uniform confidence gate. The old code divided
        // MIN_CONFIDENCE by the reliability weight — bear_flag needed
        // round(85/0.65)=131/100, making it mathematically unreachable.
        // Weights now apply only to ranking (sort below).
        if (pattern.confidence < MIN_CONFIDENCE) continue;

        // Experimental patterns stay out of production output until the
        // reliability calibration has run over them; while enabled they sit
        // under a probation confidence cap (mirrors backend dispatcher).
        if (!ENABLE_EXPERIMENTAL_PATTERNS && EXPERIMENTAL_PATTERNS.has(pattern.type)) continue;
        if (EXPERIMENTAL_PATTERNS.has(pattern.type)) {
          pattern.confidence = Math.min(pattern.confidence, EXPERIMENTAL_CONFIDENCE_CAP);
        }

        // Q5 parity: measured-negative-expectancy patterns are excluded from
        // production output (mirrors backend LOW_EDGE_PATTERNS gate). This
        // keeps the chart/Patterns tab consistent with backend production.
        if (!ENABLE_LOW_EDGE_PATTERNS && LOW_EDGE_PATTERNS.has(pattern.type)) continue;

        // Per-family risk:reward floor (reversals use the relaxed classical
        // floor — their edge is win-rate, not large R multiples).
        if (pattern.riskReward !== null && pattern.riskReward < rrFloorFor(pattern.type)) continue;

        // Q1/R10 parity: continuation patterns must align with the SMA50
        // trend context (neutral passes) — mirrors simulate_trades semantics.
        if (regimeFilter && CONTINUATION_PATTERNS.has(pattern.type)) {
          const closeNow = candles[candles.length - 1].close;
          const win = candles.slice(-50).map((c) => c.close);
          const ma50 = win.reduce((a, b) => a + b, 0) / win.length;
          if (win.length >= 20 && ma50 > 0) {
            if (closeNow < ma50 && pattern.direction === "bullish") continue;
            if (closeNow > ma50 && pattern.direction === "bearish") continue;
          }
        }

        // Q1.4: emission dedup (opt-in) — suppress identical geometry
        // re-emitted within the cooldown window across calls.
        if (dedup) {
          const sig = emissionSignature(pattern);
          const lastTime = EMISSION_MEMORY.get(sig);
          let fresh = true;
          if (lastTime !== undefined) {
            const idxOf = new Map(candles.map((c, k) => [c.time, k] as const));
            const prevIdx = idxOf.get(lastTime);
            const curIdx = candles.length - 1;
            if (prevIdx !== undefined && curIdx - prevIdx >= 0 &&
                curIdx - prevIdx < PATTERN_COOLDOWN_BARS) fresh = false;
          }
          if (fresh) {
            EMISSION_MEMORY.set(sig, candles[candles.length - 1].time);
            if (EMISSION_MEMORY.size > EMISSION_MEMORY_CAP) EMISSION_MEMORY.clear();
          } else {
            continue;
          }
        }

        results.push(pattern);
      }
    } catch (e) {
      // Silently skip errors in individual detectors
      console.warn("Pattern detector error:", e);
    }
  }

  // Sort by confidence descending, return top 3 max (quality over quantity)
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}
