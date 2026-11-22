/**
 * Candlestick Pattern Detection Engine
 * Detects 18 single/double/triple candlestick formations from OHLCV data.
 * Each detector returns a DetectedCandle or null.
 */

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DetectedCandlePattern {
  type: string;
  name: string;
  category: "single" | "double" | "triple";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;        // 0-100
  barIndex: number;          // index in the candle array
  time: string;
  description: string;
  reliability: number;       // 0-1 (from institutional research)
}

// ── Helpers ──

function body(c: Candle): number { return Math.abs(c.close - c.open); }
function upperWick(c: Candle): number { return c.high - Math.max(c.open, c.close); }
function lowerWick(c: Candle): number { return Math.min(c.open, c.close) - c.low; }
function range(c: Candle): number { return c.high - c.low; }
function isBullish(c: Candle): boolean { return c.close > c.open; }
function isBearish(c: Candle): boolean { return c.close < c.open; }
function midPoint(c: Candle): number { return (c.open + c.close) / 2; }
function bodyMidPoint(c: Candle): number { return (c.open + c.close) / 2; }

function avgRange(candles: Candle[], len: number, end: number): number {
  const start = Math.max(0, end - len);
  let sum = 0;
  for (let i = start; i < end; i++) sum += range(candles[i]);
  return sum / (end - start || 1);
}

function avgVolume(candles: Candle[], len: number, end: number): number {
  const start = Math.max(0, end - len);
  let sum = 0;
  for (let i = start; i < end; i++) sum += candles[i].volume;
  return sum / (end - start || 1);
}

function make(
  type: string, name: string, cat: "single" | "double" | "triple",
  dir: "bullish" | "bearish" | "neutral", conf: number, idx: number,
  time: string, desc: string, rel: number,
): DetectedCandlePattern {
  return { type, name, category: cat, direction: dir, confidence: Math.min(99, Math.max(10, conf)), barIndex: idx, time, description: desc, reliability: rel };
}

// ══════════════════════════════════════════════════════════════
//  SINGLE CANDLE PATTERNS
// ══════════════════════════════════════════════════════════════

function detectDoji(c: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  const b = body(c);
  const r = range(c);
  if (r === 0 || b / r > 0.1) return null;
  const conf = 50 + (r > avgR * 0.8 ? 15 : 0) + (c.volume > 0 ? 10 : 0);
  return make("doji", "Doji", "single", "neutral", conf, i, c.time,
    "Indecision candle — open and close nearly equal", 0.45);
}

function detectHammer(c: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  const b = body(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const r = range(c);
  if (r === 0 || b === 0) return null;
  if (lw < b * 2 || uw > b * 0.5) return null;
  if (r < avgR * 0.5) return null;
  const conf = 60 + (lw > b * 3 ? 15 : 0) + (r > avgR ? 10 : 0);
  return make("hammer", "Hammer", "single", "bullish", conf, i, c.time,
    "Long lower wick suggests buyers rejected lower prices", 0.60);
}

function detectHangingMan(c: Candle, i: number, avgR: number, prev: Candle[]): DetectedCandlePattern | null {
  const b = body(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const r = range(c);
  if (r === 0 || b === 0) return null;
  if (lw < b * 2 || uw > b * 0.5) return null;
  // Must be in uptrend
  if (i < 5) return null;
  const trendUp = prev.slice(i - 5, i).every(p => p.close > p.open) || prev[i - 1].close > prev[i - 5].close;
  if (!trendUp) return null;
  const conf = 55 + (lw > b * 2.5 ? 10 : 0);
  return make("hanging_man", "Hanging Man", "single", "bearish", conf, i, c.time,
    "Appears at top of uptrend — potential reversal warning", 0.55);
}

function detectInvertedHammer(c: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  const b = body(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const r = range(c);
  if (r === 0 || b === 0) return null;
  if (uw < b * 2 || lw > b * 0.5) return null;
  if (r < avgR * 0.5) return null;
  const conf = 50 + (uw > b * 3 ? 15 : 0);
  return make("inverted_hammer", "Inverted Hammer", "single", "bullish", conf, i, c.time,
    "Long upper wick at bottom of downtrend — buyers testing resistance", 0.50);
}

function detectShootingStar(c: Candle, i: number, avgR: number, prev: Candle[]): DetectedCandlePattern | null {
  const b = body(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const r = range(c);
  if (r === 0 || b === 0) return null;
  if (uw < b * 2 || lw > b * 0.5) return null;
  if (i < 5) return null;
  const trendUp = prev.slice(i - 5, i).some(p => prev[i - 1].close > prev[i - 5].close);
  if (!trendUp) return null;
  const conf = 55 + (uw > b * 3 ? 15 : 0);
  return make("shooting_star", "Shooting Star", "single", "bearish", conf, i, c.time,
    "Long upper wick at top of uptrend — sellers rejecting higher prices", 0.55);
}

function detectMarubozu(c: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  const b = body(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  const r = range(c);
  if (r === 0 || b / r < 0.85) return null;
  if (uw > r * 0.05 || lw > r * 0.05) return null;
  if (r < avgR * 0.7) return null;
  const dir = isBullish(c) ? "bullish" : "bearish";
  const conf = 65 + (b / r > 0.95 ? 15 : 0) + (r > avgR * 1.2 ? 10 : 0);
  return make("marubozu", "Marubozu", "single", dir, conf, i, c.time,
    `${dir === "bullish" ? "Strong buying" : "Strong selling"} pressure — minimal wicks`, 0.65);
}

function detectSpinningTop(c: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  const b = body(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  const r = range(c);
  if (r === 0) return null;
  const bodyRatio = b / r;
  if (bodyRatio > 0.35 || bodyRatio < 0.05) return null;
  if (uw < b || lw < b) return null;
  const conf = 40 + (r > avgR * 0.8 ? 10 : 0);
  return make("spinning_top", "Spinning Top", "single", "neutral", conf, i, c.time,
    "Small body with wicks on both sides — market indecision", 0.40);
}

// ══════════════════════════════════════════════════════════════
//  DOUBLE CANDLE PATTERNS
// ══════════════════════════════════════════════════════════════

function detectBullishEngulfing(c0: Candle, c1: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  if (!isBearish(c0) || !isBullish(c1)) return null;
  if (c1.open > c0.close || c1.close < c0.open) return null;
  if (body(c1) <= body(c0)) return null;
  const conf = 65 + (body(c1) > body(c0) * 1.5 ? 15 : 0) + (range(c1) > avgR ? 10 : 0);
  return make("bullish_engulfing", "Bullish Engulfing", "double", "bullish", conf, i, c1.time,
    "Bullish candle completely engulfs prior bearish candle — reversal signal", 0.63);
}

function detectBearishEngulfing(c0: Candle, c1: Candle, i: number, avgR: number): DetectedCandlePattern | null {
  if (!isBullish(c0) || !isBearish(c1)) return null;
  if (c1.open < c0.close || c1.close > c0.open) return null;
  if (body(c1) <= body(c0)) return null;
  const conf = 65 + (body(c1) > body(c0) * 1.5 ? 15 : 0) + (range(c1) > avgR ? 10 : 0);
  return make("bearish_engulfing", "Bearish Engulfing", "double", "bearish", conf, i, c1.time,
    "Bearish candle completely engulfs prior bullish candle — reversal signal", 0.63);
}

function detectPiercingLine(c0: Candle, c1: Candle, i: number): DetectedCandlePattern | null {
  if (!isBearish(c0) || !isBullish(c1)) return null;
  const gap = c0.open - c1.open;
  if (gap <= 0) return null;
  const mid = midPoint(c0);
  if (c1.close < mid || c1.close >= c0.open) return null;
  const conf = 55 + (c1.close > mid + body(c0) * 0.1 ? 10 : 0);
  return make("piercing_line", "Piercing Line", "double", "bullish", conf, i, c1.time,
    "Bullish candle opens below prior low but closes above midpoint — bullish reversal", 0.58);
}

function detectDarkCloudCover(c0: Candle, c1: Candle, i: number): DetectedCandlePattern | null {
  if (!isBullish(c0) || !isBearish(c1)) return null;
  const gap = c1.open - c0.close;
  if (gap <= 0) return null;
  const mid = midPoint(c0);
  if (c1.close > mid || c1.close <= c0.open) return null;
  const conf = 55 + (c1.close < mid - body(c0) * 0.1 ? 10 : 0);
  return make("dark_cloud_cover", "Dark Cloud Cover", "double", "bearish", conf, i, c1.time,
    "Bearish candle opens above prior high but closes below midpoint — bearish reversal", 0.58);
}

function detectTweezerTop(c0: Candle, c1: Candle, i: number): DetectedCandlePattern | null {
  const diff = Math.abs(c0.high - c1.high);
  if (diff > range(c0) * 0.02) return null;
  if (range(c0) < range(c1) * 0.3) return null;
  if (!isBullish(c0) || !isBearish(c1)) return null;
  const conf = 50 + (diff < range(c0) * 0.005 ? 10 : 0);
  return make("tweezer_top", "Tweezer Top", "double", "bearish", conf, i, c1.time,
    "Two candles with matching highs at resistance — rejection", 0.48);
}

function detectTweezerBottom(c0: Candle, c1: Candle, i: number): DetectedCandlePattern | null {
  const diff = Math.abs(c0.low - c1.low);
  if (diff > range(c0) * 0.02) return null;
  if (range(c0) < range(c1) * 0.3) return null;
  if (!isBearish(c0) || !isBullish(c1)) return null;
  const conf = 50 + (diff < range(c0) * 0.005 ? 10 : 0);
  return make("tweezer_bottom", "Tweezer Bottom", "double", "bullish", conf, i, c1.time,
    "Two candles with matching lows at support — bounce expected", 0.48);
}

// ══════════════════════════════════════════════════════════════
//  TRIPLE CANDLE PATTERNS
// ══════════════════════════════════════════════════════════════

function detectMorningStar(c0: Candle, c1: Candle, c2: Candle, i: number): DetectedCandlePattern | null {
  if (!isBearish(c0)) return null;
  if (body(c1) > body(c0) * 0.4) return null;
  if (!isBullish(c2)) return null;
  if (c2.close < midPoint(c0)) return null;
  const gap1 = Math.abs(c0.close - c1.open);
  const conf = 70 + (c2.close > midPoint(c0) + body(c0) * 0.2 ? 10 : 0);
  return make("morning_star", "Morning Star", "triple", "bullish", conf, i, c2.time,
    "Three-candle bullish reversal: long bearish → small body → strong bullish close", 0.72);
}

function detectEveningStar(c0: Candle, c1: Candle, c2: Candle, i: number): DetectedCandlePattern | null {
  if (!isBullish(c0)) return null;
  if (body(c1) > body(c0) * 0.4) return null;
  if (!isBearish(c2)) return null;
  if (c2.close > midPoint(c0)) return null;
  const conf = 70 + (c2.close < midPoint(c0) - body(c0) * 0.2 ? 10 : 0);
  return make("evening_star", "Evening Star", "triple", "bearish", conf, i, c2.time,
    "Three-candle bearish reversal: long bullish → small body → strong bearish close", 0.72);
}

function detectThreeWhiteSoldiers(c0: Candle, c1: Candle, c2: Candle, i: number): DetectedCandlePattern | null {
  if (!isBullish(c0) || !isBullish(c1) || !isBullish(c2)) return null;
  if (c1.open < c0.open || c2.open < c1.open) return null;
  if (c1.close <= c0.close || c2.close <= c1.close) return null;
  const avgB = (body(c0) + body(c1) + body(c2)) / 3;
  if (avgB < range(c0) * 0.3) return null;
  const conf = 68 + (c2.close > c1.close && c1.close > c0.close ? 12 : 0);
  return make("three_white_soldiers", "Three White Soldiers", "triple", "bullish", conf, i, c2.time,
    "Three consecutive strong bullish candles — powerful uptrend confirmation", 0.70);
}

function detectThreeBlackCrows(c0: Candle, c1: Candle, c2: Candle, i: number): DetectedCandlePattern | null {
  if (!isBearish(c0) || !isBearish(c1) || !isBearish(c2)) return null;
  if (c1.open > c0.open || c2.open > c1.open) return null;
  if (c1.close >= c0.close || c2.close >= c1.close) return null;
  const avgB = (body(c0) + body(c1) + body(c2)) / 3;
  if (avgB < range(c0) * 0.3) return null;
  const conf = 68 + (c2.close < c1.close && c1.close < c0.close ? 12 : 0);
  return make("three_black_crows", "Three Black Crows", "triple", "bearish", conf, i, c2.time,
    "Three consecutive strong bearish candles — powerful downtrend confirmation", 0.70);
}

// ══════════════════════════════════════════════════════════════
//  MAIN DETECTION FUNCTION
// ══════════════════════════════════════════════════════════════

export function detectCandlestickPatterns(candles: Candle[]): DetectedCandlePattern[] {
  if (candles.length < 10) return [];
  const results: DetectedCandlePattern[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const avgR = avgRange(candles, 14, i);
    const prev = candles;

    // Single candle
    const doji = detectDoji(c, i, avgR);
    if (doji) results.push(doji);

    const hammer = detectHammer(c, i, avgR);
    if (hammer) results.push(hammer);

    const invHammer = detectInvertedHammer(c, i, avgR);
    if (invHammer) results.push(invHammer);

    const marubozu = detectMarubozu(c, i, avgR);
    if (marubozu) results.push(marubozu);

    const spinningTop = detectSpinningTop(c, i, avgR);
    if (spinningTop) results.push(spinningTop);

    // Reversal singles (need trend context)
    if (i >= 5) {
      const hangingMan = detectHangingMan(c, i, avgR, prev);
      if (hangingMan) results.push(hangingMan);

      const shootingStar = detectShootingStar(c, i, avgR, prev);
      if (shootingStar) results.push(shootingStar);
    }

    // Double candle (need prev)
    if (i >= 1) {
      const c0 = candles[i - 1];

      const bullEng = detectBullishEngulfing(c0, c, i, avgR);
      if (bullEng) results.push(bullEng);

      const bearEng = detectBearishEngulfing(c0, c, i, avgR);
      if (bearEng) results.push(bearEng);

      const piercing = detectPiercingLine(c0, c, i);
      if (piercing) results.push(piercing);

      const darkCloud = detectDarkCloudCover(c0, c, i);
      if (darkCloud) results.push(darkCloud);

      const twTop = detectTweezerTop(c0, c, i);
      if (twTop) results.push(twTop);

      const twBot = detectTweezerBottom(c0, c, i);
      if (twBot) results.push(twBot);
    }

    // Triple candle (need 2 prev)
    if (i >= 2) {
      const c0 = candles[i - 2];
      const c1 = candles[i - 1];

      const morning = detectMorningStar(c0, c1, c, i);
      if (morning) results.push(morning);

      const evening = detectEveningStar(c0, c1, c, i);
      if (evening) results.push(evening);

      const tws = detectThreeWhiteSoldiers(c0, c1, c, i);
      if (tws) results.push(tws);

      const tbc = detectThreeBlackCrows(c0, c1, c, i);
      if (tbc) results.push(tbc);
    }
  }

  return results;
}

/** Get pattern color for chart annotation */
export function candlestickPatternColor(p: DetectedCandlePattern): string {
  if (p.direction === "bullish") return "#22c55e";
  if (p.direction === "bearish") return "#ef4444";
  return "#9ca3af";
}

/** Get pattern emoji for UI */
export function candlestickPatternEmoji(p: DetectedCandlePattern): string {
  const map: Record<string, string> = {
    doji: "✝️", hammer: "🔨", hanging_man: "⚠️", inverted_hammer: "⤴️",
    shooting_star: "💫", marubozu: "💪", spinning_top: "🔄",
    bullish_engulfing: "🟢", bearish_engulfing: "🔴",
    piercing_line: "⬆️", dark_cloud_cover: "⬇️",
    tweezer_top: "📌", tweezer_bottom: "📌",
    morning_star: "🌅", evening_star: "🌇",
    three_white_soldiers: "🏃‍♂️🏃‍♂️🏃‍♂️", three_black_crows: "🐦‍⬛🐦‍⬛🐦‍⬛",
  };
  return map[p.type] || "📊";
}

/** Summary stats for a set of detected patterns */
export function candlestickSummary(patterns: DetectedCandlePattern[]): {
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
  byType: Record<string, number>;
  recentConfidence: number;
} {
  const bullish = patterns.filter(p => p.direction === "bullish").length;
  const bearish = patterns.filter(p => p.direction === "bearish").length;
  const neutral = patterns.filter(p => p.direction === "neutral").length;
  const byType: Record<string, number> = {};
  for (const p of patterns) byType[p.type] = (byType[p.type] || 0) + 1;
  const recent = patterns.slice(-20);
  const recentConfidence = recent.length > 0
    ? Math.round(recent.reduce((s, p) => s + p.confidence, 0) / recent.length)
    : 0;
  return { total: patterns.length, bullish, bearish, neutral, byType, recentConfidence };
}
