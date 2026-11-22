import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/events?limit=100&event=page_view
 *
 * Event explorer: raw event stream with optional event-name filter,
 * honoring the global filters. Returns the most recent events plus a
 * breakdown of event-name counts for the period.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const eventName = url.searchParams.get("event") ?? null;

  const [eventsRes, countsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("id,event_name,page_path,events_at,metadata,user_id,anonymous_id,session_id"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    )
      .order("events_at", { ascending: false })
      .limit(limit),
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("event_name"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ),
  ]);

  // Event-name breakdown
  const counts = new Map<string, number>();
  for (const r of countsRes.data ?? []) {
    const name = r.event_name ?? "(unknown)";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  let rows = (eventsRes.data ?? []) as any[];
  if (eventName) rows = rows.filter((r) => r.event_name === eventName);

  return NextResponse.json({
    days: q.days,
    breakdown,
    total: countsRes.count ?? breakdown.reduce((s, b) => s + b.count, 0),
    events: rows.map((e) => ({
      id: e.id,
      event_name: e.event_name,
      page_path: e.page_path,
      events_at: e.events_at,
      user_id: e.user_id,
      anonymous_id: e.anonymous_id,
      session_id: e.session_id,
      metadata: e.metadata ?? {},
    })),
  });
}