"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, Sparkline, LoadingRow, ErrorBanner, EmptyState, fmtINR } from "@/components/admin/analytics/ui";

interface RevenueData {
  days: number;
  totalRevenue: number;
  conversionCount: number;
  aov: number;
  series: { day: string; revenue: number }[];
  byGoal: { goal: string; count: number; revenue: number }[];
}

export default function RevenuePage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<RevenueData>(`/api/admin/analytics/revenue?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Revenue Intelligence</h1>
          <p className="text-sm text-muted-foreground">Conversion goals with monetary value</p>
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
      {loading && <LoadingRow rows={2} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Panel title="Total revenue">
              <div className="text-2xl font-bold tabular-nums text-emerald-500">{fmtINR(data.totalRevenue)}</div>
            </Panel>
            <Panel title="Conversions">
              <div className="text-2xl font-bold tabular-nums">{data.conversionCount.toLocaleString()}</div>
            </Panel>
            <Panel title="Avg order value">
              <div className="text-2xl font-bold tabular-nums">{fmtINR(data.aov)}</div>
            </Panel>
          </div>

          <Panel title={`Revenue — last ${data.days} days`}>
            {data.series.every((s) => s.revenue === 0) ? (
              <EmptyState message="No conversion revenue recorded yet. Conversion events carry metadata.value (INR)." />
            ) : (
              <Sparkline values={data.series.map((s) => s.revenue)} height={120} stroke="#f59e0b" />
            )}
          </Panel>

          <Panel title="Revenue by goal">
            {data.byGoal.length === 0 ? <EmptyState /> : (
              <div className="space-y-2">
                {data.byGoal.map((g) => (
                  <div key={g.goal} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate font-medium">{g.goal}</span>
                    <span className="tabular-nums text-muted-foreground">{g.count} conv</span>
                    <span className="tabular-nums font-semibold">{fmtINR(g.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}