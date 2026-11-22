"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getCurrentMode } from "@/lib/theme";
import {
  createChart, IChartApi, ISeriesApi, ColorType, LineStyle, CrosshairMode,
  createSeriesMarkers, CandlestickSeries, LineSeries, HistogramSeries,
} from "lightweight-charts";
import { api } from "@/lib/api";
import type { OHLCVPoint, FundamentalsData } from "@/lib/types";
import { detectPatterns as detectChartPatterns, patternAbbr, patternDescription } from "@/lib/patterns";
import { computeIndicators } from "@/lib/indicators";
import {
  detectCandlestickPatterns, candlestickPatternColor, candlestickPatternEmoji,
  candlestickSummary, type DetectedCandlePattern,
} from "@/lib/candlestick-patterns";

// ── Helpers ──

function tickerDisplay(t: string): string { return t.replace(".NS", "").replace(".BO", ""); }
function fmt(v: number | undefined | null, decimals = 1): string {
  if (v == null || Number.isNaN(v)) return "\u2014";
  if (Math.abs(v) >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  return v.toFixed(decimals);
}
function fmtPct(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return "\u2014";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtPrice(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return "\u2014";
  return `\u20b9${v.toFixed(0)}`;
}
function toChartTime(t: string) { return t as any; }

function scoreColor(s: number): string {
  if (s >= 70) return "#22c55e";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}
function scoreColorClass(s: number): string {
  if (s >= 70) return "text-green-500";
  if (s >= 50) return "text-yellow-500";
  return "text-red-500";
}
function scoreLabel(s: number): string {
  if (s >= 80) return "Strong";
  if (s >= 65) return "Good";
  if (s >= 45) return "Neutral";
  return "Weak";
}

const PERIODS = [
  { label: "3M", value: "3mo" }, { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" }, { label: "2Y", value: "2y" }, { label: "5Y", value: "5y" },
];

const DEFAULT_TICKER = "HDFCBANK.NS";

// ══════════════════════════════════════════════════════════════
//  CONVOLUTION SCORE COMPONENT
// ══════════════════════════════════════════════════════════════

function ConvolutionScore({ score }: { score: number }) {
  return (
    <Card className="text-center">
      <CardContent className="p-4">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Convolution Score
        </p>
        <h2 className={cn("text-4xl font-extrabold my-1", scoreColorClass(score))}>
          {score}
        </h2>
        <Badge className="text-[0.7rem] font-semibold text-white" style={{ backgroundColor: scoreColor(score) }}>
          {scoreLabel(score)}
        </Badge>
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  FUNDAMENTALS PANEL
// ══════════════════════════════════════════════════════════════

function FundamentalsPanel({ data }: { data: FundamentalsData }) {
  const sections = [
    {
      title: "Valuation",
      items: [
        { label: "P/E (TTM)", value: fmt(data.pe_trailing) },
        { label: "P/E (Fwd)", value: fmt(data.pe_forward) },
        { label: "P/B", value: fmt(data.pb_ratio) },
        { label: "P/S", value: fmt(data.ps_ratio) },
        { label: "PEG", value: fmt(data.peg_ratio) },
        { label: "EV/EBITDA", value: "\u2014" },
      ],
    },
    {
      title: "Profitability",
      items: [
        { label: "Profit Margin", value: fmtPct(data.profit_margin) },
        { label: "Operating Margin", value: fmtPct(data.operating_margin) },
        { label: "ROE", value: fmtPct(data.roe) },
        { label: "ROA", value: fmtPct(data.roa) },
        { label: "Revenue Growth", value: fmtPct(data.revenue_growth) },
        { label: "EPS (TTM)", value: fmtPrice(data.eps_trailing) },
      ],
    },
    {
      title: "Financial Health",
      items: [
        { label: "D/E Ratio", value: fmt(data.debt_to_equity) },
        { label: "Current Ratio", value: fmt(data.current_ratio) },
        { label: "Book Value", value: fmtPrice(data.book_value) },
        { label: "Free Cash Flow", value: `\u20b9${fmt(data.free_cash_flow / 1e7)}Cr` },
        { label: "Dividend Yield", value: fmtPct(data.dividend_yield) },
        { label: "Beta", value: fmt(data.beta) },
      ],
    },
    {
      title: "Market",
      items: [
        { label: "Market Cap", value: `\u20b9${fmt(data.market_cap / 1e7)}Cr` },
        { label: "52W High", value: fmtPrice(data.fifty_two_week_high) },
        { label: "52W Low", value: fmtPrice(data.fifty_two_week_low) },
        { label: "Avg Volume", value: `\u20b9${fmt(data.avg_volume / 1e5)}L` },
        { label: "Analyst Target", value: fmtPrice(data.analyst_target) },
        { label: "Recommendation", value: data.analyst_recommendation || "\u2014" },
      ],
    },
  ];

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-bold">Fundamentals</h4>
          <Badge className="text-[0.65rem] font-semibold text-white" style={{ backgroundColor: scoreColor(data.fundamental_score) }}>
            Score: {data.fundamental_score}/100
          </Badge>
        </div>

        {sections.map((sec) => (
          <div key={sec.title} className="mb-3">
            <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {sec.title}
            </p>
            <div className="grid grid-cols-2 gap-0.5 mt-1">
              {sec.items.map((item) => (
                <div key={item.label} className="flex justify-between py-1 px-2 rounded hover:bg-muted/50">
                  <span className="text-[0.65rem] text-muted-foreground">{item.label}</span>
                  <span className="text-[0.65rem] font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  CHART PATTERNS LIST
// ══════════════════════════════════════════════════════════════

function ChartPatternsList({ patterns }: { patterns: ReturnType<typeof detectChartPatterns> }) {
  if (patterns.length === 0) return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted-foreground">No chart patterns detected</p>
    </div>
  );

  return (
    <div>
      {patterns.slice(0, 8).map((p, i) => {
        const dir = p.direction === "bullish" ? "bullish" as const : "bearish" as const;
        return (
          <div key={i} className="py-2 px-2 rounded mb-1 hover:bg-muted/50">
            <div className="flex items-center gap-2">
              <Badge className={cn(
                "text-[0.6rem] font-semibold h-5",
                dir === "bullish" ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500",
              )}>
                {patternAbbr(p.type)}
              </Badge>
              <span className="text-[0.7rem] font-semibold flex-1">
                {p.type.replace(/_/g, " ")}
              </span>
              <Badge className={cn(
                "text-[0.6rem] font-semibold h-5",
                p.confidence >= 70 ? "bg-green-500/15 text-green-500" : p.confidence >= 50 ? "bg-yellow-500/15 text-yellow-500" : "bg-red-500/15 text-red-500",
              )}>
                {p.confidence}%
              </Badge>
            </div>
            <p className="text-[0.6rem] text-muted-foreground mt-0.5">
              {patternDescription(p.type)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  CANDLESTICK PATTERNS LIST
// ══════════════════════════════════════════════════════════════

function CandlestickPatternsList({ patterns }: { patterns: DetectedCandlePattern[] }) {
  const summary = useMemo(() => candlestickSummary(patterns), [patterns]);

  const grouped = useMemo(() => {
    const map: Record<string, { pattern: DetectedCandlePattern; count: number; latest: DetectedCandlePattern }> = {};
    for (const p of patterns) {
      if (!map[p.type]) map[p.type] = { pattern: p, count: 0, latest: p };
      map[p.type].count++;
      map[p.type].latest = p;
    }
    return Object.values(map).sort((a, b) => b.latest.barIndex - a.latest.barIndex);
  }, [patterns]);

  if (patterns.length === 0) return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted-foreground">No candlestick patterns detected</p>
    </div>
  );

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <Badge className="text-[0.6rem] font-semibold bg-green-500/15 text-green-500">{summary.bullish} Bullish</Badge>
        <Badge className="text-[0.6rem] font-semibold bg-red-500/15 text-red-500">{summary.bearish} Bearish</Badge>
        <Badge className="text-[0.6rem] font-semibold bg-zinc-400/15 text-zinc-400">{summary.neutral} Neutral</Badge>
      </div>

      {grouped.slice(0, 12).map(({ pattern: p, count }) => (
        <div key={p.type} className="py-2 px-2 rounded mb-1 hover:bg-muted/50">
          <div className="flex items-center gap-2">
            <span className="text-sm">{candlestickPatternEmoji(p)}</span>
            <span className="text-[0.7rem] font-semibold flex-1">{p.name}</span>
            {count > 1 && <Badge variant="secondary" className="h-[18px] text-[0.55rem]">&times;{count}</Badge>}
            <Badge
              className="text-[0.6rem] font-semibold h-5"
              style={{ backgroundColor: candlestickPatternColor(p) + "22", color: candlestickPatternColor(p) }}
            >
              {p.confidence}%
            </Badge>
          </div>
          <p className="text-[0.6rem] text-muted-foreground mt-0.5">{p.description}</p>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  MAIN CONVOLUTION PAGE
// ══════════════════════════════════════════════════════════════

export default function ConvolutionPage() {
  // State
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [tickerInput, setTickerInput] = useState(DEFAULT_TICKER);
  const [period, setPeriod] = useState("1y");
  const [candles, setCandles] = useState<OHLCVPoint[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);

  // Fetch NSE symbols for autocomplete
  useEffect(() => {
    api.getNseSymbols().then((resp) => {
      const syms = resp.symbols.filter((s: string) => s.endsWith(".NS")).sort();
      setSymbols(syms);
    }).catch(() => {});
  }, []);

  // Fetch data
  const fetchData = useCallback(async (t: string, p: string) => {
    setLoading(true); setError(null);
    try {
      const [ohlcvResp, fundResp] = await Promise.all([
        api.getOHLCV(t, p),
        api.getFundamentals(t).catch(() => null),
      ]);
      const valid = ohlcvResp.candles.filter((d: OHLCVPoint) =>
        d && d.time && [d.open, d.high, d.low, d.close, d.volume].every((v) => v != null && !Number.isNaN(Number(v)))
      );
      setCandles(valid);
      if (fundResp) setFundamentals(fundResp);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(ticker, period); }, [ticker, period, fetchData]);

  // Detect chart patterns
  const chartPatterns = useMemo(() => {
    if (candles.length < 30) return [];
    const ohlcvInput = candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const indicators = computeIndicators(ohlcvInput);
    return detectChartPatterns(candles, indicators.swingHighs, indicators.swingLows);
  }, [candles]);

  // Detect candlestick patterns
  const candlePatterns = useMemo(() => {
    if (candles.length < 10) return [];
    return detectCandlestickPatterns(candles.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    })));
  }, [candles]);

  // Compute convolution score
  const convolutionScore = useMemo(() => {
    let score = 50;
    const bullPatterns = chartPatterns.filter(p => p.direction === "bullish").length;
    const bearPatterns = chartPatterns.filter(p => p.direction === "bearish").length;
    score += Math.min(15, (bullPatterns - bearPatterns) * 5);
    const csSummary = candlestickSummary(candlePatterns);
    score += Math.min(15, (csSummary.bullish - csSummary.bearish) * 3);
    if (fundamentals) {
      score += Math.round((fundamentals.fundamental_score - 50) * 0.4);
    }
    return Math.max(0, Math.min(100, score));
  }, [chartPatterns, candlePatterns, fundamentals]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    const t = tickerInput.includes(".") ? tickerInput : `${tickerInput}.NS`;
    setTicker(t);
  }, [tickerInput]);

  return (
    <div className="w-full max-w-[1400px]">
      {/* Header */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <h1 className="text-lg font-bold flex-1">Convolution Analysis</h1>
            <div className="w-full md:w-auto">
              <Input
                placeholder="e.g. HDFCBANK"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                list="conv-ticker-list"
                className="w-full md:w-[280px]"
              />
              <datalist id="conv-ticker-list">
                {symbols.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p.value}
                  variant={period === p.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Button onClick={handleSubmit} disabled={loading} className="font-semibold">
              Analyse
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading progress */}
      {loading && (
        <div className="w-full h-1 bg-muted rounded-full mb-4 overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "60%" }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-l-4 border-red-500 bg-red-500/10 text-red-400 p-3 rounded mb-4">
          {error}
        </div>
      )}

      {!loading && !error && candles.length > 0 && (
        <>
          {/* Top summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <ConvolutionScore score={convolutionScore} />

            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Chart Patterns
                </p>
                <h4 className="text-2xl font-bold my-1">
                  {chartPatterns.length}
                </h4>
                <div className="flex justify-center gap-1">
                  <Badge className="text-[0.6rem] h-[18px] bg-green-500/15 text-green-500">
                    {chartPatterns.filter(p => p.direction === "bullish").length} Bull
                  </Badge>
                  <Badge className="text-[0.6rem] h-[18px] bg-red-500/15 text-red-500">
                    {chartPatterns.filter(p => p.direction === "bearish").length} Bear
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Candlestick Patterns
                </p>
                <h4 className="text-2xl font-bold my-1">
                  {candlestickSummary(candlePatterns).total}
                </h4>
                <div className="flex justify-center gap-1">
                  <Badge className="text-[0.6rem] h-[18px] bg-green-500/15 text-green-500">
                    {candlestickSummary(candlePatterns).bullish} Bull
                  </Badge>
                  <Badge className="text-[0.6rem] h-[18px] bg-red-500/15 text-red-500">
                    {candlestickSummary(candlePatterns).bearish} Bear
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Fundamentals
                </p>
                <h4 className={cn("text-2xl font-bold my-1", scoreColorClass(fundamentals?.fundamental_score ?? 50))}>
                  {fundamentals?.fundamental_score ?? "\u2014"}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {fundamentals?.sector || "\u2014"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Main chart */}
          <ConvolutionChart
            candles={candles}
            chartPatterns={chartPatterns}
            candlePatterns={candlePatterns}
          />

          {/* Bottom row: Chart Patterns | Candlestick Patterns | Fundamentals */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <Card className="max-h-[500px] overflow-auto">
              <CardContent className="p-3">
                <h4 className="text-sm font-bold mb-2">
                  Chart Patterns ({chartPatterns.length})
                </h4>
                <ChartPatternsList patterns={chartPatterns} />
              </CardContent>
            </Card>

            <Card className="max-h-[500px] overflow-auto">
              <CardContent className="p-3">
                <h4 className="text-sm font-bold mb-2">
                  Candlestick Patterns ({candlestickSummary(candlePatterns).total})
                </h4>
                <CandlestickPatternsList patterns={candlePatterns} />
              </CardContent>
            </Card>

            <div>
              {fundamentals ? (
                <FundamentalsPanel data={fundamentals} />
              ) : (
                <Card>
                  <CardContent className="p-3">
                    <p className="text-sm text-muted-foreground">Loading fundamentals...</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  CONVOLUTION CHART (lightweight-charts with all overlays)
// ══════════════════════════════════════════════════════════════

function ConvolutionChart({
  candles,
  chartPatterns,
  candlePatterns,
}: {
  candles: OHLCVPoint[];
  chartPatterns: ReturnType<typeof detectChartPatterns>;
  candlePatterns: DetectedCandlePattern[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(getCurrentMode() === "dark");
  }, []);

  useLayoutEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const w = containerRef.current.clientWidth;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" as const },
        textColor: isDark ? "#9ca3af" : "#71717a", fontSize: 10,
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(9,9,11,0.05)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(9,9,11,0.05)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(9,9,11,0.12)", timeVisible: false },
      rightPriceScale: { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(9,9,11,0.12)" },
      width: w, height: 420,
    });
    chartRef.current = chart;

    // Candlestick series
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });
    const candleData = candles.map(d => ({
      time: toChartTime(d.time), open: Number(d.open), high: Number(d.high),
      low: Number(d.low), close: Number(d.close),
    }));
    const sorted = [...candleData].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    try { cs.setData(sorted); } catch (_) {}

    // Volume
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" as const }, priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    try {
      vol.setData(candles.map(d => ({
        time: toChartTime(d.time), value: Number(d.volume),
        color: d.close >= d.open ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
      })));
    } catch (_) {}

    // Chart pattern lines + markers
    const markers: any[] = [];
    const styleMap: Record<string, LineStyle> = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };
    const times = candles.map(d => d.time);
    const t0 = toChartTime(times[0]);
    const tN = toChartTime(times[times.length - 1]);

    for (const p of chartPatterns) {
      if (p.lines) {
        for (const tl of p.lines) {
          try {
            const ln = chart.addSeries(LineSeries, {
              color: tl.color || (p.direction === "bullish" ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"),
              lineWidth: tl.width || 1, lineStyle: styleMap[tl.style] || LineStyle.Dashed,
              lastValueVisible: false, priceLineVisible: false,
            });
            ln.setData([
              { time: toChartTime(tl.startTime), value: tl.startPrice },
              { time: toChartTime(tl.endTime), value: tl.endPrice },
            ]);
          } catch (_) {}
        }
      }
      if (p.triggerPrice) {
        try {
          const triggerLn = chart.addSeries(LineSeries, {
            color: "rgba(139,92,246,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed,
            lastValueVisible: false, priceLineVisible: false,
          });
          triggerLn.setData([{ time: t0, value: p.triggerPrice }, { time: tN, value: p.triggerPrice }]);
        } catch (_) {}
      }
      const markerTime = p.markers.length > 0 ? p.markers[0].time : null;
      if (markerTime) {
        const abbr = patternAbbr(p.type);
        markers.push({
          time: toChartTime(markerTime),
          position: p.direction === "bullish" ? "belowBar" : "aboveBar",
          color: p.direction === "bullish" ? "#22c55e" : "#ef4444",
          shape: "arrowUp" as any,
          text: `${abbr} ${p.confidence}%`,
        });
      }
    }

    // Candlestick pattern markers
    const recentCandlePatterns = candlePatterns.filter(p => p.barIndex >= candles.length - 40);
    for (const cp of recentCandlePatterns) {
      markers.push({
        time: toChartTime(cp.time),
        position: cp.direction === "bullish" ? "belowBar" : cp.direction === "bearish" ? "aboveBar" : "inBar",
        color: candlestickPatternColor(cp),
        shape: "circle" as any,
        text: cp.name,
      });
    }

    markers.sort((a: any, b: any) => String(a.time).localeCompare(String(b.time)));
    try { createSeriesMarkers(cs, markers); } catch (_) {}

    chart.timeScale().fitContent();

    const onResize = () => {
      const newW = containerRef.current?.clientWidth;
      if (newW) chart.applyOptions({ width: newW });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, chartPatterns, candlePatterns, isDark]);

  return (
    <Card>
      <CardContent className="p-2">
        <p className="px-2 py-1 mb-1 text-[0.6rem] text-muted-foreground">
          \ud83d\udfe2 Chart Patterns (arrows) | \ud83d\udfe3 Candlestick Patterns (circles) | Lines = trendlines + triggers
        </p>
        <div ref={containerRef} className="w-full rounded overflow-hidden" />
      </CardContent>
    </Card>
  );
}
