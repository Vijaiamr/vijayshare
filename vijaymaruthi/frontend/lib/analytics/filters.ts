/**
 * lib/analytics/filters.ts
 *
 * Global analytics filter engine — the single source of truth for how every
 * analytics page and API interprets date ranges, comparisons, segments and
 * dimension filters.
 *
 * Design rules:
 *  - All timestamps are stored/compared in UTC. Date boundaries are UTC.
 *  - Filters are serialized to URL query params so state survives reloads and
 *    is shareable.
 *  - Every analytics API accepts the same filter params and applies them
 *    consistently — a metric can never mix periods.
 */

export type RangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export type CompareMode = "none" | "previous" | "previousYear" | "custom";

export type SegmentId = "all" | "new" | "returning" | "converted" | "highValue";

export type DeviceFilter = "all" | "desktop" | "mobile" | "tablet";

export type BrowserFilter = "all" | "chrome" | "safari" | "edge" | "firefox";

export type SourceFilter =
  | "all"
  | "direct"
  | "organic"
  | "paid"
  | "referral"
  | "social"
  | "campaign";

export interface AnalyticsFilters {
  preset: RangePreset;
  /** ISO date (YYYY-MM-DD) — only used when preset === "custom" */
  customStart?: string;
  customEnd?: string;
  compare: CompareMode;
  /** ISO date — only used when compare === "custom" */
  customCompareStart?: string;
  customCompareEnd?: string;
  segment: SegmentId;
  device: DeviceFilter;
  browser: BrowserFilter;
  source: SourceFilter;
  country: string; // "all" or ISO-3166 alpha-2
  campaign: string; // "all" or UTM campaign name
}

export const DEFAULT_FILTERS: AnalyticsFilters = {
  preset: "30d",
  compare: "previous",
  segment: "all",
  device: "all",
  browser: "all",
  source: "all",
  country: "all",
  campaign: "all",
};

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "custom", label: "Custom" },
];

export const COMPARE_MODES: { id: CompareMode; label: string }[] = [
  { id: "none", label: "No comparison" },
  { id: "previous", label: "Previous period" },
  { id: "previousYear", label: "Previous year" },
  { id: "custom", label: "Custom comparison" },
];

export const SEGMENTS: { id: SegmentId; label: string; description: string }[] = [
  { id: "all", label: "All users", description: "Every user with activity in the period." },
  { id: "new", label: "New users", description: "Users whose first-ever event falls inside the period." },
  { id: "returning", label: "Returning users", description: "Users with activity before the period who returned." },
  { id: "converted", label: "Converted users", description: "Users who completed a conversion event in the period." },
  { id: "highValue", label: "High-value users", description: "Users with conversion value ≥ ₹5,000 in the period." },
];

export const DEVICES: { id: DeviceFilter; label: string }[] = [
  { id: "all", label: "All devices" },
  { id: "desktop", label: "Desktop" },
  { id: "mobile", label: "Mobile" },
  { id: "tablet", label: "Tablet" },
];

export const BROWSERS: { id: BrowserFilter; label: string }[] = [
  { id: "all", label: "All browsers" },
  { id: "chrome", label: "Chrome" },
  { id: "safari", label: "Safari" },
  { id: "edge", label: "Edge" },
  { id: "firefox", label: "Firefox" },
];

export const SOURCES: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "direct", label: "Direct" },
  { id: "organic", label: "Organic" },
  { id: "paid", label: "Paid" },
  { id: "referral", label: "Referral" },
  { id: "social", label: "Social" },
  { id: "campaign", label: "Campaign" },
];

/* ─────────────────────────────────────────────────────────────────────
   Period computation
   ───────────────────────────────────────────────────────────────────── */

export interface Period {
  start: string; // ISO timestamp (UTC)
  end: string; // ISO timestamp (UTC)
  label: string;
}

function iso(d: Date): string {
  return d.toISOString();
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Compute the primary period for a filter set. */
export function computePeriod(f: AnalyticsFilters, now = new Date()): Period {
  const end = now;
  switch (f.preset) {
    case "today": {
      const start = startOfUtcDay(now);
      return { start: iso(start), end: iso(end), label: "Today" };
    }
    case "yesterday": {
      const start = new Date(startOfUtcDay(now).getTime() - 86_400_000);
      const e = startOfUtcDay(now);
      return { start: iso(start), end: iso(e), label: "Yesterday" };
    }
    case "7d":
      return { start: iso(new Date(end.getTime() - 7 * 86_400_000)), end: iso(end), label: "Last 7 days" };
    case "30d":
      return { start: iso(new Date(end.getTime() - 30 * 86_400_000)), end: iso(end), label: "Last 30 days" };
    case "90d":
      return { start: iso(new Date(end.getTime() - 90 * 86_400_000)), end: iso(end), label: "Last 90 days" };
    case "thisMonth": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start: iso(start), end: iso(end), label: "This month" };
    }
    case "lastMonth": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start: iso(start), end: iso(e), label: "Last month" };
    }
    case "custom": {
      const start = f.customStart ? new Date(`${f.customStart}T00:00:00.000Z`) : new Date(end.getTime() - 30 * 86_400_000);
      const e = f.customEnd ? new Date(`${f.customEnd}T23:59:59.999Z`) : end;
      if (e < start) return { start: iso(start), end: iso(start), label: "Custom" };
      return { start: iso(start), end: iso(e), label: "Custom" };
    }
  }
}

/** Compute the comparison period (equal length, immediately before primary). */
export function computeComparison(f: AnalyticsFilters, primary: Period, now = new Date()): Period | null {
  if (f.compare === "none") return null;
  if (f.compare === "custom") {
    const start = f.customCompareStart ? new Date(`${f.customCompareStart}T00:00:00.000Z`) : null;
    const end = f.customCompareEnd ? new Date(`${f.customCompareEnd}T23:59:59.999Z`) : null;
    if (!start || !end) return null;
    return { start: iso(start), end: iso(end), label: "Custom comparison" };
  }
  const pStart = new Date(primary.start);
  const pEnd = new Date(primary.end);
  const span = pEnd.getTime() - pStart.getTime();
  if (f.compare === "previousYear") {
    const start = new Date(pStart.getTime() - 365 * 86_400_000);
    const end = new Date(pEnd.getTime() - 365 * 86_400_000);
    return { start: iso(start), end: iso(end), label: "Previous year" };
  }
  // previous period of equal length
  const start = new Date(pStart.getTime() - span);
  const end = new Date(pStart.getTime());
  return { start: iso(start), end: iso(end), label: "Previous period" };
}

/** Number of days in the primary period (for series bucketing). */
export function periodDays(primary: Period): number {
  const span = new Date(primary.end).getTime() - new Date(primary.start).getTime();
  return Math.max(1, Math.round(span / 86_400_000));
}

/** Sensible series resolution based on period length. */
export function seriesResolution(days: number): "hourly" | "daily" | "weekly" | "monthly" {
  if (days <= 2) return "hourly";
  if (days <= 45) return "daily";
  if (days <= 180) return "weekly";
  return "monthly";
}

/* ─────────────────────────────────────────────────────────────────────
   URL serialization
   ───────────────────────────────────────────────────────────────────── */

export function filtersToParams(f: AnalyticsFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set("range", f.preset);
  if (f.customStart) p.set("start", f.customStart);
  if (f.customEnd) p.set("end", f.customEnd);
  p.set("compare", f.compare);
  if (f.customCompareStart) p.set("cstart", f.customCompareStart);
  if (f.customCompareEnd) p.set("cend", f.customCompareEnd);
  p.set("segment", f.segment);
  p.set("device", f.device);
  p.set("browser", f.browser);
  p.set("source", f.source);
  if (f.country && f.country !== "all") p.set("country", f.country);
  if (f.campaign && f.campaign !== "all") p.set("campaign", f.campaign);
  return p;
}

export function filtersFromParams(search: string): AnalyticsFilters {
  const p = new URLSearchParams(search);
  const preset = (p.get("range") as RangePreset) || DEFAULT_FILTERS.preset;
  const f: AnalyticsFilters = {
    preset: RANGE_PRESETS.some((r) => r.id === preset) ? preset : DEFAULT_FILTERS.preset,
    customStart: p.get("start") ?? undefined,
    customEnd: p.get("end") ?? undefined,
    compare: (p.get("compare") as CompareMode) || DEFAULT_FILTERS.compare,
    customCompareStart: p.get("cstart") ?? undefined,
    customCompareEnd: p.get("cend") ?? undefined,
    segment: (p.get("segment") as SegmentId) || DEFAULT_FILTERS.segment,
    device: (p.get("device") as DeviceFilter) || DEFAULT_FILTERS.device,
    browser: (p.get("browser") as BrowserFilter) || DEFAULT_FILTERS.browser,
    source: (p.get("source") as SourceFilter) || DEFAULT_FILTERS.source,
    country: p.get("country") ?? "all",
    campaign: p.get("campaign") ?? "all",
  };
  return f;
}

/** Build the query string used by API fetches (filters + extra params). */
export function buildQuery(f: AnalyticsFilters, extra?: Record<string, string | number | undefined>): string {
  const p = filtersToParams(f);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== "") p.set(k, String(v));
    }
  }
  return p.toString();
}

/* ─────────────────────────────────────────────────────────────────────
   PostgREST filter builders (shared by every analytics API route)
   ───────────────────────────────────────────────────────────────────── */

export interface DimensionFilters {
  device?: string;
  browser?: string;
  source?: string;
  medium?: string;
  country?: string;
  campaign?: string;
}

/**
 * Translate the global dimension filters into PostgREST column filters.
 * Applied to both analytics_events and analytics_sessions queries.
 */
export function dimensionFilters(f: AnalyticsFilters): DimensionFilters {
  const out: DimensionFilters = {};
  if (f.device !== "all") out.device = f.device;
  if (f.browser !== "all") out.browser = f.browser;
  if (f.source !== "all") {
    switch (f.source) {
      case "direct":
        out.source = "direct";
        out.medium = "none";
        break;
      case "organic":
        out.medium = "organic";
        break;
      case "paid":
        out.medium = "cpc";
        break;
      case "referral":
        out.medium = "referral";
        break;
      case "social":
        out.medium = "social";
        break;
      case "campaign":
        // campaign filter handled separately below
        break;
    }
  }
  if (f.country !== "all") out.country = f.country;
  if (f.campaign !== "all") out.campaign = f.campaign;
  return out;
}

/** Build a PostgREST filter string for a given table alias (events/sessions). */
export function buildPostgrestFilters(
  f: AnalyticsFilters,
  table: "events" | "sessions",
  start: string,
  end: string,
): string[] {
  const tsCol = table === "events" ? "events_at" : "started_at";
  const filters: string[] = [`${tsCol}=gte.${start}`, `${tsCol}=lte.${end}`];
  const dims = dimensionFilters(f);
  if (dims.device) filters.push(`device=eq.${dims.device}`);
  if (dims.browser) filters.push(`browser=eq.${dims.browser}`);
  if (dims.source) filters.push(`source=eq.${dims.source}`);
  if (dims.medium) filters.push(`medium=eq.${dims.medium}`);
  if (dims.country) filters.push(`country=eq.${dims.country}`);
  if (dims.campaign) filters.push(`campaign=eq.${dims.campaign}`);
  return filters;
}

/** Human label for the active range (header display). */
export function rangeLabel(f: AnalyticsFilters): string {
  const p = computePeriod(f);
  return p.label;
}