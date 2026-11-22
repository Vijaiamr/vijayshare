/**
 * NSE Pattern Backtester
 *
 * Uses yahoo-finance2 for .NS data + MA50 trend context filter.
 *
 * Run: npx tsx backtest_nse.ts
 */
import { detectPatterns } from "./lib/patterns";
import YahooFinance from "yahoo-finance2";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── NSE Symbols (liquid, diversified) ────────────────────────────────────────
const NSE_SYMBOLS = [
  // NIFTY 50 Constituents
  "RELIANCE.NS",  "TCS.NS",       "HDFCBANK.NS",  "INFY.NS",      "ICICIBANK.NS",
  "HINDUNILVR.NS","ITC.NS",       "SBIN.NS",      "BHARTIARTL.NS","KOTAKBANK.NS",
  "WIPRO.NS",     "AXISBANK.NS",  "MARUTI.NS",    "BAJFINANCE.NS","ADANIENT.NS",
  "NTPC.NS",      "POWERGRID.NS", "TITAN.NS",     "ASIANPAINT.NS","SUNPHARMA.NS",
  "BAJAJFINSV.NS","ULTRACEMCO.NS","HCLTECH.NS",   "LT.NS",        "ONGC.NS",
  "TATAMOTORS.NS","JSWSTEEL.NS",  "HINDALCO.NS",  "TATASTEEL.NS", "COALINDIA.NS",
  "BPCL.NS",      "INDUSINDBK.NS","ADANIPORTS.NS","GRASIM.NS",    "BRITANNIA.NS",
  "HEROMOTOCO.NS","CIPLA.NS",     "DRREDDY.NS",   "DIVISLAB.NS",  "APOLLOHOSP.NS",
  "SBILIFE.NS",   "HDFCLIFE.NS",  "TATACONSUM.NS","NESTLEIND.NS", "BAJAJ-AUTO.NS",
  "EICHERMOT.NS", "TRENT.NS",     "BEL.NS",       "HAL.NS",
  // Additional liquid mid-caps
  "VEDL.NS",      "IOC.NS",       "GAIL.NS",      "M&M.NS",       "TECHM.NS",
  "PIDILITIND.NS","HINDZINC.NS",  "DABUR.NS",     "MARICO.NS",    "HAVELLS.NS",
  // Extra sector coverage
  "BANKBARODA.NS","PNB.NS",       "LICHSGFIN.NS", "SRTRANSFIN.NS","MUTHOOTFIN.NS",
  "TVSMOTOR.NS",  "MRF.NS",       "ASHOKLEY.NS",  "GODREJCP.NS",  "COLPAL.NS",
  "BIOCON.NS",    "LUPIN.NS",     "TORNTPHARM.NS","JUBLFOOD.NS",  "BERGEPAINT.NS",
].filter(Boolean); // clean trailing comma safety

const MIN_RR = 1.5;
const MIN_BARS_HELD = 5; // Minimum bars before exit (daily: ~1 trading week)

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
  symbol: string; patternType: string; direction: "bullish" | "bearish";
  confidence: number; entryDate: string; entryPrice: number;
  stopLoss: number; target: number; exitDate: string; exitPrice: number;
  rMultiple: number; barsHeld: number; result: "win" | "loss" | "scratch";
  trendAtEntry: "uptrend" | "downtrend" | "neutral";
}

async function runBacktest(yf: any, symbol: string) {
  // Fetch ~5.5 years of data for statistical robustness
  const endDate = "2026-07-08";
  const startDate = "2021-01-01";
  const hist = await yf.chart(symbol, {
    period1: startDate,
    period2: endDate,
    interval: "1d",
  }) as any;

  if (!hist || !hist.quotes || hist.quotes.length < 200) {
    console.log(`  Insufficient data for ${symbol}: ${hist?.quotes?.length || 0} bars`);
    return null;
  }

  // Filter out null closes (today's incomplete bar)
  const rawCandles: { time: string; open: number; high: number; low: number; close: number; volume: number }[] =
    hist.quotes
      .filter((c: any) => c.close !== null && c.open !== null && c.high !== null && c.low !== null)
      .map((c: any) => {
        const d = new Date(c.date);
        const time = d.toISOString().slice(0, 10);
        return { time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
      });

  if (rawCandles.length < 500) {
    console.log(`  Too few valid bars for ${symbol}: ${rawCandles.length} (need 500+)`);
    return null;
  }

  const trades: TradeRecord[] = [];
  const WARMUP = 150; // Need enough bars for MA50 + swing points

  for (let i = WARMUP; i < rawCandles.length; i++) {
    const windowCandles = rawCandles.slice(0, i + 1);
    const { highs, lows } = findSwingPoints(windowCandles, i);
    if (highs.length < 3 || lows.length < 3) continue;

    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    const patterns = detectPatterns(windowCandles, recentHighs, recentLows);

    for (const ptn of patterns) {
      // Accept "forming" (not yet triggered) or "active" (triggered but not complete)
      if (ptn.status === "completed" || ptn.status === "failed") continue;
      if (!ptn.stopLoss || !ptn.target) continue;

      // Determine trigger/entry price for 2-close confirmation
      let triggerPrice = ptn.triggerPrice;
      if (ptn.status === "active" && triggerPrice === null) {
        // Pattern already triggered — use entry price as reference
        triggerPrice = ptn.entry;
      }
      if (!triggerPrice) continue;

      // ── TREND CONTEXT FILTER (MA50) ────────────────────────────────────────
      const ma50 = sma(windowCandles, i, 50);
      if (ma50 < 0) continue;
      const currentClose = windowCandles[i].close;
      const inUptrend = currentClose > ma50 * 1.02;   // 2% buffer above MA50
      const inDowntrend = currentClose < ma50 * 0.98;  // 2% buffer below MA50
      const trend = inUptrend ? "uptrend" : inDowntrend ? "downtrend" : "neutral";

      // Skip bearish patterns in uptrends, skip bullish patterns in downtrends
      if (ptn.direction === "bearish" && inUptrend) continue;
      if (ptn.direction === "bullish" && inDowntrend) continue;

      // ── VOLATILITY FILTER (ATR expansion) ────────────────────────────
      const shortATR = atr(windowCandles, i, 14);
      const longATR = atr(windowCandles, i, 50);
      const atrRatio = longATR > 0 ? shortATR / longATR : 0;
      if (atrRatio > 1.5) {
        // Skip when volatility is expanding — high-vol breakouts fail more often
        continue;
      }

      // ── R:R Filter ─────────────────────────────────────────────────────────
      const potentialRR = calcRR(triggerPrice, ptn.stopLoss, ptn.target);
      if (potentialRR === null || potentialRR < MIN_RR) continue;

      // ── Entry: 2 consecutive closes beyond trigger ─────────────────────────
      let entryIdx = -1;
      for (let j = i + 2; j < rawCandles.length; j++) {
        const c1 = rawCandles[j - 1], c2 = rawCandles[j];
        const bullish = ptn.direction === "bullish";
        if (bullish && c1.close >= triggerPrice && c2.close >= triggerPrice) { entryIdx = j; break; }
        if (!bullish && c1.close <= triggerPrice && c2.close <= triggerPrice) { entryIdx = j; break; }
      }
      if (entryIdx < 0) continue;

      const entryPrice = rawCandles[entryIdx].close;
      const entryDate = rawCandles[entryIdx].time;

      // ── ATR-based stop ──────────────────────────────────────────────────────
      const currATR = atr(rawCandles, entryIdx, 14);
      const minStopDist = Math.max(currATR * 2, entryPrice * 0.03);
      let sl: number;
      if (ptn.direction === "bullish") {
        sl = Math.min(ptn.stopLoss, entryPrice - minStopDist);
      } else {
        sl = Math.max(ptn.stopLoss, entryPrice + minStopDist);
      }

      // ── Recalculate target ──────────────────────────────────────────────────
      const origTargetDist = ptn.direction === "bullish"
        ? ptn.target - triggerPrice : triggerPrice - ptn.target;
      const origRiskDist = ptn.direction === "bullish"
        ? triggerPrice - ptn.stopLoss : ptn.stopLoss - triggerPrice;
      const origRR = origRiskDist > 0 ? origTargetDist / origRiskDist : 0;
      const actualRiskDist = ptn.direction === "bullish" ? entryPrice - sl : sl - entryPrice;
      const target = ptn.direction === "bullish"
        ? entryPrice + actualRiskDist * origRR
        : entryPrice - actualRiskDist * origRR;

      // ── Breakeven Lock ─────────────────────────────────────────────────────
      // When price moves 1R in our favour, stop ratchets to entry and locks.
      // Target remains the only exit — prevents full -1R losses without cutting winners.
      const beActivate = minStopDist;
      let bestPrice = entryPrice;
      let trailingStop = sl;
      let beLocked = false;

      // ── Simulate trade ────────────────────────────────────────────────────
      let exitIdx = -1, exitPrice = 0;
      for (let j = entryIdx + 1; j < rawCandles.length; j++) {
        const c = rawCandles[j];

        if (ptn.direction === "bullish") {
          if (c.high > bestPrice) bestPrice = c.high;
          // Lock at breakeven once price moves 1R in our favor
          if (!beLocked && (bestPrice - entryPrice) >= beActivate) {
            trailingStop = entryPrice;
            beLocked = true;
          }
          // Check exits: target first, then stop
          if (c.high >= target) { exitIdx = j; exitPrice = target; break; }
          if (c.low <= trailingStop) { exitIdx = j; exitPrice = trailingStop; break; }
        } else {
          if (c.low < bestPrice) bestPrice = c.low;
          // Lock at breakeven once price moves 1R in our favor (shorts)
          if (!beLocked && (entryPrice - bestPrice) >= beActivate) {
            trailingStop = entryPrice;
            beLocked = true;
          }
          // Check exits: target first, then stop
          if (c.low <= target) { exitIdx = j; exitPrice = target; break; }
          if (c.high >= trailingStop) { exitIdx = j; exitPrice = trailingStop; break; }
        }
      }
      if (exitIdx < 0) continue;

      // ── MIN BARS HELD FILTER ──────────────────────────────────────
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

  // ── Stats ──────────────────────────────────────────────────────────────────
  const wins = trades.filter(t => t.result === "win");
  const losses = trades.filter(t => t.result === "loss");
  const scratches = trades.filter(t => t.result === "scratch");
  const decisiveTrades = wins.length + losses.length;
  const winRate = decisiveTrades > 0 ? (wins.length / decisiveTrades) * 100 : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, t) => s + t.rMultiple, 0) / losses.length : 0;
  const totalReturn = trades.reduce((s, t) => s + t.rMultiple, 0);

  // Sharpe
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const variance = trades.length > 1 ? trades.reduce((s, t) => s + (t.rMultiple - avgR) ** 2, 0) / (trades.length - 1) : 0;
  const sharpe = Math.sqrt(variance) > 0 ? (avgR / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  // Max consecutive losses
  let streak = 0, maxStreak = 0;
  for (const t of trades) {
    if (t.result === "loss") { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }

  // Per-pattern breakdown
  const byPattern = new Map<string, { wins: number; losses: number; scratches: number }>();
  for (const t of trades) {
    const p = t.patternType;
    if (!byPattern.has(p)) byPattern.set(p, { wins: 0, losses: 0, scratches: 0 });
    const v = byPattern.get(p)!;
    if (t.result === "win") v.wins++;
    else if (t.result === "loss") v.losses++;
    else v.scratches++;
  }

  return {
    symbol,
    totalCandles: rawCandles.length,
    dateRange: `${rawCandles[0].time} → ${rawCandles[rawCandles.length - 1].time}`,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    scratches: scratches.length,
    winRate: Math.round(winRate * 100) / 100,
    avgWinR: Math.round(avgWinR * 100) / 100,
    avgLossR: Math.round(avgLossR * 100) / 100,
    totalReturn: Math.round(totalReturn * 100) / 100,
    maxConsecutiveLosses: maxStreak,
    sharpe: Math.round(sharpe * 100) / 100,
    byPattern: Object.fromEntries(byPattern),
    trades,
  };
}

interface RunResult {
  symbol: string;
  trades: TradeRecord[];
  stats: {
    totalCandles: number; dateRange: string; totalTrades: number;
    wins: number; losses: number; scratches: number;
    winRate: number; avgWinR: number; avgLossR: number;
    totalReturn: number; maxConsecutiveLosses: number;
    sharpe: number; byPattern: Record<string, { wins: number; losses: number; scratches: number }>;
  } | null;
  error?: string;
}

// ── Parallel Map with Concurrency Limit ────────────────────────────────────
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  const poolSize = Math.min(concurrency, items.length);
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Result Persistence ─────────────────────────────────────────────────────
const RESULTS_DIR = path.resolve(__dirname, "backtest_results");

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function resultFilePath(symbol: string): string {
  return path.join(RESULTS_DIR, `${symbol.replace(".NS", "")}_result.json`);
}

function loadExistingResult(symbol: string): RunResult | null {
  try {
    const fp = resultFilePath(symbol);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch { /* ignore corrupt files */ }
  return null;
}

function saveResult(r: RunResult) {
  ensureResultsDir();
  fs.writeFileSync(resultFilePath(r.symbol), JSON.stringify(r, null, 2));
}

async function runBacktestWithPersistence(yf: any, symbol: string): Promise<RunResult> {
  // Resume: skip if we already have a persisted result
  const existing = loadExistingResult(symbol);
  if (existing) return existing;

  process.stdout.write(`  [${symbol.replace(".NS", "")}] Starting...\n`);
  try {
    const r = await runBacktest(yf, symbol);
    if (!r) {
      const result: RunResult = { symbol, trades: [], stats: null };
      saveResult(result);
      return result;
    }
    const result: RunResult = {
      symbol,
      trades: r.trades,
      stats: {
        totalCandles: r.totalCandles,
        dateRange: r.dateRange,
        totalTrades: r.totalTrades,
        wins: r.wins,
        losses: r.losses,
        scratches: r.scratches,
        winRate: r.winRate,
        avgWinR: r.avgWinR,
        avgLossR: r.avgLossR,
        totalReturn: r.totalReturn,
        maxConsecutiveLosses: r.maxConsecutiveLosses,
        sharpe: r.sharpe,
        byPattern: r.byPattern,
      },
    };
    saveResult(result);
    return result;
  } catch (e: any) {
    const result: RunResult = { symbol, trades: [], stats: null, error: e.message };
    saveResult(result);
    return result;
  }
}

function formatSymbolResult(r: RunResult): string {
  if (r.error) return `  ERROR: ${r.error}`;
  if (!r.stats || r.trades.length === 0) {
    return r.stats ? `  No trades. (${r.stats.totalCandles} bars, ${r.stats.dateRange})` : "  No data";
  }
  const s = r.stats;
  let out = `  Trades: ${s.wins}W/${s.scratches}S/${s.losses}L  Win: ${s.winRate}%  AvgR: ${s.avgWinR > 0 ? s.avgWinR : '—'}  LossR: ${s.avgLossR}\n`;
  out += `  Total: ${s.totalReturn}R  Sharpe: ${s.sharpe}  MaxLoss: ${s.maxConsecutiveLosses}\n`;
  if (Object.keys(s.byPattern).length > 0) {
    out += `  Patterns: ${JSON.stringify(s.byPattern)}\n`;
  }
  for (const t of r.trades) {
    const icon = t.result === "win" ? "✅" : t.result === "scratch" ? "➖" : "❌";
    out += `    ${icon} ${t.patternType} ${t.confidence}% | ${t.entryDate}→${t.exitDate} (${t.barsHeld}b) | ${t.entryPrice}→${t.exitPrice} | R:${t.rMultiple} | ${t.trendAtEntry}\n`;
  }
  return out;
}

function computeAggregate(allResults: RunResult[]): string {
  const all = allResults.flatMap(r => r.trades);
  const aw = all.filter(t => t.result === "win");
  const al = all.filter(t => t.result === "loss");
  const as = all.filter(t => t.result === "scratch");
  const decisive = aw.length + al.length;
  const wr = all.length > 0 ? (aw.length / all.length) * 100 : 0;
  const trueWr = decisive > 0 ? (aw.length / decisive) * 100 : 0;
  const avgWR = aw.length > 0 ? aw.reduce((s, t) => s + t.rMultiple, 0) / aw.length : 0;
  const avgLR = al.length > 0 ? al.reduce((s, t) => s + t.rMultiple, 0) / al.length : 0;
  const tr = all.reduce((s, t) => s + t.rMultiple, 0);
  const profitable = allResults.filter(r => r.trades.reduce((s, t) => s + t.rMultiple, 0) > 0).length;

  const aggByPattern = new Map<string, { wins: number; losses: number; scratches: number; totalR: number }>();
  for (const t of all) {
    if (!aggByPattern.has(t.patternType))
      aggByPattern.set(t.patternType, { wins: 0, losses: 0, scratches: 0, totalR: 0 });
    const v = aggByPattern.get(t.patternType)!;
    if (t.result === "win") v.wins++;
    else if (t.result === "loss") v.losses++;
    else v.scratches++;
    v.totalR += t.rMultiple;
  }

  let out = "\n" + "=".repeat(120) + "\n";
  out += "AGGREGATE NSE RESULTS\n";
  out += "=".repeat(120) + "\n";
  out += `  Total trades: ${all.length}\n`;
  out += `  Wins: ${aw.length}  Scratches: ${as.length}  Losses: ${al.length}\n`;
  out += `  Win rate (decisive only): ${trueWr.toFixed(1)}%  (incl scratches: ${wr.toFixed(1)}%)\n`;
  out += `  Avg Win R: ${avgWR.toFixed(2)}  Avg Loss R: ${avgLR.toFixed(2)}  Total: ${tr.toFixed(2)}R\n`;
  out += `  Profitable symbols: ${profitable}/${allResults.length}\n`;
  const beWR = avgWR > 0 ? (Math.abs(avgLR) / (avgWR + Math.abs(avgLR))) * 100 : 0;
  out += `  Breakeven win rate needed (avg win ${avgWR.toFixed(2)}R / loss ${avgLR.toFixed(2)}R): ${beWR.toFixed(1)}%\n`;

  if (aggByPattern.size > 0) {
    out += `\n  Per-pattern breakdown:\n`;
    for (const [ptype, stats] of aggByPattern) {
      const total = stats.wins + stats.losses + stats.scratches;
      const pwr = total > 0 ? (stats.wins / total * 100).toFixed(1) : "0";
      out += `    ${ptype}: ${stats.wins}W/${stats.scratches}S/${stats.losses}L (${pwr}%) Total: ${stats.totalR.toFixed(2)}R\n`;
    }
  }
  return out;
}

function saveAggregateReport(allResults: RunResult[], elapsedMs: number) {
  ensureResultsDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(RESULTS_DIR, `aggregate_${ts}.json`);

  const summary = {
    timestamp: new Date().toISOString(),
    elapsedSeconds: Math.round(elapsedMs / 1000),
    cpuCores: os.cpus().length,
    config: {
      symbols: NSE_SYMBOLS.length,
      minRR: MIN_RR,
      stop: "Max(pattern stop, 2×ATR or 3%)",
      breakevenLock: "1R activation, locks at entry",
      filters: "MA50 trend, ATR vol, reliability weights",
      minConfidence: 85,
    },
    aggregate: computeAggregate(allResults).trim(),
    results: allResults.map(r => ({
      symbol: r.symbol,
      error: r.error,
      totalTrades: r.stats?.totalTrades ?? 0,
      wins: r.stats?.wins ?? 0,
      scratches: r.stats?.scratches ?? 0,
      losses: r.stats?.losses ?? 0,
      winRate: r.stats?.winRate ?? 0,
      totalReturn: r.stats?.totalReturn ?? 0,
      sharpe: r.stats?.sharpe ?? 0,
    })),
  };

  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`\n📄 Aggregate report saved to: ${reportPath}`);
}

function printUsage() {
  console.log(`
Usage: npx tsx backtest_nse.ts [options]

Options:
  --parallel=N   Number of parallel workers (default: CPU cores = ${os.cpus().length})
  --resume       Resume from saved results (skip already-completed symbols)
  --help         Show this help

Background run (survives terminal close):
  nohup npx tsx backtest_nse.ts > backtest_nse_$(date +%Y%m%d_%H%M%S).log 2>&1 &
  disown
  # Check progress: tail -f backtest_results/*.log
  # Check results: ls -la backtest_results/
`);
}

async function main() {
  // ── Parse CLI args ───────────────────────────────────────────────────────
  const args = process.argv.slice(2);
  const helpFlag = args.includes("--help");
  const resumeFlag = args.includes("--resume");
  const parallelArg = args.find(a => a.startsWith("--parallel="));
  const concurrency = parallelArg
    ? Math.max(1, parseInt(parallelArg.split("=")[1], 10))
    : os.cpus().length;

  if (helpFlag) { printUsage(); return; }

  // ── Config Banner ────────────────────────────────────────────────────────
  const startTime = Date.now();
  console.log("=".repeat(120));
  console.log("NSE PATTERN BACKTEST (5.5Y) — v4 Final: Parallel + Breakeven Lock");
  console.log("=".repeat(120));
  console.log(`  Symbols: ${NSE_SYMBOLS.length} NSE stocks`);
  console.log(`  Parallel workers: ${concurrency} (CPU cores: ${os.cpus().length})`);
  console.log(`  Resume mode: ${resumeFlag ? "ON (skips saved results)" : "OFF (re-runs all)"}`);
  console.log(`  Filters: MIN_CONFIDENCE=85, MIN_RR=${MIN_RR}, MA50 trend, ATR vol, reliability weights`);
  console.log(`  Entry:  2 consecutive closes beyond trigger (accepts active + forming patterns)`);
  console.log(`  Stop:   Max(pattern stop, 2×ATR or 3%)`);
  console.log(`  Volatility: Skip if ATR(14)/ATR(50) > 1.5x`);
  console.log(`  Weights: bear_flag=0.65×, bull_flag=0.85×, falling_wedge=1.15×, cup_and_handle=1.15×`);
  console.log(`  Breakeven lock: stop→entry after 1R move in favour (stays at entry, never tightens)`);
  console.log("=".repeat(120));

  // ── Save intermediate results on SIGHUP / SIGINT ─────────────────────────
  let shuttingDown = false;
  const gracefulShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n\n⚠️  Interrupted — partial results are saved in backtest_results/");
    console.log("   Resume later with: npx tsx backtest_nse.ts --resume");
    process.exit(1);
  };
  process.on("SIGHUP", gracefulShutdown);   // terminal disconnect
  process.on("SIGINT", gracefulShutdown);    // Ctrl+C
  process.on("SIGTERM", gracefulShutdown);   // kill
  
  // ── Run All Symbols in Parallel ─────────────────────────────────────────
  const yf = new YahooFinance();
  const symbols = NSE_SYMBOLS.map(s => s);

  let allResults: RunResult[] = [];

  if (resumeFlag) {
    // Load all previously saved results as starting point
    ensureResultsDir();
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith("_result.json"));
    for (const f of files) {
      try {
        const r: RunResult = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf-8"));
        if (r && r.symbol) allResults.push(r);
      } catch { /* skip corrupt */ }
    }
    const completed = new Set(allResults.map(r => r.symbol));
    const remaining = symbols.filter(s => !completed.has(s));
    console.log(`  Found ${allResults.length} saved results, ${remaining.length} symbols remaining`);
    if (remaining.length === 0) {
      console.log(`  All symbols already completed. Showing aggregate report.\n`);
    } else {
      console.log(`  Remaining: ${remaining.map(s => s.replace(".NS", "")).join(", ")}\n`);
      const newResults = await parallelMap(
        remaining,
        sym => runBacktestWithPersistence(yf, sym),
        concurrency,
      );
      allResults = [...allResults, ...newResults];
    }
  } else {
    // Fresh run — clear old results first
    if (fs.existsSync(RESULTS_DIR)) {
      fs.rmSync(RESULTS_DIR, { recursive: true });
    }
    ensureResultsDir();
    allResults = await parallelMap(
      symbols,
      sym => runBacktestWithPersistence(yf, sym),
      concurrency,
    );
  }

  const elapsed = Date.now() - startTime;

  // ── Print Per-Symbol Results ─────────────────────────────────────────────
  for (const r of allResults) {
    process.stdout.write(`\n── ${r.symbol.replace(".NS", "")} ──\n`);
    process.stdout.write(formatSymbolResult(r));
  }

  // ── Print Aggregate ──────────────────────────────────────────────────────
  const aggregate = computeAggregate(allResults);
  console.log(aggregate);

  // ── Save Aggregate Report ─────────────────────────────────────────────────
  saveAggregateReport(allResults, elapsed);
  console.log(`\n⏱  Total time: ${(elapsed / 1000).toFixed(1)}s across ${concurrency} workers\n`);

  // ── Background Instructions ──────────────────────────────────────────────
  console.log("Tip: To run in background (survives terminal close):");
  console.log("  nohup npx tsx backtest_nse.ts > backtest.log 2>&1 &");
  console.log("  tail -f backtest_results/aggregate_*.json  # watch results");
}

main().catch(console.error);
