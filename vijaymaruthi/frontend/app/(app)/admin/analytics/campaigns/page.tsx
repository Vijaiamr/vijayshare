"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState, fmtPct, fmtINR } from "@/components/admin/analytics/ui";

interface CampaignsData {
  days: number;
  rows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    sessions: number;
    pageviews: number;
    conversions: number;
    revenue: number;
    conversionRate: number;
  }[];
}

export default function CampaignsPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<CampaignsData>(`/api/admin/analytics/campaigns?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Performance by source / medium / campaign</p>
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

      {data && data.rows.length === 0 && <EmptyState />}

      {data && data.rows.length > 0 && (
        <Panel className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Channel</th>
                  <th className="px-4 py-2 text-right">Sessions</th>
                  <th className="px-4 py-2 text-right">Pageviews</th>
                  <th className="px-4 py-2 text-right">Conv</th>
                  <th className="px-4 py-2 text-right">Conv rate</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.source ?? "direct"}</span>
                      <span className="text-muted-foreground"> / {r.medium ?? "none"}</span>
                      {r.campaign && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{r.campaign}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.sessions.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.pageviews.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.conversions}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.conversionRate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtINR(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}