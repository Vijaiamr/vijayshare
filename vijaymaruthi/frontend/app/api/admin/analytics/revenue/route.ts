import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, seriesByDay, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/revenue
 *
 * Revenue intelligence: conversion events carry metadata.value (INR).
 * Returns total revenue, conversions, AOV, revenue per day, and revenue by
 * conversion goal name (metadata.goal). Honors the global filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [eventsRes, sessionsRes] = await Promise.all([
    applyDimensionFilters(
      ctx.service
        .from("analytics_events")
        .select("metadata,events_at"),
      q.filters,
      "events_at",
      q.start,
      q.end,
    ).eq("event_name", "conversion"),
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("id,conversions"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
  ]);

  const conversions = (eventsRes.data ?? []) as any[];
  const totalRevenue = conversions.reduce((s, e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const v = typeof meta.value === "number" ? meta.value : Number(meta.value ?? 0);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const conversionCount = conversions.length;
  const aov = conversionCount > 0 ? totalRevenue / conversionCount : 0;

  const byDay = new Map<string, number>();
  const byGoal = new Map<string, { count: number; revenue: number }>();
  for (const e of conversions) {
    const day = String(e.events_at).slice(0, 10);
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const v = typeof meta.value === "number" ? meta.value : Number(meta.value ?? 0);
    const value = Number.isFinite(v) ? v : 0;
    byDay.set(day, (byDay.get(day) ?? 0) + value);
    const goal = String(meta.goal ?? "conversion");
    const cur = byGoal.get(goal) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += value;
    byGoal.set(goal, cur);
  }

  const series = seriesByDay([], q.days).map((d) => ({
    day: d.day,
    revenue: byDay.get(d.day) ?? 0,
  }));

  const byGoalRows = [...byGoal.entries()]
    .map(([goal, g]) => ({ goal, count: g.count, revenue: g.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({
    days: q.days,
    totalRevenue,
    conversionCount,
    aov,
    series,
    byGoal: byGoalRows,
  });
}