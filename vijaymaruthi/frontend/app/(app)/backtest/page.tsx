"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BarChart, Play, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { BacktestResponse, BacktestGroupResult, BacktestComparison } from "@/lib/types";

// ─── Helpers ───

function tickerDisplay(t: string): string {
  return t.replace(".NS", "").replace(".BO", "");
}

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

function ratingBgClass(group: string): string {
  switch (group) {
    case "Strong Buy": return "bg-green-500 text-white";
    case "Buy": return "bg-green-400 text-white";
    case "Hold": return "bg-yellow-500 text-white";
    case "Sell": return "bg-red-400 text-white";
    case "Strong Sell": return "bg-red-500 text-white";
    default: return "bg-zinc-500 text-white";
  }
}

// ─── Sub-Components ───

function SummaryCards({ result }: { result: BacktestResponse }) {
  const bestComparison = result.comparisons.length > 0
    ? result.comparisons.reduce((a, b) => (a.overall_win_rate_90d > b.overall_win_rate_90d ? a : b))
    : null;
  const winRate = bestComparison?.overall_win_rate_90d ?? 0;
  const avgReturn = bestComparison?.avg_return_90d ?? 0;
  const sharpe = bestComparison?.sharpe_90d ?? 0;
  const totalTrades = bestComparison?.total_trades ?? result.total_signals;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Total Signals
          </p>
          <h4 className="text-2xl font-bold mt-1">{totalTrades}</h4>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Win Rate
          </p>
          <h4 className={cn("text-2xl font-bold mt-1", winRate >= 0.5 ? "text-green-500" : "text-red-500")}>
            {(winRate * 100).toFixed(1)}%
          </h4>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Avg Return
          </p>
          <h4 className={cn("text-2xl font-bold mt-1", avgReturn >= 0 ? "text-green-500" : "text-red-500")}>
            {pct(avgReturn)}
          </h4>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Sharpe Ratio
          </p>
          <h4 className={cn("text-2xl font-bold mt-1", sharpe >= 1 ? "text-green-500" : sharpe >= 0 ? "text-yellow-500" : "text-red-500")}>
            {sharpe.toFixed(2)}
          </h4>
        </CardContent>
      </Card>
    </div>
  );
}

function GroupResultsTable({ rows }: { rows: BacktestGroupResult[] }) {
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h4 className="text-sm font-bold mb-3">Performance by Rating Group</h4>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Rating</TableHead>
                <TableHead className="font-semibold text-right">Trades</TableHead>
                <TableHead className="font-semibold text-right">Avg Return (90d)</TableHead>
                <TableHead className="font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-semibold text-right">Sharpe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.group}>
                  <TableCell>
                    <Badge className={cn("font-semibold", ratingBgClass(row.group))}>
                      {row.group}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{row.count}</TableCell>
                  <TableCell className={cn("text-right font-semibold", row.avg_return_90d >= 0 ? "text-green-500" : "text-red-500")}>
                    {pct(row.avg_return_90d)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {(row.win_rate_90d * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className={cn("text-right", row.sharpe_90d >= 1 ? "text-green-500" : row.sharpe_90d >= 0 ? "text-yellow-500" : "text-red-500")}>
                    {row.sharpe_90d.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonsTable({ rows }: { rows: BacktestComparison[] }) {
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h4 className="text-sm font-bold mb-3">Methodology Comparison</h4>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Methodology</TableHead>
                <TableHead className="font-semibold text-right">Trades</TableHead>
                <TableHead className="font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-semibold text-right">Avg Return</TableHead>
                <TableHead className="font-semibold text-right">Sharpe</TableHead>
                <TableHead className="font-semibold text-right">Spread Return</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.methodology}>
                  <TableCell className="font-semibold">{row.methodology}</TableCell>
                  <TableCell className="text-right">{row.total_trades}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {(row.overall_win_rate_90d * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className={cn("text-right", row.avg_return_90d >= 0 ? "text-green-500" : "text-red-500")}>
                    {pct(row.avg_return_90d)}
                  </TableCell>
                  <TableCell className="text-right">{row.sharpe_90d.toFixed(2)}</TableCell>
                  <TableCell className={cn("text-right", row.spread_return_90d >= 0 ? "text-green-500" : "text-red-500")}>
                    {pct(row.spread_return_90d)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <BarChart className="mx-auto mb-2 h-12 w-12 opacity-30" />
      <p className="font-medium mb-1">Run a backtest to see results</p>
      <p className="text-xs text-muted-foreground/60">
        Select a ticker and configure parameters, then click &quot;Run Backtest&quot;
      </p>
    </div>
  );
}

// ─── Main Page ───

export default function BacktestPage() {
  const router = useRouter();

  // Form state
  const [ticker, setTicker] = useState<string>("");
  const [tickerInput, setTickerInput] = useState<string>("");
  const [years, setYears] = useState<number>(3);
  const [rebalanceDays, setRebalanceDays] = useState<number>(63);

  // Data state
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NSE symbols for autocomplete
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);

  // Fetch NSE symbols on mount
  useEffect(() => {
    (async () => {
      setSymbolsLoading(true);
      try {
        const resp = await api.getNseSymbols();
        const filtered = resp.symbols
          .filter(s => s.endsWith(".NS"))
          .sort();
        setSymbols(filtered);
      } catch {
        setSymbols([]);
      } finally {
        setSymbolsLoading(false);
      }
    })();
  }, []);

  // Run backtest
  const runBacktest = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const tickerSymbol = ticker.includes(".") ? ticker : `${ticker}.NS`;
      const resp = await api.runBacktest(tickerSymbol, years, rebalanceDays);
      setResult(resp);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Backtest failed";
      if (msg.includes("abort") || msg.includes("timeout")) {
        setError("Backtest timed out. Try a shorter period or fewer years.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [ticker, years, rebalanceDays]);

  return (
    <div className="w-full max-w-[900px]">
      {/* Header */}
      <h1 className="text-xl font-bold mb-4 flex items-center gap-2">
        <BarChart className="h-5 w-5" /> Backtest Engine
      </h1>

      {/* Config Card */}
      <Card className="mb-6">
        <CardContent className="p-6 space-y-5">
          {/* Ticker Autocomplete */}
          <div>
            <label className="text-sm font-medium">NSE Ticker</label>
            <Input
              placeholder="e.g. HDFCBANK.NS or RELIANCE.NS"
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setTicker(e.target.value);
              }}
              list="ticker-list"
              className="mt-1"
            />
            <datalist id="ticker-list">
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground mt-1">
              Enter a ticker symbol (e.g. HDFCBANK.NS, TCS.NS, INFY.NS)
            </p>
          </div>

          {/* Years Slider */}
          <div>
            <p className="text-sm font-medium mb-1">
              Data Period: {years} year{years !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-2 max-w-[400px]">
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <span className="text-xs text-muted-foreground w-8">{years}y</span>
            </div>
          </div>

          {/* Rebalance Days Slider */}
          <div>
            <p className="text-sm font-medium mb-1">
              Rebalance Every: {rebalanceDays} trading days
            </p>
            <div className="flex items-center gap-2 max-w-[400px]">
              <input
                type="range"
                min={5}
                max={252}
                step={1}
                value={rebalanceDays}
                onChange={(e) => setRebalanceDays(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <span className="text-xs text-muted-foreground w-8">{rebalanceDays}d</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={runBacktest}
              disabled={loading || !ticker}
              className="font-semibold"
            >
              {loading ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Running Backtest...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Backtest
                </>
              )}
            </Button>
            {result && (
              <Button
                variant="outline"
                onClick={() => { setResult(null); setError(null); }}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Loading hint */}
          {loading && (
            <p className="text-xs text-muted-foreground/60">
              Backtest in progress — this may take up to 2 minutes for large datasets.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="border-l-4 border-red-500 bg-red-500/10 text-red-400 p-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {"error" in result && (result as any).error && (
            <div className="border-l-4 border-yellow-500 bg-yellow-500/10 text-yellow-400 p-3 rounded mb-4">
              {(result as any).error}
              {(result as any).note && (
                <p className="text-xs mt-1 opacity-80">
                  {(result as any).note}
                </p>
              )}
            </div>
          )}

          {result.total_signals > 0 && <SummaryCards result={result} />}

          {result.group_results.length > 0 && <GroupResultsTable rows={result.group_results} />}

          {result.comparisons.length > 0 && <ComparisonsTable rows={result.comparisons} />}

          {result.total_signals === 0 && (
            <div className="border-l-4 border-blue-500 bg-blue-500/10 text-blue-400 p-3 rounded">
              No signals generated for {tickerDisplay(result.ticker)}. The backtester requires sufficient historical data to generate valid trading signals. Try a longer period or a different ticker.
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !loading && !error && <EmptyState />}

      {/* Footer */}
      <p className="text-xs text-muted-foreground/60 text-center pt-3 pb-2 border-t border-border mt-4">
        Backtest results are based on historical data and do not guarantee future performance.
      </p>
    </div>
  );
}
