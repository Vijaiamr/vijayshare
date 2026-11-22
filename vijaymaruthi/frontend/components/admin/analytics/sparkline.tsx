"use client";

/**
 * components/admin/analytics/sparkline.tsx
 * Lightweight inline SVG sparkline (area + line) with optional comparison
 * overlay. No chart library dependency — fast for KPI rows.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  compare,
  width = 120,
  height = 36,
  className,
  stroke = "var(--primary)",
  compareStroke = "var(--muted-foreground)",
}: {
  values: number[];
  compare?: number[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
  compareStroke?: string;
}) {
  const id = React.useId();
  if (!values.length) {
    return <div className={cn("h-[36px] w-[120px] rounded bg-muted/60", className)} aria-hidden />;
  }

  const max = Math.max(1, ...values, ...(compare ?? []));
  const min = Math.min(0, ...values, ...(compare ?? []));
  const range = max - min || 1;
  const pad = 2;

  const toPoints = (data: number[]) =>
    data
      .map((v, i) => {
        const x = pad + (i / Math.max(1, data.length - 1)) * (width - pad * 2);
        const y = height - pad - ((v - min) / range) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const line = toPoints(values);
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label="Trend sparkline"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {compare && compare.length > 1 && (
        <polyline
          points={toPoints(compare)}
          fill="none"
          stroke={compareStroke}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.6"
        />
      )}
      <polygon points={area} fill={`url(#spark-${id})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}