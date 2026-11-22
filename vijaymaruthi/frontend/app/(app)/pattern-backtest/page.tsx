"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { LineChart, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle, Clock, Gauge, Search, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { loadScreenConfig } from "@/lib/screenConfig";
import type { PatternBacktestResponse, PatternTrade, PerPatternStats, DetectedPattern } from "@/lib/types";

// ─── Helpers ───

function tickerDisplay(t: string): string {
  return t.replace(".NS", "").replace(".BO", "");
}

function resultColorClass(r: "win" | "loss" | "scratch"): string {
  if (r === "win") return "text-green-500";
  if (r === "loss") return "text-red-500";
  return "text-yellow-500";
}

function resultBgClass(r: "win" | "loss" | "scratch"): string {
  if (r === "win") return "bg-green-500/5";
  if (r === "loss") return "bg-red-500/5";
  return "bg-yellow-500/5";
}

function resultLabel(r: "win" | "loss" | "scratch"): string {
  if (r === "win") return "Win";
  if (r === "loss") return "Loss";
  return "Scratch";
}

function directionIcon(d: "bullish" | "bearish") {
  return d === "bullish"
    ? <TrendingUp className="h-4 w-4 text-green-500" />
    : <TrendingDown className="h-4 w-4 text-red-500" />;
}

function trendLabel(t: "uptrend" | "downtrend" | "neutral"): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function trendColorClass(t: "uptrend" | "downtrend" | "neutral"): string {
  if (t === "uptrend") return "text-green-500";
  if (t === "downtrend") return "text-red-500";
  return "text-muted-foreground";
}

function patternColorBg(p: string): string {
  const colors: Record<string, string> = {
    double_top: "bg-red-500",
    double_bottom: "bg-green-500",
    head_and_shoulders: "bg-orange-500",
    inverse_head_and_shoulders: "bg-blue-500",
    cup_and_handle: "bg-purple-500",
    bull_flag: "bg-green-500",
    bear_flag: "bg-red-500",
    rising_wedge: "bg-red-500",
    falling_wedge: "bg-green-500",
    ascending_triangle: "bg-green-500",
    descending_triangle: "bg-red-500",
    symmetric_triangle: "bg-orange-500",
    rectangle: "bg-slate-500",
  };
  return colors[p] || "bg-slate-400";
}

function formatPrice(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return "\u20b9\u2014";
  return `\u20b9${v.toFixed(0)}`;
}

function formatR(r: number | undefined | null): string {
  if (r == null || Number.isNaN(r)) return "0.00R";
  const sign = r >= 0 ? "+" : "";
  return `${sign}${r.toFixed(2)}R`;
}

// ─── Sub-Components ───

function SummaryCards({ result }: { result: PatternBacktestResponse }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Total Trades
          </p>
          <h4 className="text-2xl font-bold mt-1">{result.total_trades}</h4>
          <p className="text-xs text-muted-foreground">
            {result.wins}W / {result.losses}L / {result.scratches}S
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Win Rate
          </p>
          <h4 className={cn("text-2xl font-bold mt-1", (result.win_rate ?? 0) >= 50 ? "text-green-500" : "text-red-500")}>
            {(result.win_rate ?? 0).toFixed(1)}%
          </h4>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Total R
          </p>
          <h4 className={cn("text-2xl font-bold mt-1", result.total_r >= 0 ? "text-green-500" : "text-red-500")}>
            {formatR(result.total_r)}
          </h4>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Avg R / Trade
          </p>
          <h4 className={cn("text-2xl font-bold mt-1", result.total_r >= 0 ? "text-green-500" : "text-red-500")}>
            {result.total_trades > 0 ? formatR(result.total_r / result.total_trades) : "0.00R"}
          </h4>
        </CardContent>
      </Card>
    </div>
  );
}

function TradeTable({ trades }: { trades: PatternTrade[] }) {
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h4 className="text-sm font-bold mb-3">Trade Results ({trades.length})</h4>
        <div className="rounded-md border max-h-[500px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">#</TableHead>
                <TableHead className="font-semibold">Pattern</TableHead>
                <TableHead className="font-semibold">Dir</TableHead>
                <TableHead className="font-semibold text-right">Conf</TableHead>
                <TableHead className="font-semibold">Entry</TableHead>
                <TableHead className="font-semibold text-right">Entry \u20b9</TableHead>
                <TableHead className="font-semibold">Exit</TableHead>
                <TableHead className="font-semibold text-right">Exit \u20b9</TableHead>
                <TableHead className="font-semibold text-right">R-Mult</TableHead>
                <TableHead className="font-semibold text-right">Bars</TableHead>
                <TableHead className="font-semibold">Result</TableHead>
                <TableHead className="font-semibold">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((t, i) => (
                <TableRow key={i} className={resultBgClass(t.result)}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Badge className={cn("font-semibold text-[0.7rem] text-white capitalize", patternColorBg(t.pattern_type))}>
                      {t.pattern_type.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{directionIcon(t.direction)}</TableCell>
                  <TableCell className="text-right">{t.confidence}%</TableCell>
                  <TableCell className="text-[0.8rem]">{t.entry_date}</TableCell>
                  <TableCell className="text-right">{formatPrice(t.entry_price)}</TableCell>
                  <TableCell className="text-[0.8rem]">{t.exit_date}</TableCell>
                  <TableCell className="text-right">{formatPrice(t.exit_price)}</TableCell>
                  <TableCell className={cn("text-right font-semibold", t.r_multiple >= 0 ? "text-green-500" : "text-red-500")}>
                    {formatR(t.r_multiple)}
                  </TableCell>
                  <TableCell className="text-right">{t.bars_held}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("font-semibold text-[0.7rem] border", resultColorClass(t.result),
                        t.result === "win" && "border-green-500 text-green-500",
                        t.result === "loss" && "border-red-500 text-red-500",
                        t.result === "scratch" && "border-yellow-500 text-yellow-500",
                      )}
                    >
                      {resultLabel(t.result)}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn(trendColorClass(t.trend_at_entry), "font-medium text-[0.8rem]")}>
                    {trendLabel(t.trend_at_entry)}
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

function PerPatternTable({ perPattern }: { perPattern: Record<string, PerPatternStats> }) {
  const sorted = useMemo(() => {
    return Object.entries(perPattern)
      .map(([pattern, stats]) => ({ pattern, ...stats }))
      .sort((a, b) => b.total_r - a.total_r);
  }, [perPattern]);

  if (sorted.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h4 className="text-sm font-bold mb-3">Per-Pattern Breakdown</h4>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Pattern</TableHead>
                <TableHead className="font-semibold text-right">Trades</TableHead>
                <TableHead className="font-semibold text-right">Wins</TableHead>
                <TableHead className="font-semibold text-right">Losses</TableHead>
                <TableHead className="font-semibold text-right">Scratches</TableHead>
                <TableHead className="font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-semibold text-right">Total R</TableHead>
                <TableHead className="font-semibold text-right">Avg R</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.pattern}>
                  <TableCell>
                    <Badge className={cn("font-semibold text-[0.7rem] text-white capitalize", patternColorBg(row.pattern))}>
                      {row.pattern.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{row.count}</TableCell>
                  <TableCell className="text-right text-green-500 font-semibold">{row.wins}</TableCell>
                  <TableCell className="text-right text-red-500 font-semibold">{row.losses}</TableCell>
                  <TableCell className="text-right text-yellow-500 font-semibold">{row.scratches}</TableCell>
                  <TableCell className={cn("text-right font-semibold", (row.win_rate ?? 0) >= 50 ? "text-green-500" : "text-red-500")}>
                    {(row.win_rate ?? 0).toFixed(1)}%
                  </TableCell>
                  <TableCell className={cn("text-right font-semibold", row.total_r >= 0 ? "text-green-500" : "text-red-500")}>
                    {formatR(row.total_r)}
                  </TableCell>
                  <TableCell className={cn("text-right", row.avg_r >= 0 ? "text-green-500" : "text-red-500")}>
                    {formatR(row.avg_r)}
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

function LossAnalysis({ trades }: { trades: PatternTrade[] }) {
  const losses = useMemo(() => trades.filter((t) => t.result === "loss"), [trades]);

  const patternLossCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of losses) {
      counts[t.pattern_type] = (counts[t.pattern_type] || 0) + 1;
    }
    return counts;
  }, [losses]);

  if (losses.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h4 className="text-sm font-bold">
            Loss Analysis ({losses.length} losing trades)
          </h4>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Pattern</TableHead>
                <TableHead className="font-semibold">Confidence</TableHead>
                <TableHead className="font-semibold">Trend</TableHead>
                <TableHead className="font-semibold">Entry Date</TableHead>
                <TableHead className="font-semibold text-right">Entry \u20b9</TableHead>
                <TableHead className="font-semibold">Exit Date</TableHead>
                <TableHead className="font-semibold text-right">Exit \u20b9</TableHead>
                <TableHead className="font-semibold text-right">R-Multiple</TableHead>
                <TableHead className="font-semibold text-right">Bars</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {losses.map((t, i) => (
                <TableRow key={i} className="bg-red-500/[0.04]">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge className={cn("font-semibold text-[0.7rem] text-white capitalize", patternColorBg(t.pattern_type))}>
                        {t.pattern_type.replace(/_/g, " ")}
                      </Badge>
                      {patternLossCounts[t.pattern_type] >= 3 && (
                        <Badge className="font-semibold text-[0.6rem] text-white bg-red-500">
                          Repeat Loser
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{t.confidence}%</TableCell>
                  <TableCell className={cn(trendColorClass(t.trend_at_entry), "font-medium text-[0.8rem]")}>
                    {trendLabel(t.trend_at_entry)}
                  </TableCell>
                  <TableCell className="text-[0.8rem]">{t.entry_date}</TableCell>
                  <TableCell className="text-right">{formatPrice(t.entry_price)}</TableCell>
                  <TableCell className="text-[0.8rem]">{t.exit_date}</TableCell>
                  <TableCell className="text-right">{formatPrice(t.exit_price)}</TableCell>
                  <TableCell className="text-right font-semibold text-red-500">
                    {formatR(t.r_multiple)}
                  </TableCell>
                  <TableCell className="text-right">{t.bars_held}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function EquityCurve({ trades }: { trades: PatternTrade[] }) {
  if (trades.length === 0) return null;

  const cumulative: number[] = [];
  let running = 0;
  for (const t of trades) {
    running += t.r_multiple;
    cumulative.push(running);
  }

  const maxVal = Math.max(...cumulative, 0);
  const minVal = Math.min(...cumulative, 0);
  const range = Math.max(maxVal - minVal, 1);
  const barHeight = 100;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h4 className="text-sm font-bold mb-3">Equity Curve (Cumulative R)</h4>
        <div className="relative overflow-hidden" style={{ height: barHeight + 30 }}>
          {/* Zero line */}
          <div
            className="absolute left-0 right-0 h-px bg-muted-foreground opacity-30"
            style={{ bottom: ((0 - minVal) / range) * barHeight + 15 }}
          />
          <svg width="100%" height={barHeight + 30} viewBox={`0 0 ${cumulative.length * 8} ${barHeight + 30}`} preserveAspectRatio="none">
            {cumulative.map((val, i) => {
              const x = i * 8;
              const zeroY = ((maxVal) / range) * barHeight + 15;
              const valY = ((maxVal - val) / range) * barHeight + 15;
              const y = val >= 0 ? valY : zeroY;
              const h = Math.abs(valY - zeroY);
              return (
                <rect
                  key={i}
                  x={x}
                  y={val >= 0 ? valY : zeroY}
                  width={6}
                  height={Math.max(h, 1)}
                  fill={val >= 0 ? "#22c55e" : "#ef4444"}
                  opacity={0.8}
                  rx={1}
                />
              );
            })}
            {cumulative.length > 0 && (
              <text
                x={cumulative.length * 8 - 2}
                y={((maxVal - cumulative[cumulative.length - 1]) / range) * barHeight + 12}
                fill="#e0e0e0"
                fontSize="9"
                textAnchor="end"
                fontWeight="700"
              >
                {formatR(cumulative[cumulative.length - 1])}
              </text>
            )}
          </svg>
          <p className="absolute bottom-0 left-0 text-xs text-muted-foreground">Trade #1</p>
          <p className="absolute bottom-0 right-0 text-xs text-muted-foreground">Trade #{cumulative.length}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <LineChart className="mx-auto mb-2 h-12 w-12 opacity-30" />
      <p className="font-medium mb-1">Run a pattern backtest to see results</p>
      <p className="text-xs text-muted-foreground/60">
        Select a ticker and configure parameters, then click &quot;Run Pattern Backtest&quot;
      </p>
    </div>
  );
}

// ─── Enhanced Confidence Components ───

const CHECKLIST_LABELS: Record<string, string> = {
  valid_structure: "Valid Structure",
  neckline_clear: "Neckline Clear",
  volume_declining: "Volume Declining",
  close_break: "Close Break",
  volume_spike: "Volume >1.5x",
  rr_min: "R:R \u22652.0",
  trend_confirmed: "Trend Confirmed",
  higher_tf: "Higher TF Aligns",
  adx_strong: "ADX >25",
  no_news: "No News",
};

const BREAKDOWN_LABELS: Record<string, string> = {
  volume_break: "Volume Break",
  rr_min: "R:R Min",
  adx: "ADX",
  trend: "Trend",
  symmetry: "Symmetry",
  neckline: "Neckline",
};

function ConfidenceBreakdownBar({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return null;

  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Confidence Breakdown
      </p>
      <div className="flex h-7 rounded border border-border overflow-hidden">
        {entries.map(([key, val]) => {
          const pct = (val / total) * 100;
          const passed = val > 0;
          return (
            <div
              key={key}
              className={cn(
                "flex items-center justify-center border-r border-white/15",
                passed ? "bg-green-500/85" : "bg-muted/25",
              )}
              style={{ width: `${pct}%`, minWidth: passed ? 40 : 20 }}
            >
              <span className={cn("text-[0.6rem] font-semibold whitespace-nowrap", passed ? "text-white" : "text-muted-foreground")}>
                {BREAKDOWN_LABELS[key] || key} {passed ? `${Math.round(val)}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EntryChecklist({ checklist }: { checklist: Record<string, boolean> }) {
  const entries = Object.entries(checklist);
  if (entries.length === 0) return null;

  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Entry Checklist ({entries.filter(([, v]) => v).length}/{entries.length} passed)
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1">
        {entries.map(([key, passed]) => (
          <div key={key} className="flex items-center gap-1.5">
            {passed ? (
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            )}
            <span className={cn("text-[0.7rem]", passed ? "text-foreground font-medium" : "text-muted-foreground")}>
              {CHECKLIST_LABELS[key] || key.replace(/_/g, " ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FailureRiskBars({ risks }: { risks: Record<string, number> }) {
  const sorted = Object.entries(risks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (sorted.length === 0) return null;

  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Top Failure Risks
      </p>
      <div className="space-y-1.5">
        {sorted.map(([mode, prob]) => {
          const pct = Math.round(prob * 100);
          const colorClass = pct >= 30 ? "text-red-500 bg-red-500" : pct >= 20 ? "text-yellow-500 bg-yellow-500" : "text-green-500 bg-green-500";
          return (
            <div key={mode} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex justify-between mb-0.5">
                  <span className="text-[0.7rem] font-medium capitalize">
                    {mode.replace(/_/g, " ")}
                  </span>
                  <span className={cn("text-[0.7rem] font-bold", colorClass.split(" ")[0])}>
                    {pct}%
                  </span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full", colorClass.split(" ")[1])} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MultiTimeframeBadge({ pattern }: { pattern: DetectedPattern }) {
  const tf = pattern.timeframe || "daily";
  const boost = pattern.multi_tf_boost || 0;

  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Timeframe Analysis
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {(["daily", "weekly", "monthly"] as const).map((t) => {
          const active = t === tf;
          return (
            <Badge
              key={t}
              variant={active ? "default" : "secondary"}
              className={cn(
                "text-[0.65rem]",
                active ? "bg-green-500/12 text-green-500 border border-green-500" : "bg-muted text-muted-foreground border border-transparent",
              )}
            >
              {active && <CheckCircle className="h-3 w-3 mr-0.5" />}
              {t.charAt(0).toUpperCase() + t.slice(1)} {active ? "\u2713" : "\u2717"}
            </Badge>
          );
        })}
        {boost > 0 && (
          <Badge className="text-[0.65rem] font-bold bg-blue-500/12 text-blue-500">
            <Gauge className="h-3 w-3 mr-0.5" />
            +{Math.round(boost * 100)}% boost
          </Badge>
        )}
      </div>
    </div>
  );
}

function DetectedPatternsSection({ patterns }: { patterns: DetectedPattern[] }) {
  if (!patterns || patterns.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-5 w-5 text-blue-500" />
          <h4 className="text-sm font-bold">Active Pattern Analysis</h4>
        </div>

        <div className="space-y-4">
          {patterns.map((p, i) => (
            <div
              key={i}
              className="p-3 rounded border border-border bg-muted/50"
            >
              <div className="flex items-center gap-2 mb-2">
                <Badge className={cn("font-semibold text-[0.7rem] text-white capitalize", patternColorBg(p.type))}>
                  {p.type.replace(/_/g, " ")}
                </Badge>
                {directionIcon(p.direction as "bullish" | "bearish")}
                <span className="text-sm font-bold">{p.confidence}%</span>
                <Badge variant="secondary" className="text-[0.6rem] font-medium uppercase">
                  {p.timeframe}
                </Badge>
              </div>

              <ConfidenceBreakdownBar breakdown={p.confidence_breakdown} />
              <EntryChecklist checklist={p.entry_checklist} />
              <FailureRiskBars risks={p.failure_risk} />
              <MultiTimeframeBadge pattern={p} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───

export default function PatternBacktestPage() {
  // Form state
  const [ticker, setTicker] = useState<string>("");
  const [tickerInput, setTickerInput] = useState<string>("");
  const [years, setYears] = useState<number>(3);
  const [minConfidence, setMinConfidence] = useState<number>(60);
  const [minRr, setMinRr] = useState<number>(1.5);

  // Data state
  const [result, setResult] = useState<PatternBacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [patternFilter, setPatternFilter] = useState<Record<string, boolean>>({});
  const [resultFilter, setResultFilter] = useState<Record<string, boolean>>({ win: true, loss: true, scratch: true });
  const [directionFilter, setDirectionFilter] = useState<Record<string, boolean>>({ bullish: true, bearish: true });
  const [dateSearch, setDateSearch] = useState("");

  // NSE symbols for autocomplete
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);

  // Fetch NSE symbols on mount
  useEffect(() => {
    (async () => {
      setSymbolsLoading(true);
      try {
        const resp = await api.getNseSymbols();
        const filtered = resp.symbols.filter((s) => s.endsWith(".NS")).sort();
        setSymbols(filtered);
      } catch {
        setSymbols([]);
      } finally {
        setSymbolsLoading(false);
      }
    })();
  }, []);

  // Initialize pattern filter when result arrives
  useEffect(() => {
    if (result?.per_pattern) {
      const patterns = Object.keys(result.per_pattern);
      const initial: Record<string, boolean> = {};
      for (const p of patterns) initial[p] = true;
      setPatternFilter(initial);
    }
  }, [result]);

  // Run pattern backtest
  const runBacktest = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const tickerSymbol = ticker.includes(".") ? ticker : `${ticker}.NS`;
      // Feature 3: pass the user's saved screen dials so the backtest honors
      // the same thresholds as the chart / Patterns tab.
      const resp = await api.patternBacktest(tickerSymbol, years, minConfidence, minRr, loadScreenConfig() ?? undefined);
      setResult(resp);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pattern backtest failed";
      if (msg.includes("abort") || msg.includes("timeout")) {
        setError("Request timed out. Try a shorter period.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [ticker, years, minConfidence, minRr]);

  // Filtered trades
  const filteredTrades = useMemo(() => {
    if (!result) return [];
    return result.trades.filter((t) => {
      if (!patternFilter[t.pattern_type]) return false;
      if (!resultFilter[t.result]) return false;
      if (!directionFilter[t.direction]) return false;
      if (dateSearch) {
        const q = dateSearch.toLowerCase();
        if (!t.entry_date.includes(q) && !t.exit_date.includes(q)) return false;
      }
      return true;
    });
  }, [result, patternFilter, resultFilter, directionFilter, dateSearch]);

  const hasFilters = useMemo(() => {
    if (!result?.per_pattern) return false;
    const allPatterns = Object.keys(result.per_pattern);
    const allOff = allPatterns.every((p) => !patternFilter[p]);
    const resultsOff = !resultFilter.win && !resultFilter.loss && !resultFilter.scratch;
    const dirOff = !directionFilter.bullish && !directionFilter.bearish;
    return allOff || resultsOff || dirOff || dateSearch.length > 0;
  }, [patternFilter, resultFilter, directionFilter, dateSearch, result]);

  const clearFilters = useCallback(() => {
    if (result?.per_pattern) {
      const initial: Record<string, boolean> = {};
      for (const p of Object.keys(result.per_pattern)) initial[p] = true;
      setPatternFilter(initial);
    }
    setResultFilter({ win: true, loss: true, scratch: true });
    setDirectionFilter({ bullish: true, bearish: true });
    setDateSearch("");
  }, [result]);

  return (
    <div className="w-full max-w-[1100px]">
      {/* Header */}
      <h1 className="text-xl font-bold mb-4 flex items-center gap-2">
        <LineChart className="h-5 w-5" /> Pattern Backtest
      </h1>

      {/* Config Card */}
      <Card className="mb-6">
        <CardContent className="p-6 space-y-5">
          <div>
            <label className="text-sm font-medium">NSE Ticker</label>
            <Input
              placeholder="e.g. HDFCBANK.NS or RELIANCE.NS"
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setTicker(e.target.value);
              }}
              list="pattern-ticker-list"
              className="mt-1"
            />
            <datalist id="pattern-ticker-list">
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground mt-1">
              Enter a ticker symbol (e.g. HDFCBANK.NS, TCS.NS, INFY.NS)
            </p>
          </div>

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

          <div>
            <p className="text-sm font-medium mb-1">
              Min Confidence: {minConfidence}%
            </p>
            <div className="flex items-center gap-2 max-w-[400px]">
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <span className="text-xs text-muted-foreground w-8">{minConfidence}%</span>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">
              Min Risk:Reward: 1:{minRr}
            </p>
            <div className="flex items-center gap-2 max-w-[400px]">
              <input
                type="range"
                min={1.0}
                max={3.0}
                step={0.25}
                value={minRr}
                onChange={(e) => setMinRr(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <span className="text-xs text-muted-foreground w-8">1:{minRr}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={runBacktest}
              disabled={loading || !ticker}
              className="font-semibold"
            >
              {loading ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Running Pattern Backtest...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Pattern Backtest
                </>
              )}
            </Button>
            {result && (
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setError(null);
                  clearFilters();
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {loading && (
            <p className="text-xs text-muted-foreground/60">
              Pattern detection in progress — this may take up to 2 minutes for large datasets.
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
          {result.error && (
            <div className="border-l-4 border-yellow-500 bg-yellow-500/10 text-yellow-400 p-3 rounded mb-4">
              {result.error}
              {result.note && (
                <p className="text-xs mt-1 opacity-80">{result.note}</p>
              )}
            </div>
          )}

          {result.total_trades > 0 && <SummaryCards result={result} />}

          {result.detected_patterns && result.detected_patterns.length > 0 && (
            <DetectedPatternsSection patterns={result.detected_patterns} />
          )}

          {result.total_trades === 0 && (
            <div className="border-l-4 border-blue-500 bg-blue-500/10 text-blue-400 p-3 rounded mb-4">
              No pattern trades found for {tickerDisplay(result.ticker)}. Try adjusting the confidence or R:R filters, or use a longer data period.
            </div>
          )}

          {/* Interactive Filters */}
          {result.total_trades > 0 && (
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold">
                    Filters {hasFilters && `(${filteredTrades.length} of ${result.trades.length} trades)`}
                  </h4>
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-7">
                      Clear Filters
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Pattern filters */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Pattern Types
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {Object.keys(patternFilter).map((p) => (
                        <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={patternFilter[p]}
                            onCheckedChange={(checked) => setPatternFilter((prev) => ({ ...prev, [p]: !!checked }))}
                          />
                          <span className="text-xs capitalize">{p.replace(/_/g, " ")}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Result type filters */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Result
                      </p>
                      <div className="flex gap-3">
                        {(["win", "loss", "scratch"] as const).map((r) => (
                          <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                            <Checkbox
                              checked={resultFilter[r]}
                              onCheckedChange={(checked) => setResultFilter((prev) => ({ ...prev, [r]: !!checked }))}
                              className={cn(
                                r === "win" && "data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500",
                                r === "loss" && "data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500",
                                r === "scratch" && "data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500",
                              )}
                            />
                            <span className="text-xs capitalize">{resultLabel(r)}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Direction filters */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Direction
                      </p>
                      <div className="flex gap-3">
                        {(["bullish", "bearish"] as const).map((d) => (
                          <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                            <Checkbox
                              checked={directionFilter[d]}
                              onCheckedChange={(checked) => setDirectionFilter((prev) => ({ ...prev, [d]: !!checked }))}
                            />
                            <span className="text-xs capitalize">{d}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Date search */}
                  <div className="relative max-w-[260px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search dates (e.g. 2024-06)"
                      value={dateSearch}
                      onChange={(e) => setDateSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {filteredTrades.length > 0 && <TradeTable trades={filteredTrades} />}

          {Object.keys(result.per_pattern).length > 0 && <PerPatternTable perPattern={result.per_pattern} />}

          <EquityCurve trades={result.trades} />

          <LossAnalysis trades={result.trades} />
        </>
      )}

      {/* Empty state */}
      {!result && !loading && !error && <EmptyState />}

      {/* Footer */}
      <p className="text-xs text-muted-foreground/60 text-center pt-3 pb-2 border-t border-border mt-4">
        Pattern backtest results are based on historical data and do not guarantee future performance.
      </p>
    </div>
  );
}
