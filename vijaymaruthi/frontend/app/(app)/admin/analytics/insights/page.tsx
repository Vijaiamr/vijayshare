"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState, fmtPct, fmtINR } from "@/components/admin/analytics/ui";

interface OverviewData {
  days: number;
  kpis: {
    sessions: number;
    pageviews: number;
    uniqueVisitors: number;
    activeUsers: number;
    conversions: number;
    conversionRate: number;
    avgSessionSeconds: number;
    bounceRate: number;
  };
  series: { day: string; pageviews: number }[];
}

interface UxData {
  days: number;
  totals: { errors: number; rageClicks: number; deadClicks: number; slowInteractions: number; sessions: number; pageviews: number };
  cwv: { LCP: { p75: number | null; samples: number }; CLS: { p75: number | null; samples: number }; INP: { p75: number | null; samples: number } };
}

interface RevenueData {
  days: number;
  totalRevenue: number;
  conversionCount: number;
  aov: number;
  series: { day: string; revenue: number }[];
  byGoal: { goal: string; count: number; revenue: number }[];
}

interface CampaignsData {
  days: number;
  rows: { source: string | null; medium: string | null; campaign: string | null; sessions: number; pageviews: number; conversions: number; revenue: number; conversionRate: number }[];
}

interface Insight {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

/**
 * Rule-based AI insights (no LLM — deterministic rules over live metrics).
 * Each rule maps a metric threshold to a human-readable recommendation.
 */
export default function InsightsPage() {
  const [days, setDays] = React.useState(30);
  const overview = useAdminData<OverviewData>(`/api/admin/analytics/overview?days=${days}`, days);
  const ux = useAdminData<UxData>(`/api/admin/analytics/ux?days=${days}`, days);
  const revenue = useAdminData<RevenueData>(`/api/admin/analytics/revenue?days=${days}`, days);
  const campaigns = useAdminData<CampaignsData>(`/api/admin/analytics/campaigns?days=${days}`, days);

  const loading = overview.loading || ux.loading || revenue.loading || campaigns.loading;
  const error = overview.error || ux.error || revenue.error || campaigns.error;

  const insights = React.useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    const k = overview.data?.kpis;
    const u = ux.data;
    const r = revenue.data;
    const c = campaigns.data;

    if (!k) return out;

    // Engagement
    if (k.bounceRate > 0.6) {
      out.push({
        severity: "critical",
        title: `High bounce rate (${fmtPct(k.bounceRate)})`,
        detail: "More than 60% of sessions leave after one page. Review landing-page clarity, load speed, and the first screen above the fold.",
      });
    } else if (k.bounceRate > 0.45) {
      out.push({
        severity: "warning",
        title: `Elevated bounce rate (${fmtPct(k.bounceRate)})`,
        detail: "Bounce is above the healthy range. Consider tightening the hero message and primary CTA.",
      });
    }

    if (k.conversionRate < 0.02 && k.sessions > 20) {
      out.push({
        severity: "warning",
        title: `Low conversion rate (${fmtPct(k.conversionRate)})`,
        detail: "Fewer than 2% of sessions convert. Check funnel drop-off and whether the main CTA is visible on key pages.",
      });
    } else if (k.conversionRate >= 0.05) {
      out.push({
        severity: "info",
        title: `Healthy conversion rate (${fmtPct(k.conversionRate)})`,
        detail: "Conversion is above 5% — the primary flow is working well.",
      });
    }

    if (k.avgSessionSeconds < 30 && k.sessions > 20) {
      out.push({
        severity: "warning",
        title: `Short sessions (avg ${Math.round(k.avgSessionSeconds)}s)`,
        detail: "Visitors spend under 30 seconds on average. Content depth or navigation clarity may need attention.",
      });
    }

    // UX
    if (u) {
      if (u.totals.errors > 0) {
        out.push({
          severity: u.totals.errors > 10 ? "critical" : "warning",
          title: `${u.totals.errors} JavaScript error${u.totals.errors === 1 ? "" : "s"} in ${u.days} days`,
          detail: "Errors degrade the experience and can silently break flows. See the UX & Errors tab for the latest messages.",
        });
      }
      if (u.totals.rageClicks > 0) {
        out.push({
          severity: "warning",
          title: `${u.totals.rageClicks} rage click${u.totals.rageClicks === 1 ? "" : "s"}`,
          detail: "Rapid repeated clicks usually mean a button feels unresponsive. Inspect the affected pages in UX & Errors.",
        });
      }
      if (u.cwv.LCP.p75 && u.cwv.LCP.p75 > 2500) {
        out.push({
          severity: "warning",
          title: `Slow LCP (${(u.cwv.LCP.p75 / 1000).toFixed(1)}s p75)`,
          detail: "Largest Contentful Paint exceeds 2.5s. Optimize hero images, fonts, and server response time.",
        });
      }
      if (u.cwv.INP.p75 && u.cwv.INP.p75 > 200) {
        out.push({
          severity: "warning",
          title: `Slow interactions (${Math.round(u.cwv.INP.p75)}ms INP p75)`,
          detail: "Interaction latency exceeds 200ms. Look for heavy client-side work on the most-used pages.",
        });
      }
    }

    // Revenue
    if (r && r.totalRevenue > 0) {
      out.push({
        severity: "info",
        title: `Revenue ${fmtINR(r.totalRevenue)} from ${r.conversionCount} conversions`,
        detail: `Average order value is ${fmtINR(r.aov)}. Top goal: ${r.byGoal[0]?.goal ?? "—"} (${fmtINR(r.byGoal[0]?.revenue ?? 0)}).`,
      });
    }

    // Campaigns
    if (c && c.rows.length > 0) {
      const top = c.rows[0];
      out.push({
        severity: "info",
        title: `Top channel: ${top.source ?? "direct"} / ${top.medium ?? "none"}`,
        detail: `${top.sessions} sessions, ${fmtPct(top.conversionRate)} conversion rate, ${fmtINR(top.revenue)} revenue. Consider doubling down here.`,
      });
      const worst = [...c.rows].sort((a, b) => a.conversionRate - b.conversionRate)[0];
      if (worst && worst.sessions >= 5 && worst.conversionRate === 0) {
        out.push({
          severity: "warning",
          title: `Zero-conversion channel: ${worst.source ?? "direct"} / ${worst.medium ?? "none"}`,
          detail: `${worst.sessions} sessions with no conversions. Re-evaluate this channel's targeting or landing experience.`,
        });
      }
    }

    if (out.length === 0) {
      out.push({
        severity: "info",
        title: "All metrics look healthy",
        detail: "No rule thresholds were breached in the selected window.",
      });
    }

    return out;
  }, [overview.data, ux.data, revenue.data, campaigns.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AI Insights</h1>
          <p className="text-sm text-muted-foreground">Rule-based recommendations over live metrics (no LLM)</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingRow rows={3} />}

      {!loading && !error && (
        <div className="space-y-3">
          {insights.map((ins, i) => (
            <Panel key={i} className={ins.severity === "critical" ? "border-rose-500/40" : ins.severity === "warning" ? "border-amber-500/40" : ""}>
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    ins.severity === "critical" ? "bg-rose-500" : ins.severity === "warning" ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                />
                <div>
                  <div className="font-semibold">{ins.title}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{ins.detail}</div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}