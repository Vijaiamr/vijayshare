import { NextResponse } from "next/server";
import { requireAnalytics, num, daysParam, daysAgo } from "@/lib/analytics/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/sessions
 *
 * Historical session search + list. Supports:
 *   q         — free-text across entry/exit page, source, medium, campaign,
 *               device, browser, country, anonymous_id (and user email when
 *               it matches)
 *   days      — lookback window (default 30, max 365)
 *   user      — restrict to one user_id
 *   converted — "1" to show only sessions with conversions
 *   limit     — max rows (default 50, max 200)
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;

  const url = new URL(request.url);
  const days = daysParam(url.toString());
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const userId = url.searchParams.get("user")?.trim().slice(0, 64) || null;
  const converted = url.searchParams.get("converted") === "1";
  const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  let query = ctx.service
    .from("analytics_sessions")
    .select("id,user_id,anonymous_id,started_at,last_seen_at,entry_page,exit_page,source,medium,campaign,device,browser,country,page_views,active_seconds,conversions,conversion_value")
    .gte("started_at", daysAgo(days))
    .order("started_at", { ascending: false })
    .limit(limit);

  if (userId) query = query.eq("user_id", userId);
  if (converted) query = query.gt("conversions", 0);

  // Free-text search: match session fields directly; if the query looks like
  // an email, also resolve matching user ids from profiles.
  let userFilter: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const orParts = [
      `entry_page.ilike.${like}`,
      `exit_page.ilike.${like}`,
      `source.ilike.${like}`,
      `medium.ilike.${like}`,
      `campaign.ilike.${like}`,
      `device.ilike.${like}`,
      `browser.ilike.${like}`,
      `country.ilike.${like}`,
      `anonymous_id.ilike.${like}`,
    ];
    if (q.includes("@")) {
      const { data: profiles } = await ctx.service
        .from("profiles")
        .select("id")
        .ilike("email", like)
        .limit(20);
      userFilter = (profiles ?? []).map((p: any) => p.id);
    }
    if (userFilter && userFilter.length > 0) {
      query = query.or(`(${orParts.join(",")},user_id.in.(${userFilter.join(",")}))`);
    } else {
      query = query.or(orParts.join(","));
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((s: any) => ({
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
    device: s.device,
    browser: s.browser,
    country: s.country,
    page_views: num(s.page_views),
    active_seconds: num(s.active_seconds),
    conversions: num(s.conversions),
    conversion_value: num(s.conversion_value),
  }));

  return NextResponse.json({ sessions: rows, total: rows.length, days });
}