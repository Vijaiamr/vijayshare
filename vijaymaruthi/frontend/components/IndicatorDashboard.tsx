"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { signalHex, signalStyle } from "@/lib/theme";

// ─── Types ───

interface RsiData {
  value: number;
  status: string;
  overbought: boolean;
  oversold: boolean;
}

interface MacdData {
  macd: number;
  signal: number;
  histogram: number;
  crossover: string;
  above_zero: boolean;
  histogram_increasing: boolean;
}

interface AdxData {
  adx: number;
  plus_di: number;
  minus_di: number;
  strength: string;
  di_bias: string;
}

interface AtrData {
  atr: number;
  percent_of_price: number;
  regime: string;
}

interface VolumeData {
  avg_vol_20: number;
  avg_vol_50: number;
  last_volume: number;
  volume_ratio_vs_20: number;
  status: string;
  up_down_ratio_10d: number;
}

interface MaData {
  sma20: number;
  sma50: number;
  sma200: number;
  price_vs_20: number;
  price_vs_50: number;
  price_vs_200: number;
  above_20: boolean;
  above_50: boolean;
  above_200: boolean;
}

interface IndicatorsData {
  rsi?: RsiData;
  macd?: MacdData;
  adx?: AdxData;
  atr?: AtrData;
  volume?: VolumeData;
  bollinger?: Record<string, unknown>;
}

interface TrendData {
  ma?: MaData;
  adx?: AdxData;
  [key: string]: unknown;
}

interface Props {
  indicators: IndicatorsData;
  trend?: TrendData;
  evidence?: { technical: string[]; fundamental: string[] };
  marketStructure?: Record<string, unknown>;
  price: number;
  ticker: string;
  signal: string;
}

// ─── Helpers ───

function isIndianTicker(t: string): boolean {
  return t.endsWith(".NS") || t.endsWith(".BO");
}

function fmtPrice(p: number, ticker: string): string {
  if (!Number.isFinite(p)) return "N/A";
  if (isIndianTicker(ticker)) return `₹${p.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(2)}`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

// ─── Sub-components ───

function GaugeBar({ value, label, low, high, goodColor, badColor }: {
  value: number; label: string; low: number; high: number;
  goodColor?: string; badColor?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= high ? (goodColor || "text-strong-buy") :
    clamped <= low ? (badColor || "text-strong-sell") :
    "text-hold";
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex justify-between">
        <span className="text-[0.7rem] font-semibold text-muted-foreground">{label}</span>
        <span className={cn("text-[0.7rem] font-bold", color)}>{value.toFixed(1)}</span>
      </div>
      <Progress value={clamped} className="h-1.5 [&>[data-slot=progress-track]]:bg-muted [&>[data-slot=progress-track]]:rounded-full [&>[data-slot=progress-indicator]]:rounded-full" />
    </div>
  );
}

function RsiGauge({ rsi }: { rsi: RsiData }) {
  const color = rsi.overbought ? "text-strong-sell" : "text-strong-buy";
  const bgColor = rsi.overbought ? "bg-strong-sell" : "bg-strong-buy";
  return (
    <div className="rounded-lg border border-border p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.65rem] font-bold uppercase tracking-widest">RSI</span>
        <Badge
          className={cn("h-[18px] text-[0.6rem] font-semibold")}
          style={signalStyle(rsi.overbought ? "strongSell" : "strongBuy")}
        >
          {rsi.status}
        </Badge>
      </div>
      <h4 className={cn("mb-0.5 text-2xl font-extrabold leading-none", color)}>
        {rsi.value.toFixed(1)}
      </h4>
      <div className="relative mb-0.5 h-1.5 rounded-full bg-muted">
        {/* Overbought zone */}
        <div className="absolute right-0 top-0 h-full w-[30%] rounded-r-[3px] bg-strong-sell opacity-15" />
        {/* Oversold zone */}
        <div className="absolute left-0 top-0 h-full w-[30%] rounded-l-[3px] bg-strong-buy opacity-15" />
        {/* Pointer */}
        <div
          className={cn("absolute -top-0.5 size-3 -translate-x-1/2 rounded-full border-2 border-background", bgColor)}
          style={{ left: `${Math.max(0, Math.min(100, rsi.value))}%` }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-[0.55rem] text-muted-foreground">0 Oversold</span>
        <span className="text-[0.55rem] text-muted-foreground">Overbought 100</span>
      </div>
    </div>
  );
}

function MacdBlock({ macd }: { macd: MacdData }) {
  const isBullish = macd.crossover === "Bullish";
  return (
    <div className="rounded-lg border border-border p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.65rem] font-bold uppercase tracking-widest">MACD</span>
        <Badge
          className={cn("h-[18px] text-[0.6rem] font-semibold")}
          style={signalStyle(isBullish ? "strongBuy" : "strongSell")}
        >
          {macd.crossover}
        </Badge>
      </div>
      <div className="flex flex-col gap-0.5">
        <Row label="MACD" value={macd.macd.toFixed(2)} />
        <Row label="Signal" value={macd.signal.toFixed(2)} />
        <Row label="Histogram" value={macd.histogram.toFixed(2)} color={macd.histogram >= 0 ? "text-strong-buy" : "text-strong-sell"} />
        <Row label="Above Zero" value={macd.above_zero ? "Yes" : "No"} icon={macd.above_zero ? <Check className="size-3 text-strong-buy" /> : <X className="size-3 text-strong-sell" />} />
      </div>
    </div>
  );
}

function AdxBlock({ adx }: { adx: AdxData }) {
  const biasColor = adx.di_bias === "Bullish" ? "text-strong-buy" : adx.di_bias === "Bearish" ? "text-strong-sell" : "text-hold";
  return (
    <div className="rounded-lg border border-border p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.65rem] font-bold uppercase tracking-widest">ADX</span>
        <Badge className="h-[18px] bg-secondary text-[0.6rem] font-semibold text-secondary-foreground">
          {adx.strength}
        </Badge>
      </div>
      <h4 className="mb-0.5 text-2xl font-extrabold leading-none">
        {adx.adx.toFixed(1)}
      </h4>
      <GaugeBar value={adx.adx} label="Trend Strength" low={25} high={50} />
      <div className="flex flex-col gap-0.25">
        <Row label="+DI" value={`${adx.plus_di.toFixed(1)}°`} color="text-strong-buy" />
        <Row label="-DI" value={`${adx.minus_di.toFixed(1)}°`} color="text-strong-sell" />
        <Row label="Bias" value={adx.di_bias} color={biasColor} />
      </div>
    </div>
  );
}

function MaBlock({ ma, price, ticker }: { ma: MaData; price: number; ticker: string }) {
  const aboveCount = [ma.above_20, ma.above_50, ma.above_200].filter(Boolean).length;
  return (
    <div className="rounded-lg border border-border p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.65rem] font-bold uppercase tracking-widest">
          Moving Averages
        </span>
        <Badge
          className={cn("h-[18px] text-[0.6rem] font-semibold")}
          style={signalStyle(aboveCount >= 2 ? "strongBuy" : "hold")}
        >
          {aboveCount}/3 above
        </Badge>
      </div>
      <p className="mb-1 font-bold">
        Price: {fmtPrice(price, ticker)}
      </p>
      <div className="flex flex-col gap-0.25">
        <MaRow label="SMA 20" value={ma.sma20} diff={ma.price_vs_20} above={ma.above_20} ticker={ticker} />
        <MaRow label="SMA 50" value={ma.sma50} diff={ma.price_vs_50} above={ma.above_50} ticker={ticker} />
        <MaRow label="SMA 200" value={ma.sma200} diff={ma.price_vs_200} above={ma.above_200} ticker={ticker} />
      </div>
    </div>
  );
}

function MaRow({ label, value, diff, above, ticker }: { label: string; value: number; diff: number; above: boolean; ticker: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-0.5">
        <div className={cn("size-2 flex-shrink-0 rounded-full", above ? "bg-strong-buy" : "bg-strong-sell")} />
        <span className="text-[0.7rem] text-muted-foreground">{label}</span>
      </div>
      <span className={cn("text-[0.7rem] font-bold", above ? "text-strong-buy" : "text-strong-sell")}>
        {fmtPrice(value, ticker)} · {fmtPct(diff)}
      </span>
    </div>
  );
}

function VolumeBlock({ vol, ticker }: { vol: VolumeData; ticker: string }) {
  return (
    <div className="rounded-lg border border-border p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.65rem] font-bold uppercase tracking-widest">Volume</span>
        <Badge
          className={cn("h-[18px] text-[0.6rem] font-semibold")}
          style={vol.status === "Normal" ? { backgroundColor: "var(--secondary)", color: "var(--secondary-foreground)" } : signalStyle("hold")}
        >
          {vol.status}
        </Badge>
      </div>
      <div className="flex flex-col gap-0.25">
        <Row label="Last" value={fmtPrice(vol.last_volume, ticker)} />
        <Row label="Avg 20d" value={fmtPrice(vol.avg_vol_20, ticker)} />
        <Row label="Ratio (vs 20d)" value={vol.volume_ratio_vs_20.toFixed(2)} color={vol.volume_ratio_vs_20 > 1 ? "text-strong-buy" : "text-hold"} />
        <Row label="Up/Down 10d" value={`${vol.up_down_ratio_10d.toFixed(2)}x`} color={vol.up_down_ratio_10d > 1 ? "text-strong-buy" : "text-strong-sell"} />
      </div>
    </div>
  );
}

function Row({ label, value, color, icon }: { label: string; value: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-[0.65rem] text-muted-foreground">{label}</span>
      <span className={cn("inline-flex items-center gap-1 text-[0.65rem] font-semibold text-foreground", color)}>
        {icon}
        {value}
      </span>
    </div>
  );
}

function EvidenceChips({ items, color }: { items: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5">
      {items.map((item, i) => (
        <Tooltip key={i}>
          <TooltipTrigger>
            <Badge
              variant="outline"
              className="cursor-pointer text-[0.65rem] font-medium"
              style={{ borderColor: color, color }}
            >
              {item}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{item}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ─── Main Component ───

export default function IndicatorDashboard({ indicators, trend, evidence, price, ticker, signal }: Props) {
  const hasField = (obj: unknown, field: string): boolean =>
    obj != null && typeof obj === "object" && field in obj && (obj as Record<string, unknown>)[field] != null;

  const rsi = hasField(indicators.rsi, "value") ? indicators.rsi as RsiData : null;
  const macd = hasField(indicators.macd, "crossover") ? indicators.macd as MacdData : null;
  const adx = hasField(indicators.adx, "adx") ? indicators.adx as AdxData : null;
  const atrData = hasField(indicators.atr, "percent_of_price") ? indicators.atr as AtrData : null;
  const vol = hasField(indicators.volume, "last_volume") ? indicators.volume as VolumeData : null;
  const ma = (trend?.ma && hasField(trend.ma, "sma20")) ? trend.ma as MaData : null;

  const signalColor = signal === "BUY" ? "bg-strong-buy" : signal === "SELL" ? "bg-strong-sell" : "bg-hold";

  return (
    <TooltipProvider>
      <div>
        {/* Top row: Signal badge + key metrics */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge className={cn("text-[0.7rem] font-bold")} style={signalStyle(signal === "BUY" ? "strongBuy" : signal === "SELL" ? "strongSell" : "hold")}>
            Overall: {signal}
          </Badge>
          {rsi?.value != null && (
            <Badge
              className={cn("text-[0.65rem] font-semibold")}
              style={signalStyle(rsi.overbought ? "strongSell" : "strongBuy")}
            >
              RSI {Number(rsi.value).toFixed(0)}
            </Badge>
          )}
          {adx?.adx != null && (
            <Badge className="bg-secondary text-[0.65rem] font-semibold text-secondary-foreground">
              ADX {Number(adx.adx).toFixed(0)}
            </Badge>
          )}
          {macd?.crossover != null && (
            <Badge
              className={cn("text-[0.65rem] font-semibold")}
              style={signalStyle(macd.crossover === "Bullish" ? "strongBuy" : "strongSell")}
            >
              MACD {macd.crossover}
            </Badge>
          )}
          {ma?.above_20 != null && (
            <Badge
              className={cn("text-[0.65rem] font-semibold")}
              style={signalStyle(ma.above_20 ? "strongBuy" : "strongSell")}
            >
              Price {ma.above_20 ? "Above" : "Below"} SMA20
            </Badge>
          )}
          {atrData?.percent_of_price != null && (
            <Badge variant="outline" className="text-[0.65rem] font-semibold">
              ATR {Number(atrData.percent_of_price).toFixed(1)}%
            </Badge>
          )}
        </div>

        {/* Main grid: Indicator blocks */}
        <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-4">
          {rsi && <RsiGauge rsi={rsi} />}
          {macd && <MacdBlock macd={macd} />}
          {adx && <AdxBlock adx={adx} />}
          {ma && <MaBlock ma={ma} price={price} ticker={ticker} />}
          {vol && <VolumeBlock vol={vol} ticker={ticker} />}
        </div>

        {/* Evidence chips */}
        {evidence && (evidence.technical.length > 0 || evidence.fundamental.length > 0) && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {evidence.technical.length > 0 && (
              <div>
                <span className="mb-0.75 block text-[0.6rem] font-semibold uppercase tracking-widest text-strong-buy">
                  Technical Evidence
                </span>
                <EvidenceChips items={evidence.technical} color={signalHex("strongBuy")} />
              </div>
            )}
            {evidence.fundamental.length > 0 && (
              <div>
                <span className="mb-0.75 block text-[0.6rem] font-semibold uppercase tracking-widest text-hold">
                  Fundamental Evidence
                </span>
                <EvidenceChips items={evidence.fundamental} color={signalHex("hold")} />
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
