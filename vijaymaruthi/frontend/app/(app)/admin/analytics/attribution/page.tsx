"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState, fmtPct, fmtINR } from "@/components/admin/analytics/ui";

interface AttributionData {
  days: number;
  totalConversions: number;
  totalRevenue: number;
  rows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    conversions: number;
    revenue: number;
    share: number;
    revenueShare: number;
  }[];
}

export default function AttributionPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<AttributionData>(`/api/admin/analytics/attribution?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Attribution</h1>
          <p className="text-sm text-muted-foreground">Last-touch credit for conversions</p>
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

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Panel title="Total conversions">
              <div className="text-2xl font-bold tabular-nums">{data.totalConversions.toLocaleString()}</div>
            </Panel>
            <Panel title="Attributed revenue">
              <div className="text-2xl font-bold tabular-nums">{fmtINR(data.totalRevenue)}</div>
            </Panel>
            <Panel title="Channels">
              <div className="text-2xl font-bold tabular-nums">{data.rows.length}</div>
            </Panel>
          </div>

          {data.rows.length === 0 && <EmptyState />}

          {data.rows.length > 0 && (
            <Panel className="!p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2">Channel</th>
                      <th className="px-4 py-2 text-right">Conversions</th>
                      <th className="px-4 py-2 text-right">Share</th>
                      <th className="px-4 py-2 text-right">Revenue</th>
                      <th className="px-4 py-2 text-right">Rev share</th>
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
                        <td className="px-4 py-2 text-right tabular-nums">{r.conversions}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.share)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtINR(r.revenue)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.revenueShare)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}