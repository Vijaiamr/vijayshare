/**
 * lib/analytics/compute.ts
 *
 * Shared analytics computation layer. Every KPI has one definition here so
 * the Executive and Behavior pages (and any future page) can never drift.
 *
 * Segment semantics (documented):
 *   all        — every session in the period
 *   new        — anonymous_id with NO activity before the period start
 *   returning  — anonymous_id with activity before the period start
 *   converted  — sessions with ≥1 conversion
 *   highValue  — sessions with conversion_value ≥ ₹5,000
 *
 * When a segment is active, event-level metrics (pageviews, conversions,
 * revenue) are derived from session aggregates so the segment applies
 * consistently. Errors are dimension-filtered only (segment does not apply).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AnalyticsFilters, dimensionFilters, SegmentId } from "./filters";
import { num } from "./admin";

export interface SessionRow {
  id: string;
  anonymous_id: string | null;
  user_id: string | null;
  page_views: number | null;
  active_seconds: number | null;
  conversions: number | null;
  conversion_value: number | null;
  started_at: string;
  [key: string]: unknown;
}

export interface PeriodData {
  sessions: SessionRow[];
  /** Sessions after segment filtering. */
  sessionCount: number;
  pageviews: number;
  conversions: number;
  revenue: number;
  errors: number;
  uniqueVisitors: number;
  activeUsers: number;
  avgSessionSeconds: number;
  bounceRate: number;
  engagementRate: number;
  conversionRate: number;
  revenuePerUser: number;
}

/** Apply global dimension filters to a supabase-js query builder. */
export function applyDimensionFilters(
  qb: any,
  f: AnalyticsFilters,
  tsCol: string,
  start: string,
  end: string,
) {
  let q = qb.gte(tsCol, start).lte(tsCol, end);
  const dims = dimensionFilters(f);
  if (dims.device) q = q.eq("device", dims.device);
  if (dims.browser) q = q.eq("browser", dims.browser);
  if (dims.source) q = q.eq("source", dims.source);
  if (dims.medium) q = q.eq("medium", dims.medium);
  if (dims.country) q = q.eq("country", dims.country);
  if (dims.campaign) q = q.eq("campaign", dims.campaign);
  return q;
}

/** Distinct anonymous_ids with activity before `start` (for new/returning). */
export async function fetchPriorAnonIds(
  service: SupabaseClient,
  start: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data } = await service
      .from("analytics_events")
      .select("anonymous_id")
      .lt("events_at", start)
      .not("anonymous_id", "is", null)
      .range(from, from + pageSize - 1);
    const rows = data ?? [];
    for (const r of rows) if (r.anonymous_id) out.add(r.anonymous_id);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** Distinct anonymous_ids active in the period (for retention). */
export async function fetchActiveAnonIds(
  service: SupabaseClient,
  f: AnalyticsFilters,
  start: string,
  end: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const qb = service
      .from("analytics_sessions")
      .select("anonymous_id")
      .not("anonymous_id", "is", null)
      .range(from, from + pageSize - 1);
    const q = applyDimensionFilters(qb, f, "started_at", start, end);
    const { data } = await q;
    const rows = data ?? [];
    for (const r of rows) if (r.anonymous_id) out.add(r.anonymous_id);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** Filter session rows by the active segment. */
export function filterBySegment(sessions: SessionRow[], segment: SegmentId, priorAnonIds: Set<string>): SessionRow[] {
  switch (segment) {
    case "all":
      return sessions;
    case "new":
      return sessions.filter((s) => !s.anonymous_id || !priorAnonIds.has(s.anonymous_id));
    case "returning":
      return sessions.filter((s) => !!s.anonymous_id && priorAnonIds.has(s.anonymous_id));
    case "converted":
      return sessions.filter((s) => num(s.conversions) > 0);
    case "highValue":
      return sessions.filter((s) => num(s.conversion_value) >= 5000);
    default:
      return sessions;
  }
}

/**
 * Fetch + compute all KPIs for a period. `priorAnonIds` is required for
 * new/returning segments (pass an empty set when unknown).
 *
 * Revenue and conversions are computed from conversion EVENTS (metadata.value
 * / metadata.goal) — the same source as the revenue API — so the two can
 * never disagree. When a segment is active, only events whose session is in
 * the segment are counted.
 */
export async function computePeriodData(
  service: SupabaseClient,
  f: AnalyticsFilters,
  start: string,
  end: string,
  priorAnonIds: Set<string>,
): Promise<PeriodData> {
  // Sessions (dimension-filtered)
  const qb = service
    .from("analytics_sessions")
    .select("id,anonymous_id,user_id,page_views,active_seconds,conversions,conversion_value,started_at");
  const q = applyDimensionFilters(qb, f, "started_at", start, end);
  const { data: sessionRows } = await q;
  const allSessions = (sessionRows ?? []) as SessionRow[];

  // Errors (dimension-filtered only — segment does not apply)
  const errQb = service
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .in("event_name", ["error", "api_error"]);
  const errQ = applyDimensionFilters(errQb, f, "events_at", start, end);
  const { count: errorCount } = await errQ;

  // Conversion events (dimension-filtered) — source of truth for revenue.
  const convQb = service
    .from("analytics_events")
    .select("session_id,metadata")
    .eq("event_name", "conversion");
  const convQ = applyDimensionFilters(convQb, f, "events_at", start, end);
  const { data: convRows } = await convQ;
  const convEvents = (convRows ?? []) as { session_id: string | null; metadata: unknown }[];

  const sessions = filterBySegment(allSessions, f.segment, priorAnonIds);
  const sessionCount = sessions.length;

  // Segment-aware conversion events: when a segment is active, only count
  // events whose session is part of the segment.
  const sessionIds = new Set(sessions.map((s) => s.id));
  const segmentConvEvents =
    f.segment === "all" ? convEvents : convEvents.filter((e) => e.session_id && sessionIds.has(e.session_id));

  const conversions = segmentConvEvents.length;
  const revenue = segmentConvEvents.reduce((sum, e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const v = typeof meta.value === "number" ? meta.value : Number(meta.value ?? 0);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

  const pageviews = sessions.reduce((s, r) => s + num(r.page_views), 0);
  const uniqueVisitors = new Set(sessions.map((s) => s.anonymous_id).filter(Boolean)).size;
  const activeUsers = new Set(sessions.map((s) => s.user_id).filter(Boolean)).size;
  const totalActiveSeconds = sessions.reduce((s, r) => s + num(r.active_seconds), 0);
  const avgSessionSeconds = sessionCount > 0 ? totalActiveSeconds / sessionCount : 0;
  const bounced = sessions.filter((s) => num(s.page_views) <= 1).length;
  const bounceRate = sessionCount > 0 ? bounced / sessionCount : 0;
  const engaged = sessions.filter((s) => num(s.page_views) >= 2 || num(s.active_seconds) >= 10).length;
  const engagementRate = sessionCount > 0 ? engaged / sessionCount : 0;
  const conversionRate = sessionCount > 0 ? conversions / sessionCount : 0;
  const revenuePerUser = uniqueVisitors > 0 ? revenue / uniqueVisitors : 0;

  return {
    sessions: sessions,
    sessionCount,
    pageviews,
    conversions,
    revenue,
    errors: errorCount ?? 0,
    uniqueVisitors,
    activeUsers,
    avgSessionSeconds,
    bounceRate,
    engagementRate,
    conversionRate,
    revenuePerUser,
  };
}

/** Percentage change helper: (cur - prev) / prev × 100, null when prev is 0. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}