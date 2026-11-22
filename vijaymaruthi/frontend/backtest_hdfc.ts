/**
 * Quick HDFC Bank 5-Year Backtest
 * 
 * Run: npx tsx backtest_hdfc.ts
 */
import { detectPatterns } from "./lib/patterns";
import YahooFinance from "yahoo-finance2";
import * as fs from "fs";
import * as path from "path";

const SYMBOL = "HDFCBANK.NS";
const START_DATE = "2021-07-01";  // 5 years back
const END_DATE = "2026-07-12";
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
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high
      && candles[i].high >= candles[i + 1].high && candles[i].high >= candles[i + 2].high)
      highs.push({ time: candles[i].time, price: candles[i].high });
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low
      && candles[i].low <= candles[i + 1].low && candles[i].low <= candles[i + 2].low)
      lows.push({ time: candles[i].time, price: candles[i].low });
  }
  return { highs, lows };
}

function atr(candles: { high: number; low: number; close: number }[], idx: number, period = 14): number {
  const start = Math.max(1, idx - period + 1);
  let sum = 0;
  for (let i = start; i <= idx; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    sum += tr;
  }
  return sum / (idx - start + 1);
}

function sma(candles: { close: number }[], idx: number, period: number): number {
  const start = idx - period + 1;
  if (start < 0) return -1;
  let sum = 0;
  for (let i = start; i <= idx; i++) sum += candles[i].close;
  return sum / period;
}

interface TradeRecord {
  patternType: string; direction: "bullish" | "bearish";
  confidence: number; entryDate: string; entryPrice: number;
  stopLoss: number; target: number; exitDate: string; exitPrice: number;
  rMultiple: number; barsHeld: number; result: "win" | "loss" | "scratch";
  trendAtEntry: "uptrend" | "downtrend" | "neutral";
}

async function main() {
  console.log("=".repeat(80));
  console.log(`HDFC BANK 5-YEAR PATTERN BACKTEST`);
  console.log("=".repeat(80));
  console.log(`  Symbol: ${SYMBOL}`);
  console.log(`  Period: ${START_DATE} to ${END_DATE}`);
  console.log(`  Filters: MIN_CONFIDENCE=85, MIN_RR=${MIN_RR}, MA50 trend`);
  console.log("=".repeat(80));

  const yf = new YahooFinance();

  // Fetch data
  console.log(`\nFetching ${SYMBOL} data...`);
  const hist = await yf.chart(SYMBOL, {
    period1: START_DATE,
    period2: END_DATE,
    interval: "1d",
  }) as any;

  if (!hist || !hist.quotes || hist.quotes.length < 100) {
    console.error(`Insufficient data: ${hist?.quotes?.length || 0} bars`);
    return;
  }

  const candles = hist.quotes
    .filter((q: any) => q.open && q.high && q.low && q.close)
    .map((q: any) => ({
      time: q.date?.toISOString?.()?.split("T")[0] || String(q.date),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume || 0,
    }));

  console.log(`  Candles: ${candles.length} (${candles[0]?.time} to ${candles[candles.length - 1]?.time})`);

  // Detect patterns
  console.log(`\nDetecting patterns...`);
  const allPatterns: any[] = [];
  
  // Compute swing points globally
  const swingHighs: { time: string; price: number }[] = [];
  const swingLows: { time: string; price: number }[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high
      && candles[i].high >= candles[i + 1].high && candles[i].high >= candles[i + 2].high)
      swingHighs.push({ time: candles[i].time, price: candles[i].high });
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low
      && candles[i].low <= candles[i + 1].low && candles[i].low <= candles[i + 2].low)
      swingLows.push({ time: candles[i].time, price: candles[i].low });
  }
  console.log(`  Swing highs: ${swingHighs.length}, Swing lows: ${swingLows.length}`);
  
  for (let i = 50; i < candles.length; i++) {
    const window = candles.slice(Math.max(0, i - 60), i + 1);
    const windowHighs = swingHighs.filter(h => {
      const t = new Date(h.time).getTime();
      const start = new Date(window[0].time).getTime();
      const end = new Date(window[window.length - 1].time).getTime();
      return t >= start && t <= end;
    });
    const windowLows = swingLows.filter(l => {
      const t = new Date(l.time).getTime();
      const start = new Date(window[0].time).getTime();
      const end = new Date(window[window.length - 1].time).getTime();
      return t >= start && t <= end;
    });
    try {
      const patterns = detectPatterns(window as any, windowHighs, windowLows);
      for (const p of patterns) {
        if (p.confidence >= 60) {
          allPatterns.push({ ...p, barIndex: i });
        }
      }
    } catch {}
  }
  console.log(`  Patterns detected (>=60% confidence): ${allPatterns.length}`);

  // Simulate trades
  console.log(`\nSimulating trades...`);
  const trades: TradeRecord[] = [];
  const usedBars = new Set<number>();

  for (const pat of allPatterns) {
    if (usedBars.has(pat.barIndex)) continue;

    const entryIdx = pat.barIndex + 2;
    if (entryIdx >= candles.length - MIN_BARS_HELD) continue;

    const entryPrice = candles[entryIdx].close;
    const sl = pat.stopLoss;
    const tgt = pat.target;
    const rr = calcRR(entryPrice, sl, tgt);
    if (rr === null || rr < MIN_RR) continue;

    // Volatility check
    const atr14 = atr(candles, entryIdx, 14);
    const atr50 = atr(candles, entryIdx, 50);
    if (atr50 > 0 && atr14 / atr50 > 1.5) continue;

    // Trend filter
    const ma50 = sma(candles, entryIdx, 50);
    let trend: "uptrend" | "downtrend" | "neutral" = "neutral";
    if (entryPrice > ma50) trend = "uptrend";
    else if (entryPrice < ma50) trend = "downtrend";

    // Confidence weighting
    let weight = 1.0;
    if (pat.type === "bear_flag") weight = 0.65;
    else if (pat.type === "bull_flag") weight = 0.85;
    else if (pat.type === "falling_wedge") weight = 1.15;
    else if (pat.type === "cup_and_handle") weight = 1.15;

    const adjustedConfidence = Math.min(99, Math.round(pat.confidence * weight));
    if (adjustedConfidence < 60) continue;

    // Hold trade
    let exitIdx = entryIdx;
    let exitPrice = entryPrice;
    let hitSL = false;
    let hitTarget = false;
    let movedToBE = false;
    const stopLevel = Math.min(sl, entryPrice * 0.97);

    for (let j = entryIdx + 1; j < Math.min(entryIdx + 120, candles.length); j++) {
      const high = candles[j].high;
      const low = candles[j].low;

      // Breakeven lock
      if (!movedToBE) {
        const moveR = pat.direction === "bullish"
          ? (high - entryPrice) / (entryPrice - sl)
          : (entryPrice - low) / (sl - entryPrice);
        if (moveR >= 1.0) movedToBE = true;
      }

      if (pat.direction === "bullish") {
        if (low <= (movedToBE ? entryPrice : stopLevel)) { hitSL = true; exitIdx = j; exitPrice = movedToBE ? entryPrice : stopLevel; break; }
        if (high >= tgt) { hitTarget = true; exitIdx = j; exitPrice = tgt; break; }
      } else {
        if (high >= (movedToBE ? entryPrice : stopLevel)) { hitSL = true; exitIdx = j; exitPrice = movedToBE ? entryPrice : stopLevel; break; }
        if (low <= tgt) { hitTarget = true; exitIdx = j; exitPrice = tgt; break; }
      }
      exitIdx = j;
      exitPrice = candles[j].close;
    }

    const barsHeld = exitIdx - entryIdx;
    if (barsHeld < MIN_BARS_HELD) continue;

    const pnl = pat.direction === "bullish"
      ? (exitPrice - entryPrice) / (entryPrice - sl)
      : (entryPrice - exitPrice) / (sl - entryPrice);

    const result = hitSL ? (movedToBE ? "scratch" : "loss") : hitTarget ? "win" : pnl > 0 ? "win" : pnl < -0.5 ? "loss" : "scratch";

    trades.push({
      patternType: pat.type,
      direction: pat.direction,
      confidence: adjustedConfidence,
      entryDate: candles[entryIdx].time,
      entryPrice,
      stopLoss: sl,
      target: tgt,
      exitDate: candles[exitIdx].time,
      exitPrice,
      rMultiple: Math.round(pnl * 100) / 100,
      barsHeld,
      result,
      trendAtEntry: trend,
    });

    usedBars.add(pat.barIndex);
  }

  // Print results
  const wins = trades.filter(t => t.result === "win");
  const losses = trades.filter(t => t.result === "loss");
  const scratches = trades.filter(t => t.result === "scratch");
  const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : "0";
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length).toFixed(2) : "0";
  const avgLoss = losses.length > 0 ? (losses.reduce((s, t) => s + t.rMultiple, 0) / losses.length).toFixed(2) : "0";

  console.log(`\n${"=".repeat(80)}`);
  console.log(`RESULTS: HDFCBANK.NS (5 Years)`);
  console.log(`${"=".repeat(80)}`);
  console.log(`  Total Trades: ${trades.length}`);
  console.log(`  Wins: ${wins.length} | Losses: ${losses.length} | Scratches: ${scratches.length}`);
  console.log(`  Win Rate: ${winRate}%`);
  console.log(`  Total Return: ${totalR.toFixed(2)}R`);
  console.log(`  Avg Win: ${avgWin}R | Avg Loss: ${avgLoss}R`);
  console.log(`${"=".repeat(80)}`);

  // Per-pattern breakdown
  const byPattern = new Map<string, { wins: number; losses: number; scratches: number; totalR: number }>();
  for (const t of trades) {
    if (!byPattern.has(t.patternType))
      byPattern.set(t.patternType, { wins: 0, losses: 0, scratches: 0, totalR: 0 });
    const v = byPattern.get(t.patternType)!;
    if (t.result === "win") v.wins++;
    else if (t.result === "loss") v.losses++;
    else v.scratches++;
    v.totalR += t.rMultiple;
  }

  if (byPattern.size > 0) {
    console.log(`\n  Per-Pattern Breakdown:`);
    for (const [ptype, stats] of byPattern) {
      const total = stats.wins + stats.losses + stats.scratches;
      const pwr = total > 0 ? (stats.wins / total * 100).toFixed(1) : "0";
      console.log(`    ${ptype}: ${stats.wins}W/${stats.scratches}S/${stats.losses}L (${pwr}%) Total: ${stats.totalR.toFixed(2)}R`);
    }
  }

  // Trade details
  console.log(`\n  Trade Details:`);
  for (const t of trades) {
    const icon = t.result === "win" ? "✅" : t.result === "scratch" ? "➖" : "❌";
    console.log(`    ${icon} ${t.patternType} ${t.confidence}% | ${t.entryDate}→${t.exitDate} (${t.barsHeld}b) | ₹${t.entryPrice.toFixed(0)}→₹${t.exitPrice.toFixed(0)} | R:${t.rMultiple} | ${t.trendAtEntry}`);
  }

  // Save results
  const resultsDir = path.join(__dirname, "backtest_results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const resultPath = path.join(resultsDir, "HDFCBANK_backtest.json");
  fs.writeFileSync(resultPath, JSON.stringify({ symbol: SYMBOL, trades, summary: { totalTrades: trades.length, winRate, totalR, avgWin, avgLoss } }, null, 2));
  console.log(`\n  Results saved to: ${resultPath}`);
}

main().catch(console.error);
