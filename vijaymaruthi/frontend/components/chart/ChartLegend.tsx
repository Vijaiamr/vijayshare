"use client";

// TradingView-style OHLC legend readout. Shows the hovered bar's open/high/
// low/close + change% (or the last bar when the crosshair is idle).

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface LegendOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  ticker: string;
  intervalLabel: string;
  ohlc: LegendOhlc | null;
  changePct: number | null;
  isDark: boolean;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function ChartLegend({ ticker, intervalLabel, ohlc, changePct, isDark }: Props) {
  const changeColor = useMemo(() => {
    if (changePct == null) return isDark ? "#a1a1aa" : "#52525b";
    return changePct >= 0 ? "#0bbd8a" : "#f04e4e";
  }, [changePct, isDark]);

  const up = ohlc ? ohlc.close >= ohlc.open : false;

  return (
    <div className="pointer-events-none flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.7rem] font-medium tabular-nums">
      <span className="font-bold text-foreground">{ticker}</span>
      <span className="rounded bg-muted px-1 py-px text-[0.6rem] text-muted-foreground">{intervalLabel}</span>
      <span className={cn("font-semibold", up ? "text-[#0bbd8a]" : "text-[#f04e4e]")}>
        O {fmt(ohlc?.open)}
      </span>
      <span className={cn("font-semibold", up ? "text-[#0bbd8a]" : "text-[#f04e4e]")}>
        H {fmt(ohlc?.high)}
      </span>
      <span className={cn("font-semibold", up ? "text-[#0bbd8a]" : "text-[#f04e4e]")}>
        L {fmt(ohlc?.low)}
      </span>
      <span className={cn("font-semibold", up ? "text-[#0bbd8a]" : "text-[#f04e4e]")}>
        C {fmt(ohlc?.close)}
      </span>
      <span className="text-muted-foreground">Vol {fmt(ohlc?.volume, 0)}</span>
      {changePct != null && (
        <span className="font-semibold" style={{ color: changeColor }}>
          {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
}