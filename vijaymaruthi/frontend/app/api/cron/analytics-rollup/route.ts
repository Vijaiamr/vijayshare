import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/analytics-rollup
 *
 * Daily rollup + alert evaluation. Called by the Vercel cron (see
 * vercel.json "crons"). Protected by the CRON_SECRET header.
 *
 * Steps:
 *   1. Aggregate yesterday's sessions/events into analytics_daily
 *      (pageviews, sessions, visitors, conversions, revenue, errors).
 *   2. Evaluate alert rules (analytics_alerts) against the latest daily
 *      metrics and insert analytics_alert_events when a rule fires.
 *   3. Delete raw events older than 90 days (retention).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const service = await createServiceClient();
  const yesterday = new Date(Date.now() - 86_400_000);
  const dayStart = new Date(yesterday);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const dayKey = dayStart.toISOString().slice(0, 10);

  try {
    // ── 1. Aggregate yesterday ──
    const [sessionsRes, pageviewsRes, visitorsRes, convRes, errorsRes] = await Promise.all([
      service
        .from("analytics_sessions")
        .select("id,active_seconds,page_views", { count: "exact" })
        .gte("started_at", dayStart.toISOString())
        .lt("started_at", dayEnd.toISOString()),
      service
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("event_name", "page_view")
        .gte("events_at", dayStart.toISOString())
        .lt("events_at", dayEnd.toISOString()),
      service
        .from("analytics_events")
        .select("anonymous_id")
        .eq("event_name", "page_view")
        .gte("events_at", dayStart.toISOString())
        .lt("events_at", dayEnd.toISOString()),
      service
        .from("analytics_events")
        .select("metadata")
        .eq("event_name", "conversion")
        .gte("events_at", dayStart.toISOString())
        .lt("events_at", dayEnd.toISOString()),
      service
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("event_name", "error")
        .gte("events_at", dayStart.toISOString())
        .lt("events_at", dayEnd.toISOString()),
    ]);

    const sessions = sessionsRes.data ?? [];
    const pageviews = pageviewsRes.count ?? 0;
    const visitors = new Set((visitorsRes.data ?? []).map((r) => r.anonymous_id).filter(Boolean)).size;
    const conversions = convRes.data ?? [];
    const revenue = conversions.reduce((s, e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      const v = typeof meta.value === "number" ? meta.value : Number(meta.value ?? 0);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
    const errors = errorsRes.count ?? 0;
    const activeSeconds = sessions.reduce((s, r) => s + (typeof r.active_seconds === "number" ? r.active_seconds : 0), 0);
    const bounced = sessions.filter((r) => (typeof r.page_views === "number" ? r.page_views : 0) <= 1).length;

    const metrics = {
      pageviews,
      sessions: sessions.length,
      visitors,
      conversions: conversions.length,
      revenue,
      errors,
      avg_session_seconds: sessions.length > 0 ? Math.round(activeSeconds / sessions.length) : 0,
      bounce_rate: sessions.length > 0 ? bounced / sessions.length : 0,
      conversion_rate: sessions.length > 0 ? conversions.length / sessions.length : 0,
    };

    const { error: upsertErr } = await service.from("analytics_daily").upsert(
      Object.entries(metrics).map(([metric, value]) => ({
        date: dayKey,
        metric,
        value,
      })),
      { onConflict: "date,metric" },
    );
    if (upsertErr) throw upsertErr;

    // ── 2. Evaluate alerts ──
    const { data: alerts } = await service.from("analytics_alerts").select("*").eq("enabled", true);
    const fired: { alert_id: string; payload: Record<string, unknown> }[] = [];
    for (const a of alerts ?? []) {
      const cond = (a.condition ?? {}) as { metric?: string; op?: string; value?: number };
      const metric = cond.metric as keyof typeof metrics;
      const current = metrics[metric];
      if (current === undefined || cond.op === undefined || cond.value === undefined) continue;
      const hit = cond.op === "gt" ? current > cond.value : cond.op === "lt" ? current < cond.value : false;
      if (hit) {
        fired.push({
          alert_id: a.id,
          payload: { metric: cond.metric, op: cond.op, threshold: cond.value, actual: current, date: dayKey },
        });
      }
    }
    if (fired.length > 0) {
      const { error: alertErr } = await service.from("analytics_alert_events").insert(
        fired.map((f) => ({ alert_id: f.alert_id, payload: f.payload })),
      );
      if (alertErr) throw alertErr;
    }

    // ── 3. Retention: drop raw events older than 90 days ──
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { error: delErr } = await service.from("analytics_events").delete().lt("events_at", cutoff);
    if (delErr) throw delErr;

    return NextResponse.json({ ok: true, date: dayKey, metrics, alertsFired: fired.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rollup failed";
    console.error("analytics-rollup:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}