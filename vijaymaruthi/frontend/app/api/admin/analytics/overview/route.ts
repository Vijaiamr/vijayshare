import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import {
  computePeriodData,
  fetchPriorAnonIds,
  fetchActiveAnonIds,
  applyDimensionFilters,
  pctChange,
} from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/overview
 *
 * Executive KPIs + daily timeseries, honoring the global filters
 * (range, comparison, segment, device, browser, source).
 *
 * Response:
 *   kpis        — primary period KPIs
 *   comparison  — previous-period KPIs (null when compare=none)
 *   deltas      — % change per KPI (null when not comparable)
 *   series      — daily pageview series for the primary period
 *   retention   — % of period visitors also active in the previous period
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [priorAnonIds, primary, comparison] = await Promise.all([
    fetchPriorAnonIds(ctx.service, q.start),
    computePeriodData(ctx.service, q.filters, q.start, q.end, new Set()),
    q.compareStart && q.compareEnd
      ? computePeriodData(ctx.service, q.filters, q.compareStart, q.compareEnd, new Set())
      : Promise.resolve(null),
  ]);

  // Recompute primary with the real prior set (new/returning segments).
  const kpis =
    q.filters.segment === "new" || q.filters.segment === "returning"
      ? await computePeriodData(ctx.service, q.filters, q.start, q.end, priorAnonIds)
      : primary;

  // Retention: period visitors also active in the previous period.
  let retention: number | null = null;
  if (comparison && kpis.uniqueVisitors > 0) {
    const prevActive = await fetchActiveAnonIds(ctx.service, q.filters, q.compareStart!, q.compareEnd!);
    const retained = kpis.sessions.filter(
      (s) => s.anonymous_id && prevActive.has(s.anonymous_id),
    ).length;
    retention = retained / kpis.uniqueVisitors;
  }

  // Daily series from raw page_view events (works before the rollup cron runs).
  const dailyMap = new Map<string, number>();
  {
    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const qb = ctx.service
        .from("analytics_events")
        .select("events_at")
        .eq("event_name", "page_view")
        .range(from, from + pageSize - 1);
      const q2 = applyDimensionFilters(qb, q.filters, "events_at", q.start, q.end);
      const { data } = await q2;
      const rows = data ?? [];
      for (const r of rows) {
        const key = String(r.events_at).slice(0, 10);
        dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  const series: { day: string; pageviews: number }[] = [];
  for (let i = q.days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, pageviews: dailyMap.get(key) ?? 0 });
  }

  const kpiShape = (p: typeof kpis) => ({
    sessions: p.sessionCount,
    pageviews: p.pageviews,
    uniqueVisitors: p.uniqueVisitors,
    activeUsers: p.activeUsers,
    conversions: p.conversions,
    revenue: Math.round(p.revenue),
    conversionRate: p.conversionRate,
    avgSessionSeconds: Math.round(p.avgSessionSeconds),
    bounceRate: p.bounceRate,
    engagementRate: p.engagementRate,
    revenuePerUser: Math.round(p.revenuePerUser),
    errors: p.errors,
  });

  const k = kpiShape(kpis);
  const c = comparison ? kpiShape(comparison) : null;

  const deltas = c
    ? {
        sessions: pctChange(k.sessions, c.sessions),
        pageviews: pctChange(k.pageviews, c.pageviews),
        uniqueVisitors: pctChange(k.uniqueVisitors, c.uniqueVisitors),
        activeUsers: pctChange(k.activeUsers, c.activeUsers),
        conversions: pctChange(k.conversions, c.conversions),
        revenue: pctChange(k.revenue, c.revenue),
        conversionRate: pctChange(k.conversionRate, c.conversionRate),
        avgSessionSeconds: pctChange(k.avgSessionSeconds, c.avgSessionSeconds),
        bounceRate: pctChange(k.bounceRate, c.bounceRate),
        engagementRate: pctChange(k.engagementRate, c.engagementRate),
        revenuePerUser: pctChange(k.revenuePerUser, c.revenuePerUser),
        errors: pctChange(k.errors, c.errors),
      }
    : null;

  return NextResponse.json({
    days: q.days,
    kpis: k,
    comparison: c,
    deltas,
    retention,
    series,
  });
}