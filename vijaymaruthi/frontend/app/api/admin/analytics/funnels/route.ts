import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/funnels
 *
 * Funnel definitions (analytics_funnels) with live conversion computed from
 * events. Each funnel has ordered steps; a session "reaches" step N if it
 * fired every step up to N. Drop-off = previous step count − current count.
 * Honors the global filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [funnelsRes, eventsRes] = await Promise.all([
    ctx.service.from("analytics_funnels").select("*").order("created_at", { ascending: true }),
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("session_id,event_name,page_path"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ),
  ]);

  const funnels = funnelsRes.data ?? [];
  const events = eventsRes.data ?? [];

  // session → set of event names + page paths seen
  const sessionEvents = new Map<string, Set<string>>();
  const sessionPages = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.session_id) continue;
    if (!sessionEvents.has(e.session_id)) sessionEvents.set(e.session_id, new Set());
    if (!sessionPages.has(e.session_id)) sessionPages.set(e.session_id, new Set());
    if (e.event_name) sessionEvents.get(e.session_id)!.add(e.event_name);
    if (e.page_path) sessionPages.get(e.session_id)!.add(e.page_path);
  }

  const rows = funnels.map((f) => {
    const steps: { label: string; sessions: number }[] = [];
    const rawSteps: unknown[] = Array.isArray(f.steps) ? f.steps : [];
    let reached = 0;
    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i] as { type?: string; value?: string };
      const type = step?.type ?? "event";
      const value = step?.value ?? "";
      let count = 0;
      for (const [sid, evs] of sessionEvents) {
        if (type === "page") {
          if (sessionPages.get(sid)?.has(value)) count += 1;
        } else {
          if (evs.has(value)) count += 1;
        }
      }
      steps.push({ label: value || `Step ${i + 1}`, sessions: count });
      if (i === 0) reached = count;
    }
    const total = reached;
    const conversionRate = total > 0 && steps.length > 0 ? steps[steps.length - 1].sessions / total : 0;
    return {
      id: f.id,
      name: f.name,
      steps,
      totalSessions: total,
      conversionRate,
    };
  });

  return NextResponse.json({ days: q.days, funnels: rows });
}