import { NextResponse } from "next/server";
import { requireAnalytics, num } from "@/lib/analytics/admin";
import { buildJourney, type JourneyEvent, type JourneySessionMeta } from "@/lib/analytics/journey";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/sessions/[id]
 *
 * Session Journey drill-down: session metadata, the complete human-readable
 * journey (timeline, screens, path, scroll, actions, summary, stats,
 * entry/exit, event log) and comparison sessions from the same visitor.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const { id } = await params;

  const [sessionRes, eventsRes] = await Promise.all([
    ctx.service.from("analytics_sessions").select("*").eq("id", id).maybeSingle(),
    ctx.service
      .from("analytics_events")
      .select("id,event_name,page_path,events_at,metadata,referrer")
      .eq("session_id", id)
      .order("events_at", { ascending: true }),
  ]);

  if (!sessionRes.data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const s = sessionRes.data as any;
  const events = (eventsRes.data ?? []) as any[];

  const sessionMeta: JourneySessionMeta = {
    id: s.id,
    user_id: s.user_id ?? null,
    anonymous_id: s.anonymous_id ?? null,
    started_at: s.started_at,
    last_seen_at: s.last_seen_at,
    entry_page: s.entry_page ?? null,
    exit_page: s.exit_page ?? null,
    source: s.source ?? null,
    medium: s.medium ?? null,
    campaign: s.campaign ?? null,
    device: s.device ?? null,
    browser: s.browser ?? null,
    os: s.os ?? null,
    country: s.country ?? null,
    page_views: num(s.page_views),
    active_seconds: num(s.active_seconds),
    conversions: num(s.conversions),
    conversion_value: num(s.conversion_value),
  };

  const journeyEvents: JourneyEvent[] = events.map((e) => ({
    id: e.id,
    event_name: e.event_name,
    page_path: e.page_path,
    events_at: e.events_at,
    metadata: e.metadata ?? {},
    referrer: e.referrer ?? null,
  }));

  const journey = buildJourney(sessionMeta, journeyEvents);

  // Comparison: other sessions from the same visitor (identified or anonymous).
  let comparison: any[] = [];
  if (sessionMeta.user_id || sessionMeta.anonymous_id) {
    let q = ctx.service
      .from("analytics_sessions")
      .select("id,started_at,last_seen_at,entry_page,exit_page,source,medium,campaign,device,browser,country,page_views,active_seconds,conversions,conversion_value")
      .neq("id", id)
      .order("started_at", { ascending: false })
      .limit(6);
    if (sessionMeta.user_id) {
      q = q.eq("user_id", sessionMeta.user_id);
    } else {
      q = q.eq("anonymous_id", sessionMeta.anonymous_id);
    }
    const cmp = await q;
    comparison = (cmp.data ?? []).map((c: any) => ({
      id: c.id,
      started_at: c.started_at,
      last_seen_at: c.last_seen_at,
      entry_page: c.entry_page,
      exit_page: c.exit_page,
      source: c.source,
      medium: c.medium,
      campaign: c.campaign,
      device: c.device,
      browser: c.browser,
      country: c.country,
      page_views: num(c.page_views),
      active_seconds: num(c.active_seconds),
      conversions: num(c.conversions),
      conversion_value: num(c.conversion_value),
    }));
  }

  return NextResponse.json({
    session: sessionMeta,
    journey,
    comparison,
  });
}