"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState } from "@/components/admin/analytics/ui";

interface RealtimeData {
  onlineNow: number;
  online: { id: string; user_id: string | null; anonymous_id: string | null; page_views: number; country: string | null; source: string | null; medium: string | null }[];
  buckets: { minute: string; pageviews: number; events: number }[];
  topPages: { page: string; count: number }[];
  topSources: { source: string; count: number }[];
}

export default function RealtimePage() {
  const [tick, setTick] = React.useState(0);
  const { data, error, loading } = useAdminData<RealtimeData>("/api/admin/analytics/realtime", tick);

  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Real-time</h1>
          <p className="text-sm text-muted-foreground">Auto-refreshes every 30s</p>
        </div>
        {data && (
          <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            {data.onlineNow} online now
          </span>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingRow rows={2} />}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Activity — last 30 minutes">
            {data.buckets.every((b) => b.events === 0) ? (
              <EmptyState message="No activity in the last 30 minutes." />
            ) : (
              <div className="flex h-32 items-end gap-0.5">
                {data.buckets.map((b) => (
                  <div key={b.minute} className="group relative flex-1">
                    <div
                      className="w-full rounded-t bg-emerald-500/70"
                      style={{ height: `${Math.max(4, (b.events / Math.max(...data.buckets.map((x) => x.events), 1)) * 100)}%` }}
                      title={`${b.minute} — ${b.events} events`}
                    />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Live sessions">
            {data.online.length === 0 ? (
              <EmptyState message="No active sessions right now." />
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
                {data.online.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="flex-1 truncate">{s.user_id ? `user:${s.user_id.slice(0, 8)}` : s.anonymous_id ? `anon:${s.anonymous_id.slice(0, 8)}` : "guest"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.country ?? "—"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.source ?? "direct"}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Top pages (30m)">
            {data.topPages.length === 0 ? <EmptyState /> : (
              <div className="space-y-1.5 text-sm">
                {data.topPages.map((p) => (
                  <div key={p.page} className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{p.page}</code>
                    <span className="tabular-nums">{p.count}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Top sources (30m)">
            {data.topSources.length === 0 ? <EmptyState /> : (
              <div className="space-y-1.5 text-sm">
                {data.topSources.map((s) => (
                  <div key={s.source} className="flex items-center gap-2">
                    <span className="flex-1 truncate">{s.source}</span>
                    <span className="tabular-nums">{s.count}</span>
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