import { NextResponse } from "next/server";
import { requireAnalytics, daysParam, daysAgo, auditLog } from "@/lib/analytics/admin";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/analytics/alerts
 *   → alert definitions + recent triggered events
 *
 * POST /api/admin/analytics/alerts
 *   { action: "create", name, condition }   → create rule
 *   { action: "toggle", id, enabled }       → enable/disable
 *   { action: "delete", id }                → remove rule
 *
 * Condition shapes (evaluated by the rollup cron):
 *   { metric: "bounce_rate"|"conversion_rate"|"pageviews"|"errors", op: "gt"|"lt", value: number }
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const days = daysParam(request.url);
  const since = daysAgo(days);

  const [alertsRes, eventsRes] = await Promise.all([
    ctx.service.from("analytics_alerts").select("*").order("created_at", { ascending: true }),
    ctx.service
      .from("analytics_alert_events")
      .select("*")
      .gte("triggered_at", since)
      .order("triggered_at", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json({
    alerts: alertsRes.data ?? [],
    recent: eventsRes.data ?? [],
  });
}

export async function POST(request: Request) {
  const ctx = await requireAnalytics("configure");
  if (ctx.error) return ctx.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  switch (body.action) {
    case "create": {
      const name = String(body.name ?? "").trim();
      const condition = body.condition;
      if (!name || !condition || typeof condition !== "object") {
        return NextResponse.json({ error: "name and condition are required" }, { status: 400 });
      }
      const { data, error } = await ctx.service
        .from("analytics_alerts")
        .insert({ name, condition, enabled: true })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await auditLog(ctx.service, ctx.user, "create", "alert", data?.id, { name, condition });
      return NextResponse.json({ ok: true, alert: data }, { status: 201 });
    }
    case "toggle": {
      const id = String(body.id ?? "");
      const enabled = body.enabled === true;
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const { error } = await ctx.service
        .from("analytics_alerts")
        .update({ enabled })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await auditLog(ctx.service, ctx.user, "toggle", "alert", id, { enabled });
      return NextResponse.json({ ok: true });
    }
    case "delete": {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const { error } = await ctx.service.from("analytics_alerts").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await auditLog(ctx.service, ctx.user, "delete", "alert", id);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}