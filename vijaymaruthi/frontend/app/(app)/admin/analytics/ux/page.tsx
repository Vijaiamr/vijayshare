"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState } from "@/components/admin/analytics/ui";

interface UxData {
  days: number;
  totals: {
    errors: number;
    rageClicks: number;
    deadClicks: number;
    slowInteractions: number;
    sessions: number;
    pageviews: number;
  };
  cwv: {
    LCP: { p75: number | null; samples: number };
    CLS: { p75: number | null; samples: number };
    INP: { p75: number | null; samples: number };
  };
  errors: { page: string | null; message: string; at: string }[];
  rageClicks: { page: string | null; count: number; at: string }[];
  deadClicks: { page: string | null; count: number; at: string }[];
  slowInteractions: { page: string | null; ms: number; at: string }[];
}

export default function UxPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<UxData>(`/api/admin/analytics/ux?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">UX & Errors</h1>
          <p className="text-sm text-muted-foreground">Friction, errors, and Core Web Vitals</p>
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Panel title="JS errors">
              <div className="text-2xl font-bold tabular-nums text-rose-500">{data.totals.errors}</div>
            </Panel>
            <Panel title="Rage clicks">
              <div className="text-2xl font-bold tabular-nums text-amber-500">{data.totals.rageClicks}</div>
            </Panel>
            <Panel title="Dead clicks">
              <div className="text-2xl font-bold tabular-nums text-amber-500">{data.totals.deadClicks}</div>
            </Panel>
            <Panel title="Slow interactions">
              <div className="text-2xl font-bold tabular-nums text-sky-500">{data.totals.slowInteractions}</div>
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Panel title="LCP (p75)">
              <div className="text-2xl font-bold tabular-nums">{data.cwv.LCP.p75 ? `${(data.cwv.LCP.p75 / 1000).toFixed(2)}s` : "—"}</div>
              <div className="text-xs text-muted-foreground">{data.cwv.LCP.samples} samples</div>
            </Panel>
            <Panel title="CLS (p75)">
              <div className="text-2xl font-bold tabular-nums">{data.cwv.CLS.p75?.toFixed(3) ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{data.cwv.CLS.samples} samples</div>
            </Panel>
            <Panel title="INP (p75)">
              <div className="text-2xl font-bold tabular-nums">{data.cwv.INP.p75 ? `${Math.round(data.cwv.INP.p75)}ms` : "—"}</div>
              <div className="text-xs text-muted-foreground">{data.cwv.INP.samples} samples</div>
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Recent errors">
              {data.errors.length === 0 ? <EmptyState message="No errors recorded." /> : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
                  {data.errors.map((e, i) => (
                    <div key={i} className="rounded-lg bg-rose-500/10 px-3 py-1.5">
                      <div className="truncate font-mono text-xs text-rose-600 dark:text-rose-400">{e.message}</div>
                      <div className="text-xs text-muted-foreground">{e.page ?? "—"} · {new Date(e.at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Rage / dead clicks">
              {data.rageClicks.length === 0 && data.deadClicks.length === 0 ? (
                <EmptyState message="No click friction recorded." />
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
                  {data.rageClicks.map((r, i) => (
                    <div key={`r${i}`} className="rounded-lg bg-amber-500/10 px-3 py-1.5">
                      <span className="font-medium">Rage ×{r.count}</span> <span className="text-xs text-muted-foreground">{r.page ?? "—"}</span>
                    </div>
                  ))}
                  {data.deadClicks.map((r, i) => (
                    <div key={`d${i}`} className="rounded-lg bg-amber-500/10 px-3 py-1.5">
                      <span className="font-medium">Dead ×{r.count}</span> <span className="text-xs text-muted-foreground">{r.page ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}