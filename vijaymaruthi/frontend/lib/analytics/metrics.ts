/**
 * lib/analytics/metrics.ts
 *
 * Centralized metric definition layer. Every KPI rendered in the analytics
 * UI has a documented formula, denominator and "good direction" so the
 * interface can explain itself and trend indicators are always correct
 * (e.g. rising errors is bad, rising conversion is good).
 */

export interface MetricDefinition {
  key: string;
  label: string;
  formula: string;
  denominator: "users" | "sessions" | "events" | "none";
  /** Whether an increase is positive (true) or negative (false). */
  goodWhenUp: boolean;
  format: "number" | "percent" | "currency" | "duration";
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  activeUsers: {
    key: "activeUsers",
    label: "Active Users",
    formula: "Unique users (or anonymous visitors) with at least one qualifying event in the period.",
    denominator: "users",
    goodWhenUp: true,
    format: "number",
  },
  sessions: {
    key: "sessions",
    label: "Sessions",
    formula: "A session is a group of events from one user within a 30-minute inactivity window.",
    denominator: "sessions",
    goodWhenUp: true,
    format: "number",
  },
  pageviews: {
    key: "pageviews",
    label: "Page Views",
    formula: "Count of page_view events in the period.",
    denominator: "events",
    goodWhenUp: true,
    format: "number",
  },
  uniqueVisitors: {
    key: "uniqueVisitors",
    label: "Unique Visitors",
    formula: "Distinct anonymous_ids with activity in the period.",
    denominator: "users",
    goodWhenUp: true,
    format: "number",
  },
  engagementRate: {
    key: "engagementRate",
    label: "Engagement Rate",
    formula: "Sessions with ≥2 page views or ≥10s active time ÷ total sessions × 100.",
    denominator: "sessions",
    goodWhenUp: true,
    format: "percent",
  },
  bounceRate: {
    key: "bounceRate",
    label: "Bounce Rate",
    formula: "Sessions with exactly 1 page view ÷ total sessions × 100.",
    denominator: "sessions",
    goodWhenUp: false,
    format: "percent",
  },
  conversionRate: {
    key: "conversionRate",
    label: "Conversion Rate",
    formula: "Sessions with ≥1 conversion event ÷ total sessions × 100.",
    denominator: "sessions",
    goodWhenUp: true,
    format: "percent",
  },
  avgSessionSeconds: {
    key: "avgSessionSeconds",
    label: "Avg Session",
    formula: "Total active seconds ÷ sessions. Active time counts only foreground, visible-page time.",
    denominator: "sessions",
    goodWhenUp: true,
    format: "duration",
  },
  revenue: {
    key: "revenue",
    label: "Revenue",
    formula: "Sum of conversion event metadata.value (INR) in the period.",
    denominator: "events",
    goodWhenUp: true,
    format: "currency",
  },
  revenuePerUser: {
    key: "revenuePerUser",
    label: "Revenue / User",
    formula: "Total revenue ÷ unique users in the period.",
    denominator: "users",
    goodWhenUp: true,
    format: "currency",
  },
  conversions: {
    key: "conversions",
    label: "Conversions",
    formula: "Count of conversion events in the period.",
    denominator: "events",
    goodWhenUp: true,
    format: "number",
  },
  errors: {
    key: "errors",
    label: "Errors",
    formula: "Count of error / api_error events in the period.",
    denominator: "events",
    goodWhenUp: false,
    format: "number",
  },
  retention: {
    key: "retention",
    label: "Retention",
    formula: "Users active in the period who were also active in the previous period ÷ users in period × 100.",
    denominator: "users",
    goodWhenUp: true,
    format: "percent",
  },
};

export function metricDefinition(key: string): MetricDefinition {
  return (
    METRIC_DEFINITIONS[key] ?? {
      key,
      label: key,
      formula: "Custom metric — see page definition.",
      denominator: "none",
      goodWhenUp: true,
      format: "number",
    }
  );
}