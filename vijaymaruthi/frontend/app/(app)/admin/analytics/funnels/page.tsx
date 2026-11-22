"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState, fmtPct } from "@/components/admin/analytics/ui";

interface FunnelsData {
  days: number;
  funnels: {
    id: string;
    name: string;
    steps: { label: string; sessions: number }[];
    totalSessions: number;
    conversionRate: number;
  }[];
}

export default function FunnelsPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<FunnelsData>(`/api/admin/analytics/funnels?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Funnels</h1>
          <p className="text-sm text-muted-foreground">Step-by-step conversion funnels</p>
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

      {data && data.funnels.length === 0 && (
        <EmptyState message="No funnels defined yet. Funnels are created by the admin (schema seed) — check back after the rollup cron seeds defaults." />
      )}

      {data && data.funnels.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.funnels.map((f) => (
            <Panel key={f.id} title={f.name} actions={<span className="text-xs text-muted-foreground">{fmtPct(f.conversionRate)} overall</span>}>
              <div className="space-y-3">
                {f.steps.map((s, i) => {
                  const prev = i > 0 ? f.steps[i - 1].sessions : f.totalSessions;
                  const drop = prev > 0 ? 1 - s.sessions / prev : 0;
                  return (
                    <div key={i}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="truncate font-medium">{s.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {s.sessions.toLocaleString()} · {fmtPct(prev > 0 ? s.sessions / prev : 0)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${prev > 0 ? (s.sessions / prev) * 100 : 0}%` }}
                        />
                      </div>
                      {i > 0 && drop > 0 && (
                        <div className="mt-0.5 text-right text-xs text-rose-500">−{fmtPct(drop)} drop-off</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}