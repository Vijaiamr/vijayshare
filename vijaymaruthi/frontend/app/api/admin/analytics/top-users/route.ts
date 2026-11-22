import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/top-users?limit=20
 *
 * Most engaged identified users: sessions, pageviews, active time,
 * conversions, and last-seen. Anonymous visitors are aggregated separately.
 * Honors the global filters (range, segment, device, browser, source).
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "20", 10) || 20));

  const [sessionsRes, profilesRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("user_id,anonymous_id,page_views,active_seconds,conversions,conversion_value,last_seen_at"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
    ctx.service.from("profiles").select("id,email"),
  ]);

  const emailById = new Map<string, string>();
  for (const p of profilesRes.data ?? []) emailById.set(p.id, p.email);

  const byUser = new Map<string, {
    user_id: string | null;
    anonymous_id: string | null;
    sessions: number;
    pageviews: number;
    activeSeconds: number;
    conversions: number;
    conversionValue: number;
    lastSeen: string | null;
  }>();

  for (const r of sessionsRes.data ?? []) {
    const key = r.user_id ?? r.anonymous_id ?? "anonymous";
    const cur = byUser.get(key) ?? {
      user_id: r.user_id ?? null,
      anonymous_id: r.anonymous_id ?? null,
      sessions: 0,
      pageviews: 0,
      activeSeconds: 0,
      conversions: 0,
      conversionValue: 0,
      lastSeen: null,
    };
    cur.sessions += 1;
    cur.pageviews += num(r.page_views);
    cur.activeSeconds += num(r.active_seconds);
    cur.conversions += num(r.conversions);
    cur.conversionValue += num(r.conversion_value);
    if (r.last_seen_at && (!cur.lastSeen || r.last_seen_at > cur.lastSeen)) {
      cur.lastSeen = r.last_seen_at;
    }
    byUser.set(key, cur);
  }

  const rows = [...byUser.values()]
    .map((r) => ({
      user_id: r.user_id,
      email: r.user_id ? emailById.get(r.user_id) ?? null : null,
      anonymous_id: r.anonymous_id,
      sessions: r.sessions,
      pageviews: r.pageviews,
      activeSeconds: r.activeSeconds,
      conversions: r.conversions,
      conversionValue: Math.round(r.conversionValue),
      lastSeen: r.lastSeen,
    }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, limit);

  return NextResponse.json({ days: q.days, rows });
}