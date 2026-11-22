"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState, fmtDuration } from "@/components/admin/analytics/ui";

interface JourneysData {
  days: number;
  journeys: {
    id: string;
    user_id: string | null;
    anonymous_id: string | null;
    started_at: string;
    entry_page: string | null;
    exit_page: string | null;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    page_views: number;
    active_seconds: number;
    conversions: number;
    path: string[];
  }[];
}

export default function JourneysPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<JourneysData>(`/api/admin/analytics/journeys?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Journeys</h1>
          <p className="text-sm text-muted-foreground">Recent visitor paths through the app</p>
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

      {data && data.journeys.length === 0 && <EmptyState />}

      {data && data.journeys.length > 0 && (
        <div className="space-y-3">
          {data.journeys.map((j) => (
            <Panel key={j.id} className="!p-0">
              <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {j.user_id ? `user:${j.user_id.slice(0, 8)}` : j.anonymous_id ? `anon:${j.anonymous_id.slice(0, 8)}` : "guest"}
                </span>
                {" · "}
                {new Date(j.started_at).toLocaleString()} · {j.source ?? "direct"}/{j.medium ?? "none"}
                {j.campaign ? ` · ${j.campaign}` : ""} · {fmtDuration(j.active_seconds)}
                {j.conversions > 0 && <span className="ml-2 text-emerald-500">✓ {j.conversions} conversion{j.conversions > 1 ? "s" : ""}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 p-4">
                {j.path.length === 0 && <span className="text-sm text-muted-foreground">No page views recorded</span>}
                {j.path.map((p, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{p}</code>
                  </React.Fragment>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}