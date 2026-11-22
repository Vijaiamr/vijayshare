import { NextResponse } from "next/server";
import { requireAnalytics, minutesAgo, num } from "@/lib/analytics/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/realtime
 *
 * Live activity for the real-time dashboard:
 *   • onlineNow  — sessions with activity in the last 5 minutes
 *   • last30m    — event counts per minute (page_view + all events)
 *   • topPages   — pages with activity in the last 30 minutes
 *   • topSources — sources with activity in the last 30 minutes
 */
export async function GET() {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;

  const onlineSince = minutesAgo(5);
  const windowSince = minutesAgo(30);

  const [onlineRes, eventsRes, pagesRes, sourcesRes] = await Promise.all([
    ctx.service
      .from("analytics_sessions")
      .select("id,user_id,anonymous_id,page_views,country,source,medium")
      .gte("last_seen_at", onlineSince)
      .order("last_seen_at", { ascending: false })
      .limit(50),
    ctx.service
      .from("analytics_events")
      .select("event_name,events_at")
      .gte("events_at", windowSince),
    ctx.service
      .from("analytics_events")
      .select("page_path")
      .eq("event_name", "page_view")
      .gte("events_at", windowSince),
    ctx.service
      .from("analytics_events")
      .select("source,medium")
      .eq("event_name", "page_view")
      .gte("events_at", windowSince),
  ]);

  const online = (onlineRes.data ?? []).map((s) => ({
    id: s.id,
    user_id: s.user_id,
    anonymous_id: s.anonymous_id,
    page_views: num(s.page_views),
    country: s.country,
    source: s.source,
    medium: s.medium,
  }));

  // Per-minute buckets for the last 30 minutes.
  const buckets: { minute: string; pageviews: number; events: number }[] = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const t = new Date(now - i * 60_000);
    buckets.push({
      minute: t.toISOString().slice(11, 16),
      pageviews: 0,
      events: 0,
    });
  }
  const pageIdx = new Map(buckets.map((b, i) => [b.minute, i]));
  for (const r of eventsRes.data ?? []) {
    const key = String(r.events_at).slice(11, 16);
    const i = pageIdx.get(key);
    if (i !== undefined) {
      buckets[i].events += 1;
      if (r.event_name === "page_view") buckets[i].pageviews += 1;
    }
  }

  const pageCount = new Map<string, number>();
  for (const r of pagesRes.data ?? []) {
    const p = r.page_path ?? "(unknown)";
    pageCount.set(p, (pageCount.get(p) ?? 0) + 1);
  }
  const topPages = [...pageCount.entries()]
    .map(([page, count]) => ({ page, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const sourceCount = new Map<string, number>();
  for (const r of sourcesRes.data ?? []) {
    const key = `${r.source ?? "direct"} / ${r.medium ?? "none"}`;
    sourceCount.set(key, (sourceCount.get(key) ?? 0) + 1);
  }
  const topSources = [...sourceCount.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return NextResponse.json({
    onlineNow: online.length,
    online,
    buckets,
    topPages,
    topSources,
  });
}