import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters, filterBySegment, fetchPriorAnonIds } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/visitors
 *
 * Drill-down behind the "Unique Visitors" KPI: every unique visitor in the
 * period (keyed by user_id ?? anonymous_id), with per-visitor engagement,
 * conversion, and identity details.
 *
 * Supports:
 *   q          — free-text: matches email (via profiles) or anonymous_id prefix
 *   identified — "1" to show only identified visitors (user_id set)
 *   converted  — "1" to show only visitors with ≥1 conversion
 *   limit      — max rows (default 200, max 500)
 *
 * Honors the global filters (range, segment, device, browser, source) exactly
 * like compute.ts so the visitor count matches the KPI on the dashboard.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;

  const url = new URL(request.url);
  const q = parseFilters(url.toString());
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const identifiedOnly = url.searchParams.get("identified") === "1";
  const convertedOnly = url.searchParams.get("converted") === "1";
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));

  const [sessionsRes, profilesRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("id,user_id,anonymous_id,started_at,last_seen_at,entry_page,device,browser,country,page_views,active_seconds,conversions,conversion_value"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
    ctx.service.from("profiles").select("id,email"),
  ]);

  const emailById = new Map<string, string>();
  for (const p of profilesRes.data ?? []) emailById.set(p.id, p.email);

  // Segment filtering must match compute.ts (new/returning need prior activity).
  let sessions = sessionsRes.data ?? [];
  if (q.filters.segment && q.filters.segment !== "all") {
    const prior = await fetchPriorAnonIds(ctx.service, q.start);
    sessions = filterBySegment(sessions, q.filters.segment, prior);
  }

  const byKey = new Map<string, {
    key: string;
    user_id: string | null;
    anonymous_id: string | null;
    sessions: number;
    pageviews: number;
    activeSeconds: number;
    conversions: number;
    conversionValue: number;
    firstSeen: string | null;
    lastSeen: string | null;
    entryPage: string | null;
    device: string | null;
    browser: string | null;
    country: string | null;
    latestSessionId: string | null;
    latestTs: string | null;
  }>();

  for (const r of sessions) {
    const key = r.user_id ?? r.anonymous_id ?? "anonymous";
    const cur = byKey.get(key) ?? {
      key,
      user_id: r.user_id ?? null,
      anonymous_id: r.anonymous_id ?? null,
      sessions: 0,
      pageviews: 0,
      activeSeconds: 0,
      conversions: 0,
      conversionValue: 0,
      firstSeen: null,
      lastSeen: null,
      entryPage: null,
      device: null,
      browser: null,
      country: null,
      latestSessionId: null,
      latestTs: null,
    };
    cur.sessions += 1;
    cur.pageviews += num(r.page_views);
    cur.activeSeconds += num(r.active_seconds);
    cur.conversions += num(r.conversions);
    cur.conversionValue += num(r.conversion_value);
    if (r.started_at && (!cur.firstSeen || r.started_at < cur.firstSeen)) cur.firstSeen = r.started_at;
    if (r.last_seen_at && (!cur.lastSeen || r.last_seen_at > cur.lastSeen)) cur.lastSeen = r.last_seen_at;
    if (!cur.entryPage && r.entry_page) cur.entryPage = r.entry_page;
    if (!cur.device && r.device) cur.device = r.device;
    if (!cur.browser && r.browser) cur.browser = r.browser;
    if (!cur.country && r.country) cur.country = r.country;
    const ts = r.last_seen_at ?? r.started_at;
    if (r.id && ts && (!cur.latestTs || ts > cur.latestTs)) {
      cur.latestTs = ts;
      cur.latestSessionId = r.id;
    }
    byKey.set(key, cur);
  }

  let visitors = [...byKey.values()].map((v) => ({
    key: v.key,
    user_id: v.user_id,
    email: v.user_id ? emailById.get(v.user_id) ?? null : null,
    anonymous_id: v.anonymous_id,
    sessions: v.sessions,
    pageviews: v.pageviews,
    activeSeconds: v.activeSeconds,
    conversions: v.conversions,
    conversionValue: Math.round(v.conversionValue),
    firstSeen: v.firstSeen,
    lastSeen: v.lastSeen,
    entryPage: v.entryPage,
    device: v.device,
    browser: v.browser,
    country: v.country,
    latestSessionId: v.latestSessionId,
  }));

  // Free-text search: email (via profiles) or anonymous_id prefix.
  if (search) {
    const needle = search.toLowerCase();
    visitors = visitors.filter((v) => {
      if (v.email && v.email.toLowerCase().includes(needle)) return true;
      if (v.anonymous_id && v.anonymous_id.toLowerCase().includes(needle)) return true;
      return false;
    });
  }
  if (identifiedOnly) visitors = visitors.filter((v) => !!v.user_id);
  if (convertedOnly) visitors = visitors.filter((v) => v.conversions > 0);

  const summary = {
    total: visitors.length,
    identified: visitors.filter((v) => !!v.user_id).length,
    anonymous: visitors.filter((v) => !v.user_id).length,
    converted: visitors.filter((v) => v.conversions > 0).length,
    revenue: visitors.reduce((acc, v) => acc + v.conversionValue, 0),
  };

  visitors.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
  const rows = visitors.slice(0, limit);

  return NextResponse.json({ days: q.days, summary, visitors: rows });
}