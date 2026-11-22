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

/**
 * Simplified in-house session replay: reconstructs the visitor's page path
 * as a timeline. (Full DOM-level replay is out of scope for the in-house
 * build — this gives the same "what did this user do" signal.)
 */
export default function ReplayPage() {
  const [days, setDays] = React.useState(30);
  const [selected, setSelected] = React.useState<string | null>(null);
  const { data, error, loading } = useAdminData<JourneysData>(`/api/admin/analytics/journeys?days=${days}`, days);

  const session = data?.journeys.find((j) => j.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Session Replay</h1>
          <p className="text-sm text-muted-foreground">Simplified in-house replay — page-path timeline per session</p>
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
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Sessions">
            <div className="max-h-[480px] space-y-1.5 overflow-y-auto text-sm">
              {data.journeys.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setSelected(j.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected === j.id
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">
                      {j.user_id ? `user:${j.user_id.slice(0, 8)}` : j.anonymous_id ? `anon:${j.anonymous_id.slice(0, 8)}` : "guest"}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(j.started_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{j.page_views} views</span>
                    <span>·</span>
                    <span>{fmtDuration(j.active_seconds)}</span>
                    {j.conversions > 0 && <span className="text-emerald-500">· ✓ converted</span>}
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title={session ? "Timeline" : "Timeline — select a session"}>
            {!session ? (
              <EmptyState message="Pick a session on the left to replay its path." />
            ) : (
              <div className="space-y-0">
                {session.path.length === 0 && <EmptyState message="No page views recorded for this session." />}
                {session.path.map((p, i) => (
                  <div key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < session.path.length - 1 && (
                      <span className="absolute left-[5px] top-4 h-full w-px bg-border" />
                    )}
                    <span className={`relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? "bg-sky-500" : i === session.path.length - 1 ? "bg-rose-500" : "bg-emerald-500"}`} />
                    <div className="min-w-0">
                      <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-xs">{p}</code>
                      {i === 0 && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-sky-500">entry</div>}
                      {i === session.path.length - 1 && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-rose-500">exit</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}