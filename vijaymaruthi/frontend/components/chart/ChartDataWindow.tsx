"use client";

// Data window — TradingView-style crosshair readout bar. Shows OHLCV at the
// crosshair position (or the last candle when the crosshair is idle).

import type { DataWindowRow } from "./types";

interface Props {
  rows: DataWindowRow[];
}

export default function ChartDataWindow({ rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/60 bg-background/80 px-2 py-1 text-[0.65rem] tabular-nums text-muted-foreground">
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-1">
          <span className="font-medium">{r.label}</span>
          <span style={r.color ? { color: r.color } : undefined}>{r.value}</span>
        </span>
      ))}
    </div>
  );
}