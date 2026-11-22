import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/ux
 *
 * UX health: JS errors, rage clicks, dead clicks, slow interactions (INP),
 * and Core Web Vitals (LCP/CLS/INP) from client-tracker events.
 * Honors the global filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [eventsRes, sessionsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("event_name,page_path,metadata,events_at")
        .in("event_name", ["error", "rage_click", "dead_click", "slow_interaction", "LCP", "CLS", "INP"]),
      q.filters,
      "events_at",
      q.start,
      q.end,
    )
      .order("events_at", { ascending: false })
      .limit(500),
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("id,page_views"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
  ]);

  const errors: { page: string | null; message: string; at: string }[] = [];
  const rageClicks: { page: string | null; count: number; at: string }[] = [];
  const deadClicks: { page: string | null; count: number; at: string }[] = [];
  const slowInteractions: { page: string | null; ms: number; at: string }[] = [];
  const cwv: Record<string, number[]> = { LCP: [], CLS: [], INP: [] };

  for (const e of eventsRes.data ?? []) {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const page = e.page_path ?? null;
    switch (e.event_name) {
      case "error":
        errors.push({ page, message: String(meta.message ?? "unknown"), at: e.events_at });
        break;
      case "rage_click":
        rageClicks.push({ page, count: num(meta.count), at: e.events_at });
        break;
      case "dead_click":
        deadClicks.push({ page, count: num(meta.count), at: e.events_at });
        break;
      case "slow_interaction":
        slowInteractions.push({ page, ms: num(meta.ms), at: e.events_at });
        break;
      case "LCP":
      case "CLS":
      case "INP":
        cwv[e.event_name].push(num(meta.value));
        break;
    }
  }

  const pct = (arr: number[], p: number): number | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };

  const totalSessions = sessionsRes.count ?? sessionsRes.data?.length ?? 0;
  const totalPageviews = ((sessionsRes.data ?? []) as any[]).reduce((s, r) => s + num(r.page_views), 0);

  return NextResponse.json({
    days: q.days,
    totals: {
      errors: errors.length,
      rageClicks: rageClicks.reduce((s, r) => s + r.count, 0),
      deadClicks: deadClicks.reduce((s, r) => s + r.count, 0),
      slowInteractions: slowInteractions.length,
      sessions: totalSessions,
      pageviews: totalPageviews,
    },
    cwv: {
      LCP: { p75: pct(cwv.LCP, 0.75), samples: cwv.LCP.length },
      CLS: { p75: pct(cwv.CLS, 0.75), samples: cwv.CLS.length },
      INP: { p75: pct(cwv.INP, 0.75), samples: cwv.INP.length },
    },
    errors: errors.slice(0, 50),
    rageClicks: rageClicks.slice(0, 50),
    deadClicks: deadClicks.slice(0, 50),
    slowInteractions: slowInteractions.slice(0, 50),
  });
}