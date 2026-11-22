import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  AnalyticsFilters,
  DEFAULT_FILTERS,
  filtersFromParams,
  computePeriod,
  computeComparison,
  periodDays,
  buildPostgrestFilters,
} from "@/lib/analytics/filters";

/**
 * Shared admin-analytics helpers.
 *
 * Every analytics API route must pass through requireAnalytics() — the
 * service-role role check — so analytics data is admin-only by construction
 * (the client nav is just UX; this is the gate).
 *
 * Role model (profiles.role):
 *   super_admin — full access incl. user management
 *   admin       — analytics + configuration (funnels/audiences/alerts)
 *   analyst     — analytics + exports
 *   viewer      — read-only analytics
 *   user        — regular app user (no analytics)
 */

export type AnalyticsRole = "super_admin" | "admin" | "analyst" | "viewer" | "user";

/** Capability levels — higher number = more access. */
export const ROLE_LEVEL: Record<AnalyticsRole, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
  super_admin: 4,
  user: 0,
};

export type AnalyticsCapability = "view" | "export" | "configure" | "manage_users";

export const CAPABILITY_LEVEL: Record<AnalyticsCapability, number> = {
  view: 1,
  export: 2,
  configure: 3,
  manage_users: 4,
};

export type AdminCtx =
  | { error: NextResponse; user?: undefined; service?: undefined; role?: undefined }
  | { user: User; service: SupabaseClient; role: AnalyticsRole; error?: undefined };

/**
 * Require an analytics role with at least the given capability.
 * Defaults to "view" (any analytics role). Returns 401/403 otherwise.
 */
export async function requireAnalytics(
  capability: AnalyticsCapability = "view",
): Promise<AdminCtx> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const service = await createServiceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (profile?.role as AnalyticsRole) ?? "user";
  if (ROLE_LEVEL[role] < CAPABILITY_LEVEL[capability]) {
    return {
      error: NextResponse.json(
        { error: `Forbidden — requires ${capability} capability` },
        { status: 403 },
      ),
    };
  }
  return { user, service, role };
}

/** Backward-compatible alias: admin-or-above. */
export async function requireAdmin(): Promise<AdminCtx> {
  return requireAnalytics("configure");
}

/** Parse a `days` query param (default 30, clamp 1..365). */
export function daysParam(url: string, fallback = 30): number {
  try {
    const p = new URL(url).searchParams.get("days");
    if (!p) return fallback;
    const n = Number.parseInt(p, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(365, Math.max(1, n));
  } catch {
    return fallback;
  }
}

/** ISO timestamp `days` ago. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** ISO timestamp `minutes` ago. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Build a date-keyed series (YYYY-MM-DD) from rows with ISO timestamps. */
export function seriesByDay<T extends { day: string; value: number }>(
  rows: T[],
  days: number,
): { day: string; value: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.day, r.value);
  const out: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: map.get(key) ?? 0 });
  }
  return out;
}

/** Safe number from a possibly-null DB value. */
export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* ─────────────────────────────────────────────────────────────────────
   Global filter parsing for API routes
   ───────────────────────────────────────────────────────────────────── */

export interface FilteredQuery {
  filters: AnalyticsFilters;
  /** Primary period (UTC ISO). */
  start: string;
  end: string;
  /** Comparison period, or null. */
  compareStart: string | null;
  compareEnd: string | null;
  /** Days in the primary period. */
  days: number;
  /** PostgREST filter strings for events / sessions tables. */
  eventFilters: string[];
  sessionFilters: string[];
}

/** Parse the global filter params from a request URL. */
export function parseFilters(url: string): FilteredQuery {
  const filters = filtersFromParams(new URL(url).search);
  const period = computePeriod(filters);
  const comparison = computeComparison(filters, period);
  const days = periodDays(period);
  return {
    filters,
    start: period.start,
    end: period.end,
    compareStart: comparison?.start ?? null,
    compareEnd: comparison?.end ?? null,
    days,
    eventFilters: buildPostgrestFilters(filters, "events", period.start, period.end),
    sessionFilters: buildPostgrestFilters(filters, "sessions", period.start, period.end),
  };
}

/** Build a PostgREST filter string for a comparison period (events). */
export function comparisonEventFilters(f: AnalyticsFilters, start: string, end: string): string[] {
  return buildPostgrestFilters(f, "events", start, end);
}

/** Build a PostgREST filter string for a comparison period (sessions). */
export function comparisonSessionFilters(f: AnalyticsFilters, start: string, end: string): string[] {
  return buildPostgrestFilters(f, "sessions", start, end);
}

/** Default filters constant re-exported for convenience. */
export { DEFAULT_FILTERS };

/* ─────────────────────────────────────────────────────────────────────
   Audit logging
   ───────────────────────────────────────────────────────────────────── */

/**
 * Write an entry to analytics_audit_log. Fire-and-forget: failures are
 * swallowed so audit logging never breaks the primary operation.
 */
export async function auditLog(
  service: SupabaseClient,
  actor: User,
  action: string,
  entity: string,
  entityId?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await service.from("analytics_audit_log").insert({
      actor_id: actor.id,
      actor_email: actor.email ?? null,
      action,
      entity,
      entity_id: entityId ?? null,
      details: details ?? null,
    });
  } catch {
    // audit logging is best-effort
  }
}