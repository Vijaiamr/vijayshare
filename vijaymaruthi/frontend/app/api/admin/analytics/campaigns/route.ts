import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/campaigns
 *
 * Campaign performance grouped by source / medium / campaign:
 * sessions, pageviews, conversions, conversion rate, and revenue
 * (sum of conversion metadata.value). Honors the global filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [sessionsRes, eventsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("source,medium,campaign,page_views,conversions"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("source,medium,campaign,event_name,metadata"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ).eq("event_name", "conversion"),
  ]);

  const groups = new Map<string, {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    sessions: number;
    pageviews: number;
    conversions: number;
    revenue: number;
  }>();

  const keyOf = (s: string | null, m: string | null, c: string | null) =>
    `${s ?? "direct"}|${m ?? "none"}|${c ?? ""}`;

  for (const r of sessionsRes.data ?? []) {
    const k = keyOf(r.source, r.medium, r.campaign);
    const cur = groups.get(k) ?? {
      source: r.source ?? null,
      medium: r.medium ?? null,
      campaign: r.campaign ?? null,
      sessions: 0,
      pageviews: 0,
      conversions: 0,
      revenue: 0,
    };
    cur.sessions += 1;
    cur.pageviews += num(r.page_views);
    groups.set(k, cur);
  }

  // Conversions are counted from conversion EVENTS only (the session
  // `conversions` column is derived from the same events — adding both
  // would double-count).
  for (const r of eventsRes.data ?? []) {
    const k = keyOf(r.source, r.medium, r.campaign);
    const cur = groups.get(k) ?? {
      source: r.source ?? null,
      medium: r.medium ?? null,
      campaign: r.campaign ?? null,
      sessions: 0,
      pageviews: 0,
      conversions: 0,
      revenue: 0,
    };
    cur.conversions += 1;
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const v = typeof meta.value === "number" ? meta.value : Number(meta.value ?? 0);
    if (Number.isFinite(v)) cur.revenue += v;
    groups.set(k, cur);
  }

  const rows = [...groups.values()]
    .map((g) => ({
      ...g,
      conversionRate: g.sessions > 0 ? g.conversions / g.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return NextResponse.json({ days: q.days, rows });
}