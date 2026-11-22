import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/journeys?limit=25
 *
 * Recent user journeys: for each session, the ordered page path sequence
 * (from page_view events) plus entry/exit, source, and duration. Used by the
 * journey-map view to reconstruct the path a visitor took. Honors the global
 * filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "25", 10) || 25));

  const [sessionsRes, eventsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("id,user_id,anonymous_id,started_at,last_seen_at,entry_page,exit_page,source,medium,campaign,page_views,active_seconds,conversions"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    )
      .order("started_at", { ascending: false })
      .limit(limit),
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("session_id,page_path,events_at")
        .eq("event_name", "page_view"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ).order("events_at", { ascending: true }),
  ]);

  const pathBySession = new Map<string, string[]>();
  for (const e of eventsRes.data ?? []) {
    if (!e.session_id || !e.page_path) continue;
    if (!pathBySession.has(e.session_id)) pathBySession.set(e.session_id, []);
    pathBySession.get(e.session_id)!.push(e.page_path);
  }

  const journeys = ((sessionsRes.data ?? []) as any[]).map((s) => ({
    id: s.id,
    user_id: s.user_id,
    anonymous_id: s.anonymous_id,
    started_at: s.started_at,
    last_seen_at: s.last_seen_at,
    entry_page: s.entry_page,
    exit_page: s.exit_page,
    source: s.source,
    medium: s.medium,
    campaign: s.campaign,
    page_views: num(s.page_views),
    active_seconds: num(s.active_seconds),
    conversions: num(s.conversions),
    path: pathBySession.get(s.id) ?? [],
  }));

  return NextResponse.json({ days: q.days, journeys });
}