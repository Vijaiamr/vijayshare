"use client";

/**
 * app/(app)/admin/analytics/page.tsx
 *
 * §59 — Behavior page: engagement trend, new vs returning, top pages,
 * top users, traffic sources. Honors the global filters via URL.
 */

import * as React from "react";
import { AnalyticsFilterProvider, useAnalyticsFilters } from "@/components/admin/analytics/filter-context";
import { AnalyticsHeader } from "@/components/admin/analytics/header";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";
import { LoadingSkeleton, ErrorState, SectionTitle } from "@/components/admin/analytics/states";
import { MetricCard } from "@/components/admin/analytics/metric-card";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { METRIC_DEFINITIONS } from "@/lib/analytics/metrics";
import { buildQuery } from "@/lib/analytics/filters";
import { Globe, Monitor, Smartphone, Tablet, ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";

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
  deltas: Record<string, number | null> | null;
  retention: number | null;
  series: { day: string; pageviews: number }[];
}

interface PageRow {
  page: string;
  pageviews: number;
  visitors: number;
  avgSeconds: number;
}

interface UserRow {
  user_id: string | null;
  email: string | null;
  anonymous_id: string | null;
  sessions: number;
  pageviews: number;
  activeSeconds: number;
  conversions: number;
  conversionValue: number;
  lastSeen: string | null;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function fmtDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

/* ─── Page ──────────────────────────────────────────────────────────── */

function BehaviorInner() {
  const { filters, days } = useAnalyticsFilters();

  const [overview, setOverview] = React.useState<OverviewData | null>(null);
  const [pages, setPages] = React.useState<PageRow[]>([]);
  const [users, setUsers] = React.useState<UserRow[]>([]);
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
        const suffix = qs ? `?${qs}` : "";
        const [ovRes, pgRes, usRes] = await Promise.all([
          fetch(`/api/admin/analytics/overview${suffix}`, { signal }),
          fetch(`/api/admin/analytics/top-pages${suffix}`, { signal }),
          fetch(`/api/admin/analytics/top-users${suffix}`, { signal }),
        ]);
        if (!ovRes.ok || !pgRes.ok || !usRes.ok) throw new Error("One or more requests failed");
        const [ov, pg, us] = await Promise.all([ovRes.json(), pgRes.json(), usRes.json()]);
        setOverview(ov);
        setPages(pg.rows ?? []);
        setUsers(us.rows ?? []);
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

  const k = overview?.kpis;
  const d = overview?.deltas;

  /* Page columns */
  const pageCols: Column<PageRow>[] = [
    { key: "page", header: "Page", cell: (r) => <code className="text-xs">{r.page}</code> },
    { key: "pageviews", header: "Views", sortValue: (r) => r.pageviews, align: "right", cell: (r) => <span className="tabular-nums">{r.pageviews.toLocaleString()}</span> },
    { key: "visitors", header: "Visitors", sortValue: (r) => r.visitors, align: "right", cell: (r) => <span className="tabular-nums">{r.visitors.toLocaleString()}</span>, hideBelow: "sm" },
    { key: "avgSeconds", header: "Avg Time", sortValue: (r) => r.avgSeconds, align: "right", cell: (r) => <span className="tabular-nums">{fmtDuration(r.avgSeconds)}</span>, hideBelow: "md" },
  ];

  /* User columns */
  const userCols: Column<UserRow>[] = [
    {
      key: "user",
      header: "User",
      cell: (r) => {
        const label = r.email ?? r.anonymous_id ?? "anonymous";
        if (r.user_id) {
          return (
            <Link href={`/admin/analytics/users/${r.user_id}`} className="inline-flex items-center gap-1 hover:underline">
              {label}
              <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
            </Link>
          );
        }
        return <span>{label}</span>;
      },
    },
    { key: "sessions", header: "Sessions", sortValue: (r) => r.sessions, align: "right", cell: (r) => <span className="tabular-nums">{r.sessions}</span> },
    { key: "pageviews", header: "Pageviews", sortValue: (r) => r.pageviews, align: "right", cell: (r) => <span className="tabular-nums">{r.pageviews.toLocaleString()}</span>, hideBelow: "sm" },
    { key: "activeSeconds", header: "Active", sortValue: (r) => r.activeSeconds, align: "right", cell: (r) => <span className="tabular-nums">{fmtDuration(r.activeSeconds)}</span>, hideBelow: "md" },
    { key: "conversions", header: "Conv.", sortValue: (r) => r.conversions, align: "right", cell: (r) => <span className="tabular-nums text-success">{r.conversions}</span> },
    { key: "lastSeen", header: "Last Seen", sortValue: (r) => r.lastSeen ?? "", cell: (r) => <span className="text-muted-foreground">{r.lastSeen ? new Date(r.lastSeen).toLocaleDateString() : "—"}</span>, hideBelow: "lg" },
  ];

  return (
    <div className="space-y-6">
      <AnalyticsHeader
        title="Behavior"
        description="How users engage with your product — pages, sessions, traffic sources"
        onRefresh={() => fetchData(undefined, true)}
        refreshing={refreshing}
        live
      />

      {error && <ErrorState message={error} onRetry={() => fetchData()} />}
      {loading && !overview && <LoadingSkeleton rows={6} />}

      {k && (
        <>
          {/* ── KPI Row ──────────────────────────────────────────── */}
          <section aria-label="Engagement KPIs">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              <MetricCard
                label="Engagement Rate"
                value={`${(k.engagementRate * 100).toFixed(1)}%`}
                delta={d?.engagementRate}
                goodWhenUp
                definition={METRIC_DEFINITIONS.engagementRate}
              />
              <MetricCard
                label="Bounce Rate"
                value={`${(k.bounceRate * 100).toFixed(1)}%`}
                delta={d?.bounceRate}
                goodWhenUp={false}
                definition={METRIC_DEFINITIONS.bounceRate}
              />
              <MetricCard
                label="Avg Session"
                value={fmtDuration(k.avgSessionSeconds)}
                delta={d?.avgSessionSeconds}
                goodWhenUp
                definition={METRIC_DEFINITIONS.avgSessionSeconds}
              />
              <MetricCard
                label="Pageviews"
                value={k.pageviews.toLocaleString()}
                delta={d?.pageviews}
                goodWhenUp
                definition={METRIC_DEFINITIONS.pageviews}
                sparkline={overview?.series.map((s) => s.pageviews)}
              />
              <MetricCard
                label="Unique Visitors"
                value={k.uniqueVisitors.toLocaleString()}
                delta={d?.uniqueVisitors}
                goodWhenUp
                definition={METRIC_DEFINITIONS.uniqueVisitors}
                href="/admin/analytics/visitors"
              />
              <MetricCard
                label="Conversions"
                value={k.conversions.toLocaleString()}
                delta={d?.conversions}
                goodWhenUp
                definition={METRIC_DEFINITIONS.conversions}
              />
            </div>
          </section>

          {/* ── Engagement Trend ──────────────────────────────────── */}
          <section aria-label="Engagement trend" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="Engagement Trend" description="Daily pageviews over the selected period" />
            <div className="mt-3">
              {overview?.series && overview.series.some((s) => s.pageviews > 0) ? (
                <TrendChart series={overview.series} label="pageviews" />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No data for this period.</p>
              )}
            </div>
          </section>

          {/* ── New vs Returning ──────────────────────────────────── */}
          {overview?.retention !== null && overview?.retention !== undefined && (
            <section aria-label="New vs returning visitors" className="rounded-xl border border-border bg-surface p-4">
              <SectionTitle
                title="Returning Visitors"
                description={`Share of visitors who were also active in the previous ${days}-day window`}
              />
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-3xl font-bold tabular-nums text-foreground">{(overview.retention * 100).toFixed(1)}%</span>
                <span className="text-sm text-muted-foreground">of visitors came back</span>
              </div>
            </section>
          )}

          {/* ── Top Pages ──────────────────────────────────────────── */}
          <section aria-label="Top pages">
            <SectionTitle title="Top Pages" />
            <DataTable
              columns={pageCols}
              rows={pages}
              rowKey={(r) => r.page as string}
              pageSize={10}
              initialSort={{ key: "pageviews", dir: "desc" }}
              exportFilename={`top-pages-${days}d`}
              emptyMessage="No page data for the current filters."
            />
          </section>

          {/* ── Top Users ──────────────────────────────────────────── */}
          <section aria-label="Top users">
            <SectionTitle title="Top Users" />
            <DataTable
              columns={userCols}
              rows={users}
              rowKey={(r) => (r.user_id ?? r.anonymous_id ?? Math.random()) as string}
              pageSize={10}
              initialSort={{ key: "activeSeconds", dir: "desc" }}
              exportFilename={`top-users-${days}d`}
              emptyMessage="No user data for the current filters."
            />
          </section>

          {/* ── Traffic Sources (summary) ────────────────────────── */}
          <section aria-label="Traffic sources summary" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle
              title="Traffic Sources"
              description="Detailed device, browser and geo breakdowns live in the tabs above — use the filters to slice by any dimension"
            />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: Smartphone, label: "Mobile", hint: "Phones & small screens" },
                { icon: Tablet, label: "Tablet", hint: "Tablets & iPads" },
                { icon: Monitor, label: "Desktop", hint: "Laptops & desktops" },
                { icon: Globe, label: "Geo", hint: "Country & region" },
              ].map(({ icon: Icon, label, hint }) => (
                <div key={label} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface/60 p-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="text-xs font-medium text-foreground">{label}</p>
                    <p className="text-[0.65rem] text-muted-foreground">{hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── AI Insight (placeholder) ────────────────────────── */}
          <section aria-label="AI insight" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="AI Insight" description="Automated pattern detection — coming soon" />
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-info/30 bg-info/5 p-4">
              <Sparkles className="h-5 w-5 shrink-0 text-info" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Once connected, this panel will summarize what changed, flag anomalies, and suggest what to look at next.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function BehaviorPage() {
  return (
    <AnalyticsFilterProvider>
      <BehaviorInner />
    </AnalyticsFilterProvider>
  );
}