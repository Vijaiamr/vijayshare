"use client";

/**
 * components/admin/analytics/trend-chart.tsx
 *
 * Human-readable trend chart — gradient area + line with a summary row
 * (total / average / peak) and date labels. No chart library needed.
 */

import * as React from "react";

export function TrendChart({
  series,
  height = 160,
  color = "hsl(var(--primary))",
  label = "pageviews",
}: {
  series: { day: string; pageviews: number }[];
  height?: number;
  color?: string;
  label?: string;
}) {
  const gradId = React.useId().replace(/:/g, "");
  if (!series || series.length === 0) return null;

  const values = series.map((s) => s.pageviews);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = Math.round(total / values.length);
  const peak = Math.max(...values);
  const peakDay = series[values.indexOf(peak)]?.day ?? "";

  const W = 600;
  const H = 160;
  const pad = 6;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const step = innerW / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - (v / max) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${H} ${pts.join(" ")} ${W},${H}`;

  const fmtDay = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const first = series[0]?.day;
  const mid = series[Math.floor(series.length / 2)]?.day;
  const last = series[series.length - 1]?.day;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Total{" "}
          <strong className="font-semibold tabular-nums text-foreground">{total.toLocaleString()}</strong>
        </span>
        <span>
          Avg / day{" "}
          <strong className="font-semibold tabular-nums text-foreground">{avg.toLocaleString()}</strong>
        </span>
        <span>
          Peak{" "}
          <strong className="font-semibold tabular-nums text-foreground">{peak.toLocaleString()}</strong>
          {peakDay && <span className="text-muted-foreground/70"> · {fmtDay(peakDay)}</span>}
        </span>
      </div>
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} trend`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradId})`} />
          <polyline
            points={pts.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[0.65rem] text-muted-foreground">
        <span>{fmtDay(first)}</span>
        <span>{fmtDay(mid)}</span>
        <span>{fmtDay(last)}</span>
      </div>
    </div>
  );
}