/**
 * Pattern Backtester v4 — US Markets
 *
 * Ported from backtest_nse.ts v4 final:
 *   - Breakeven lock (1R → entry, locks there)
 *   - ATR-based stops (max of pattern stop, 2×ATR or 3%)
 *   - Close-based trigger confirmation (2 consecutive closes)
 *   - ATR volatility filter: skip when ATR(14)/ATR(50) > 1.5×
 *   - MIN_CONFIDENCE = 85, reliability weights active
 *   - Scratch classification for 0R exits
 *
 * Run: npx tsx backtest_patterns.ts
 */
import { detectPatterns } from "./lib/patterns";

const MIN_RR = 1.5;
const MIN_BARS_HELD = 5;

function calcRR(entry: number | null, sl: number | null, tgt: number | null): number | null {
  if (entry === null || sl === null || tgt === null || entry === sl) return null;
  return Math.abs((tgt - entry) / (entry - sl));
}

function findSwingPoints(candles: { high: number; low: number; time: string }[], endIdx: number) {
  const highs: { time: string; price: number }[] = [];
  const lows: { time: string; price: number }[] = [];
  for (let i = 2; i <= endIdx - 2; i++) {
    if (candles[i].high > candles[i-1].high && candles[i].high > candles[i-2].high
      && candles[i].high >= candles[i+1].high && candles[i].high >= candles[i+2].high)
      highs.push({ time: candles[i].time, price: candles[i].high });
    if (candles[i].low < candles[i-1].low && candles[i].low < candles[i-2].low
      && candles[i].low <= candles[i+1].low && candles[i].low <= candles[i+2].low)
      lows.push({ time: candles[i].time, price: candles[i].low });
  }
  return { highs, lows };
}

function sma(candles: { close: number }[], idx: number, period: number): number {
  const start = idx - period + 1;
  if (start < 0) return -1;
  let sum = 0;
  for (let i = start; i <= idx; i++) sum += candles[i].close;
  return sum / period;
}

/** ATR for a lookback period */
function atr(candles: { high: number; low: number; close: number }[], idx: number, period = 14): number {
  const start = Math.max(1, idx - period + 1);
  let sum = 0;
  for (let i = start; i <= idx; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low - candles[i-1].close),
    );
    sum += tr;
  }
  return sum / (idx - start + 1);
}

interface TradeRecord {
  symbol: string; patternType: string; direction: "bullish" | "bearish";
  confidence: number; entryDate: string; entryPrice: number;
  stopLoss: number; target: number; exitDate: string; exitPrice: number;
  rMultiple: number; barsHeld: number; result: "win" | "loss" | "scratch";
  trendAtEntry: "uptrend" | "downtrend" | "neutral";
}

async function runBacktest(symbol: string, period = "1y") {
  const res = await fetch(`http://localhost:8765/api/v1/ohlcv/${symbol}?period=${period}`);
  const json = await res.json();
  const rawCandles: { time: string; open: number; high: number; low: number; close: number; volume: number }[] =
    json.candles.map((c: any) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));

  const trades: TradeRecord[] = [];
  const WARMUP = 60;

  for (let i = WARMUP; i < rawCandles.length; i++) {
    const windowCandles = rawCandles.slice(0, i + 1);
    const { highs, lows } = findSwingPoints(windowCandles, i);
    if (highs.length < 3 || lows.length < 3) continue;

    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    const patterns = detectPatterns(windowCandles, recentHighs, recentLows);

    for (const ptn of patterns) {
      if (ptn.status !== "forming") continue;
      if (!ptn.triggerPrice || !ptn.stopLoss || !ptn.target) continue;

      // ── VOLATILITY FILTER (ATR expansion) ────────────────────────────
      const shortATR = atr(windowCandles, i, 14);
      const longATR = atr(windowCandles, i, 50);
      const atrRatio = longATR > 0 ? shortATR / longATR : 0;
      if (atrRatio > 1.5) continue; // Skip when volatility is expanding

      // Potential R:R using trigger as entry
      const potentialRR = calcRR(ptn.triggerPrice, ptn.stopLoss, ptn.target);
      if (potentialRR === null || potentialRR < MIN_RR) continue;

      // Require 2 consecutive closes beyond the trigger (avoids spike fakeouts)
      let entryIdx = -1;
      for (let j = i + 2; j < rawCandles.length; j++) {
        const c1 = rawCandles[j - 1], c2 = rawCandles[j];
        const bullish = ptn.direction === "bullish";
        if (bullish && c1.close >= ptn.triggerPrice && c2.close >= ptn.triggerPrice) { entryIdx = j; break; }
        if (!bullish && c1.close <= ptn.triggerPrice && c2.close <= ptn.triggerPrice) { entryIdx = j; break; }
      }
      if (entryIdx < 0) continue;

      // ── TREND CONTEXT FILTER (MA50) ────────────────────────────────────────
      const ma50 = sma(windowCandles, i, 50);
      if (ma50 < 0) continue;
      const currentClose = windowCandles[i].close;
      const inUptrend = currentClose > ma50 * 1.02;
      const inDowntrend = currentClose < ma50 * 0.98;
      const trend = inUptrend ? "uptrend" : inDowntrend ? "downtrend" : "neutral";

      if (ptn.direction === "bearish" && inUptrend) continue;
      if (ptn.direction === "bullish" && inDowntrend) continue;

      // Entry at the second confirmation close
      const entryPrice = rawCandles[entryIdx].close;
      const entryDate = rawCandles[entryIdx].time;

      // Use ATR-based stop: max(original stop distance, 2×ATR) from entry
      const currATR = atr(rawCandles, entryIdx, 14);
      const minStopDist = Math.max(currATR * 2, entryPrice * 0.03); // at least 2×ATR or 3%
      let sl: number;
      if (ptn.direction === "bullish") {
        sl = Math.min(ptn.stopLoss, entryPrice - minStopDist);
      } else {
        sl = Math.max(ptn.stopLoss, entryPrice + minStopDist);
      }
      // Recalculate target maintaining same RR ratio from original detection
      const origTargetDist = ptn.direction === "bullish"
        ? ptn.target - ptn.triggerPrice : ptn.triggerPrice - ptn.target;
      const origRiskDist = ptn.direction === "bullish"
        ? ptn.triggerPrice - ptn.stopLoss : ptn.stopLoss - ptn.triggerPrice;
      const origRR = origRiskDist > 0 ? origTargetDist / origRiskDist : 0;
      const actualRiskDist = ptn.direction === "bullish" ? entryPrice - sl : sl - entryPrice;
      const target = ptn.direction === "bullish"
        ? entryPrice + actualRiskDist * origRR
        : entryPrice - actualRiskDist * origRR;

      // ── Breakeven Lock ─────────────────────────────────────────────────────
      // When price moves 1R in our favour, stop ratchets to entry and locks.
      const beActivate = minStopDist;
      let bestPrice = entryPrice;
      let trailingStop = sl;
      let beLocked = false;

      let exitIdx = -1, exitPrice = 0;
      for (let j = entryIdx + 1; j < rawCandles.length; j++) {
        const c = rawCandles[j];

        if (ptn.direction === "bullish") {
          if (c.high > bestPrice) bestPrice = c.high;
          if (!beLocked && (bestPrice - entryPrice) >= beActivate) {
            trailingStop = entryPrice;
            beLocked = true;
          }
          if (c.high >= target) { exitIdx = j; exitPrice = target; break; }
          if (c.low <= trailingStop) { exitIdx = j; exitPrice = trailingStop; break; }
        } else {
          if (c.low < bestPrice) bestPrice = c.low;
          if (!beLocked && (entryPrice - bestPrice) >= beActivate) {
            trailingStop = entryPrice;
            beLocked = true;
          }
          if (c.low <= target) { exitIdx = j; exitPrice = target; break; }
          if (c.high >= trailingStop) { exitIdx = j; exitPrice = trailingStop; break; }
        }
      }
      if (exitIdx < 0) continue;

      // ── MIN BARS HELD FILTER ──────────────────────────────────────────────
      const barsHeld = exitIdx - entryIdx;
      if (barsHeld < MIN_BARS_HELD) continue;

      // Classify: exit at or better than entry = breakeven or better
      const exitBetter = ptn.direction === "bullish"
        ? exitPrice > entryPrice
        : exitPrice < entryPrice;
      const exitSame = exitPrice === entryPrice;
      const result: "win" | "loss" | "scratch" = exitBetter ? "win" : exitSame ? "scratch" : "loss";
      const actualRR = exitBetter
        ? Math.abs(exitPrice - entryPrice) / Math.abs(sl - entryPrice)
        : exitSame
          ? 0
          : -Math.abs(exitPrice - entryPrice) / Math.abs(sl - entryPrice);

      trades.push({
        symbol, patternType: ptn.type, direction: ptn.direction,
        confidence: ptn.confidence, entryDate,
        entryPrice: Math.round(entryPrice * 100) / 100,
        stopLoss: Math.round(sl * 100) / 100,
        target: Math.round(target * 100) / 100,
        exitDate: rawCandles[exitIdx].time,
        exitPrice: Math.round(exitPrice * 100) / 100,
        rMultiple: Math.round(actualRR * 100) / 100,
        barsHeld,
        result,
        trendAtEntry: trend,
      });

      i = Math.max(i, exitIdx);
      break;
    }
  }

  const wins = trades.filter(t => t.result === "win");
  const losses = trades.filter(t => t.result === "loss");
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, t) => s + t.rMultiple, 0) / losses.length : 0;
  const avgRR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const totalReturn = trades.reduce((s, t) => s + t.rMultiple, 0);
  const maxLossStreak = (() => {
    let streak = 0, maxS = 0;
    for (const t of trades) { if (t.result === "loss") { streak++; maxS = Math.max(maxS, streak); } else streak = 0; }
    return maxS;
  })();

  // Sharpe
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const variance = trades.length > 1 ? trades.reduce((s, t) => s + (t.rMultiple - avgR) ** 2, 0) / (trades.length - 1) : 0;
  const sharpe = Math.sqrt(variance) > 0 ? (avgR / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  return {
    symbol, totalCandles: rawCandles.length, totalTrades: trades.length,
    wins: wins.length, losses: losses.length,
    winRate: Math.round(winRate * 100) / 100,
    avgWinR: Math.round(avgWinR * 100) / 100,
    avgLossR: Math.round(avgLossR * 100) / 100,
    avgRR: Math.round(avgRR * 100) / 100,
    totalReturn: Math.round(totalReturn * 100) / 100,
    maxConsecutiveLosses: maxLossStreak,
    sharpe: Math.round(sharpe * 100) / 100,
    trades,
  };
}

async function main() {
  const symbols = ["AAPL", "TSLA", "AMZN", "MSFT", "GOOGL", "NVDA", "META", "JPM", "V", "INFY"];
  console.log("=".repeat(110));
  console.log("PATTERN BACKTEST v4 — Breakeven lock, MA50 trend, MIN_BARS_HELD=5, ATR vol filter");
  console.log("=".repeat(110));

  const allResults: Awaited<ReturnType<typeof runBacktest>>[] = [];

  for (const sym of symbols) {
    process.stdout.write(`\n── ${sym} ──\n`);
    try {
      const r = await runBacktest(sym);
      allResults.push(r);
      if (r.trades.length === 0) { process.stdout.write("  No trades.\n"); continue; }

      const scratches = r.trades.filter(t => t.result === "scratch");
      process.stdout.write(`  Trades: ${r.wins}W/${r.losses}L/${scratches.length}S  Win: ${r.winRate}%  AvgR: ${r.avgRR}  WinR: ${r.avgWinR}  LossR: ${r.avgLossR}  Ret: ${r.totalReturn}R  Sharpe: ${r.sharpe}\n`);
      for (const t of r.trades) {
        const icon = t.result === "win" ? "✅" : t.result === "scratch" ? "➖" : "❌";
        process.stdout.write(`    ${icon} ${t.patternType} ${t.confidence}% | ${t.entryDate}→${t.exitDate} (${t.barsHeld}b) | ${t.entryPrice}→${t.exitPrice} | R:${t.rMultiple} | ${t.trendAtEntry}\n`);
      }
    } catch (e) {
      process.stdout.write(`  ERROR: ${e}\n`);
    }
  }

  const all = allResults.flatMap(r => r.trades);
  const aw = all.filter(t => t.result === "win");
  const al = all.filter(t => t.result === "loss");
  const as_ = all.filter(t => t.result === "scratch");
  const decisive = aw.length + al.length;
  const wr = decisive > 0 ? (aw.length / decisive) * 100 : 0;
  const avgWR = aw.length > 0 ? aw.reduce((s, t) => s + t.rMultiple, 0) / aw.length : 0;
  const avgLR = al.length > 0 ? al.reduce((s, t) => s + t.rMultiple, 0) / al.length : 0;
  const tr = all.reduce((s, t) => s + t.rMultiple, 0);
  const profitable = allResults.filter(r => r.trades.reduce((s, t) => s + t.rMultiple, 0) > 0).length;

  console.log("\n" + "=".repeat(110));
  console.log("AGGREGATE RESULTS (US Markets)");
  console.log("=".repeat(110));
  console.log(`  Total trades: ${all.length}`);
  console.log(`  Wins: ${aw.length}  Scratches: ${as_.length}  Losses: ${al.length}`);
  console.log(`  Win rate (decisive only): ${wr.toFixed(1)}%`);
  console.log(`  Avg Win R: ${avgWR.toFixed(2)}  Avg Loss R: ${avgLR.toFixed(2)}`);
  console.log(`  Total return: ${tr.toFixed(2)}R`);
  console.log(`  Profitable symbols: ${profitable}/${symbols.length}`);
  console.log(`  Breakeven win rate needed (at ${avgWR.toFixed(2)}R / ${avgLR.toFixed(2)}R): ${(Math.abs(avgLR) / (avgWR + Math.abs(avgLR)) * 100).toFixed(1)}%`);
}

main().catch(console.error);
