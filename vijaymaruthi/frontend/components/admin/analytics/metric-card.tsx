"use client";

/**
 * components/admin/analytics/metric-card.tsx
 * KPI card with previous-period delta, trend indicator, sparkline and a
 * formula tooltip (metric definition layer).
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";
import { MetricDefinition } from "@/lib/analytics/metrics";

export function TrendIndicator({
  delta,
  goodWhenUp = true,
  className,
}: {
  /** Percentage change vs comparison period (e.g. 14.2). Null = no comparison. */
  delta: number | null;
  goodWhenUp?: boolean;
  className?: string;
}) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }
  const flat = Math.abs(delta) < 0.05;
  const up = delta > 0;
  const positive = flat ? true : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        flat ? "text-muted-foreground" : positive ? "text-success" : "text-danger",
        className,
      )}
      aria-label={`${up ? "up" : "down"} ${Math.abs(delta).toFixed(1)}% vs previous period`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  goodWhenUp = true,
  sparkline,
  compareSparkline,
  definition,
  sub,
  href,
  className,
}: {
  label: string;
  value: string;
  delta?: number | null;
  goodWhenUp?: boolean;
  sparkline?: number[];
  compareSparkline?: number[];
  definition?: MetricDefinition;
  sub?: string;
  href?: string;
  className?: string;
}) {
  const [showTip, setShowTip] = React.useState(false);
  const inner = (
    <div
      className={cn(
        "relative rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary/30",
        href && "hover:border-primary/50 hover:bg-muted/40",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        {definition && (
          <button
            type="button"
            className="text-muted-foreground/60 transition-colors hover:text-foreground"
            aria-label={`${label} definition`}
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onFocus={() => setShowTip(true)}
            onBlur={() => setShowTip(false)}
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
        {delta !== undefined && delta !== null && (
          <TrendIndicator delta={delta} goodWhenUp={goodWhenUp} />
        )}
      </div>

      {sub && <p className="mt-1 text-[0.68rem] text-muted-foreground">{sub}</p>}

      {sparkline && sparkline.length > 1 && (
        <div className="mt-3">
          <Sparkline values={sparkline} compare={compareSparkline} width={140} height={34} />
        </div>
      )}

      {showTip && definition && (
        <div
          role="tooltip"
          className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
        >
          <p className="font-medium">{definition.label}</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">{definition.formula}</p>
        </div>
      )}
    </div>
  );
  if (!href) return inner;
  return (
    <Link href={href} className="block" aria-label={`${label} — open drill-down`}>
      {inner}
    </Link>
  );
}