import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/top-pages?limit=20
 *
 * Most-viewed pages with pageview counts, unique visitors, and avg time
 * (approximated from session active_seconds attributed to the entry page).
 * Honors the global filters (range, segment, device, browser, source).
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "20", 10) || 20));

  const [viewsRes, sessionsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("page_path,anonymous_id")
        .eq("event_name", "page_view"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ),
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("entry_page,active_seconds,page_views,conversions,conversion_value,anonymous_id"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
  ]);

  const counts = new Map<string, number>();
  const visitors = new Map<string, Set<string>>();
  for (const r of viewsRes.data ?? []) {
    const p = r.page_path ?? "(unknown)";
    counts.set(p, (counts.get(p) ?? 0) + 1);
    if (!visitors.has(p)) visitors.set(p, new Set());
    if (r.anonymous_id) visitors.get(p)!.add(r.anonymous_id);
  }

  const timeByPage = new Map<string, { sum: number; n: number }>();
  for (const r of sessionsRes.data ?? []) {
    const p = r.entry_page ?? "(unknown)";
    const cur = timeByPage.get(p) ?? { sum: 0, n: 0 };
    cur.sum += num(r.active_seconds);
    cur.n += 1;
    timeByPage.set(p, cur);
  }

  const rows = [...counts.entries()]
    .map(([page, count]) => {
      const t = timeByPage.get(page);
      return {
        page,
        pageviews: count,
        visitors: visitors.get(page)?.size ?? 0,
        avgSeconds: t && t.n > 0 ? Math.round(t.sum / t.n) : 0,
      };
    })
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, limit);

  return NextResponse.json({ days: q.days, rows });
}