import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/attribution
 *
 * Last-touch attribution: for every conversion event, credit the source /
 * medium / campaign of the session it happened in. Returns the share of
 * conversions and revenue per channel. Honors the global filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [sessionsRes, eventsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("id,source,medium,campaign"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("session_id,metadata"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ).eq("event_name", "conversion"),
  ]);

  const sessionChannel = new Map<string, { source: string | null; medium: string | null; campaign: string | null }>();
  for (const s of sessionsRes.data ?? []) {
    sessionChannel.set(s.id, { source: s.source, medium: s.medium, campaign: s.campaign });
  }

  const channels = new Map<string, {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    conversions: number;
    revenue: number;
  }>();

  for (const e of eventsRes.data ?? []) {
    const ch = sessionChannel.get(e.session_id) ?? { source: null, medium: null, campaign: null };
    const k = `${ch.source ?? "direct"}|${ch.medium ?? "none"}|${ch.campaign ?? ""}`;
    const cur = channels.get(k) ?? { ...ch, conversions: 0, revenue: 0 };
    cur.conversions += 1;
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const v = typeof meta.value === "number" ? meta.value : Number(meta.value ?? 0);
    if (Number.isFinite(v)) cur.revenue += v;
    channels.set(k, cur);
  }

  const totalConversions = [...channels.values()].reduce((s, c) => s + c.conversions, 0);
  const totalRevenue = [...channels.values()].reduce((s, c) => s + c.revenue, 0);

  const rows = [...channels.values()]
    .map((c) => ({
      ...c,
      share: totalConversions > 0 ? c.conversions / totalConversions : 0,
      revenueShare: totalRevenue > 0 ? c.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => b.conversions - a.conversions);

  return NextResponse.json({ days: q.days, totalConversions, totalRevenue, rows });
}