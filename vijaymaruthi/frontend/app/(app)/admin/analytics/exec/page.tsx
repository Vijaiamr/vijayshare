"use client";

/**
 * app/(app)/admin/analytics/exec/page.tsx
 *
 * §67 — Executive dashboard. Six section groups with KPI row,
 * pageview trend, and comparison deltas honoring the global filters.
 */

import * as React from "react";
import Link from "next/link";
import { AnalyticsFilterProvider, useAnalyticsFilters } from "@/components/admin/analytics/filter-context";
import { AnalyticsHeader } from "@/components/admin/analytics/header";
import { MetricCard } from "@/components/admin/analytics/metric-card";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { LoadingSkeleton, ErrorState, SectionTitle } from "@/components/admin/analytics/states";
import { METRIC_DEFINITIONS } from "@/lib/analytics/metrics";
import { buildQuery } from "@/lib/analytics/filters";
import { AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ────────────────────────────────────────────────────────── */

interface OverviewKpis {
  sessions: number;
  pageviews: number;
  uniqueVisitors: number;
  activeUsers: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
  avgSessionSeconds: number;
  bounceRate: number;
  engagementRate: number;
  revenuePerUser: number;
  errors: number;
}

interface OverviewData {
  days: number;
  kpis: OverviewKpis;
  comparison: OverviewKpis | null;
  deltas: Record<keyof OverviewKpis, number | null> | null;
  retention: number | null;
  series: { day: string; pageviews: number }[];
}

function DeltaBadge({ delta, goodWhenUp }: { delta: number | null; goodWhenUp: boolean }) {
  if (delta === null) return <Minus className="h-3 w-3 text-muted-foreground" />;
  const positive = delta >= 0;
  const favourable = goodWhenUp ? positive : !positive;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums",
        favourable ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
      )}
    >
      {positive ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  delta,
  goodWhenUp,
  definition,
  href,
  className,
}: {
  label: string;
  value: string;
  delta: number | null;
  goodWhenUp: boolean;
  definition?: string;
  href?: string;
  className?: string;
}) {
  const inner = (
    <div className={cn("flex flex-col gap-1 rounded-xl border border-border bg-surface p-3", href && "transition-colors hover:border-primary/40 hover:bg-muted/40", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <DeltaBadge delta={delta} goodWhenUp={goodWhenUp} />
      </div>
      <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
      {definition && <span className="text-[0.62rem] leading-tight text-muted-foreground">{definition}</span>}
    </div>
  );
  if (!href) return inner;
  return (
    <Link href={href} className="block" aria-label={`${label} — open drill-down`}>
      {inner}
    </Link>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────── */

function ExecInner() {
  const { filters, days } = useAnalyticsFilters();
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchData = React.useCallback(
    async (signal?: AbortSignal, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const qs = buildQuery(filters);
        const res = await fetch(`/api/admin/analytics/overview${qs ? `?${qs}` : ""}`, { signal });
        if (!res.ok) throw new Error(`${res.status}`);
        setData(await res.json());
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters],
  );

  React.useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  const d = data?.deltas;
  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <AnalyticsHeader
        title="Executive Overview"
        description="Platform health at a glance — all metrics reflect the active filters"
        onRefresh={() => fetchData(undefined, true)}
        refreshing={refreshing}
        live
      />

      {error && <ErrorState message={error} onRetry={() => fetchData()} />}
      {loading && !data && <LoadingSkeleton rows={8} />}

      {k && (
        <>
          {/* ── KPI Row ──────────────────────────────────────────── */}
          <section aria-label="Key performance indicators">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              <KpiCard
                label="Active Users"
                value={k.activeUsers.toLocaleString()}
                delta={d?.activeUsers ?? null}
                goodWhenUp
                definition={METRIC_DEFINITIONS.activeUsers.formula}
              />
              <KpiCard
                label="Sessions"
                value={k.sessions.toLocaleString()}
                delta={d?.sessions ?? null}
                goodWhenUp
                definition={METRIC_DEFINITIONS.sessions.formula}
              />
              <KpiCard
                label="Pageviews"
                value={k.pageviews.toLocaleString()}
                delta={d?.pageviews ?? null}
                goodWhenUp
                definition={METRIC_DEFINITIONS.pageviews.formula}
              />
              <KpiCard
                label="Conversion Rate"
                value={`${(k.conversionRate * 100).toFixed(2)}%`}
                delta={d?.conversionRate ?? null}
                goodWhenUp
                definition={METRIC_DEFINITIONS.conversionRate.formula}
              />
              <KpiCard
                label="Revenue"
                value={`₹${k.revenue.toLocaleString()}`}
                delta={d?.revenue ?? null}
                goodWhenUp
                definition="Total INR revenue from conversion events"
              />
              <KpiCard
                label="Errors"
                value={k.errors.toLocaleString()}
                delta={d?.errors ?? null}
                goodWhenUp={false}
                definition="Error + api_error events"
              />
            </div>
          </section>

          {/* ── Retention ──────────────────────────────────────────── */}
          {data?.retention !== null && data?.retention !== undefined && (
            <section aria-label="User retention" className="rounded-xl border border-border bg-surface p-4">
              <SectionTitle title="Retention" />
              <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
                {(data.retention * 100).toFixed(1)}%
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                % of period visitors who were also active in the previous {days}-day window
              </p>
            </section>
          )}

          {/* ── Growth ──────────────────────────────────────────── */}
          <section aria-label="Growth metrics" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="Growth" />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KpiCard label="Unique Visitors" value={k.uniqueVisitors.toLocaleString()} delta={d?.uniqueVisitors ?? null} goodWhenUp href="/admin/analytics/visitors" />
              <KpiCard label="Conversions" value={k.conversions.toLocaleString()} delta={d?.conversions ?? null} goodWhenUp />
              <KpiCard label="Revenue / User" value={`₹${k.revenuePerUser.toLocaleString()}`} delta={d?.revenuePerUser ?? null} goodWhenUp />
            </div>
          </section>

          {/* ── Engagement ──────────────────────────────────────── */}
          <section aria-label="Engagement metrics" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="Engagement" />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KpiCard
                label="Engagement Rate"
                value={`${(k.engagementRate * 100).toFixed(1)}%`}
                delta={d?.engagementRate ?? null}
                goodWhenUp
                definition={METRIC_DEFINITIONS.engagementRate.formula}
              />
              <KpiCard
                label="Bounce Rate"
                value={`${(k.bounceRate * 100).toFixed(1)}%`}
                delta={d?.bounceRate ?? null}
                goodWhenUp={false}
                definition={METRIC_DEFINITIONS.bounceRate.formula}
              />
              <KpiCard
                label="Avg Session"
                value={formatDuration(k.avgSessionSeconds)}
                delta={d?.avgSessionSeconds ?? null}
                goodWhenUp
              />
            </div>
          </section>

          {/* ── Pageview Trend ──────────────────────────────────── */}
          <section aria-label="Pageview trend" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="Pageview Trend" description="Daily pageviews over the selected period" />
            <div className="mt-3">
              {data?.series && data.series.some((s) => s.pageviews > 0) ? (
                <TrendChart series={data.series} label="pageviews" />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No pageview data for this period.</p>
              )}
            </div>
          </section>

          {/* ── AI Insights (placeholder) ──────────────────────── */}
          <section aria-label="AI insights" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="AI Insights" />
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-info/30 bg-info/5 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-info" />
              <p className="text-sm text-muted-foreground">
                AI-powered analysis pipeline will be connected here (§73). The system will
                analyze aggregate stats, identify patterns, and generate actionable recommendations.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ExecPage() {
  return (
    <AnalyticsFilterProvider>
      <ExecInner />
    </AnalyticsFilterProvider>
  );
}