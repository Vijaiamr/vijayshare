import { NextResponse } from "next/server";
import { requireAnalytics, num } from "@/lib/analytics/admin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/analytics/users/[id]
 *
 * User profile drill-down: identity, lifetime summary, recent sessions,
 * event timeline, conversions and errors for one user (by user_id or
 * anonymous_id).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const { id } = await params;
  const limit = Math.min(100, Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "50", 10) || 50));

  // user_id is a UUID column — only include it in the OR when id is a UUID,
  // otherwise PostgREST fails to cast a non-UUID value.
  const isUuid = UUID_RE.test(id);
  const sessionFilter = isUuid
    ? `user_id.eq.${id},anonymous_id.eq.${id}`
    : `anonymous_id.eq.${id}`;
  const eventFilter = isUuid
    ? `user_id.eq.${id},anonymous_id.eq.${id}`
    : `anonymous_id.eq.${id}`;

  const [sessionsRes, eventsRes, profileRes] = await Promise.all([
    ctx.service
      .from("analytics_sessions")
      .select("id,anonymous_id,user_id,started_at,last_seen_at,entry_page,exit_page,source,medium,campaign,device,browser,country,page_views,active_seconds,conversions,conversion_value")
      .or(sessionFilter)
      .order("started_at", { ascending: false })
      .limit(limit),
    ctx.service
      .from("analytics_events")
      .select("id,event_name,page_path,events_at,metadata")
      .or(eventFilter)
      .order("events_at", { ascending: false })
      .limit(limit),
    ctx.service.from("profiles").select("id,email,role,created_at").eq("id", id).maybeSingle(),
  ]);

  const sessions = (sessionsRes.data ?? []) as any[];
  const events = (eventsRes.data ?? []) as any[];

  const summary = {
    sessions: sessions.length,
    pageviews: sessions.reduce((s, r) => s + num(r.page_views), 0),
    activeSeconds: sessions.reduce((s, r) => s + num(r.active_seconds), 0),
    conversions: sessions.reduce((s, r) => s + num(r.conversions), 0),
    revenue: sessions.reduce((s, r) => s + num(r.conversion_value), 0),
    firstSeen: sessions.length ? sessions[sessions.length - 1].started_at : null,
    lastSeen: sessions.length ? sessions[0].last_seen_at : null,
    devices: [...new Set(sessions.map((s) => s.device).filter(Boolean))],
    countries: [...new Set(sessions.map((s) => s.country).filter(Boolean))],
  };

  const conversions = events.filter((e) => e.event_name === "conversion").map((e) => ({
    at: e.events_at,
    page: e.page_path,
    goal: (e.metadata as Record<string, unknown>)?.goal ?? "conversion",
    value: num((e.metadata as Record<string, unknown>)?.value),
  }));
  const errors = events.filter((e) => e.event_name === "error" || e.event_name === "api_error").map((e) => ({
    at: e.events_at,
    page: e.page_path,
    message: (e.metadata as Record<string, unknown>)?.message ?? "unknown",
  }));

  return NextResponse.json({
    id,
    identity: {
      email: profileRes.data?.email ?? null,
      role: profileRes.data?.role ?? null,
      accountCreated: profileRes.data?.created_at ?? null,
      anonymousId: sessions.find((s) => s.anonymous_id === id)?.anonymous_id ?? null,
    },
    summary,
    sessions: sessions.map((s) => ({
      id: s.id,
      started_at: s.started_at,
      last_seen_at: s.last_seen_at,
      entry_page: s.entry_page,
      exit_page: s.exit_page,
      source: s.source,
      medium: s.medium,
      campaign: s.campaign,
      device: s.device,
      browser: s.browser,
      country: s.country,
      page_views: num(s.page_views),
      active_seconds: num(s.active_seconds),
      conversions: num(s.conversions),
      conversion_value: num(s.conversion_value),
    })),
    events: events.map((e) => ({
      id: e.id,
      event_name: e.event_name,
      page_path: e.page_path,
      events_at: e.events_at,
      metadata: e.metadata ?? {},
    })),
    conversions,
    errors,
  });
}