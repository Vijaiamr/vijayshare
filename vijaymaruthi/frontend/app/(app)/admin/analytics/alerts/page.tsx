"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState } from "@/components/admin/analytics/ui";

interface AlertsData {
  alerts: {
    id: string;
    name: string;
    condition: { metric?: string; op?: string; value?: number } | null;
    enabled: boolean;
    created_at: string;
  }[];
  recent: {
    id: string;
    alert_id: string;
    triggered_at: string;
    payload: Record<string, unknown> | null;
  }[];
}

export default function AlertsPage() {
  const [refresh, setRefresh] = React.useState(0);
  const { data, error, loading } = useAdminData<AlertsData>("/api/admin/analytics/alerts", refresh);

  const toggle = async (id: string, enabled: boolean) => {
    await fetch("/api/admin/analytics/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id, enabled }),
    });
    setRefresh((r) => r + 1);
  };

  const remove = async (id: string) => {
    await fetch("/api/admin/analytics/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    setRefresh((r) => r + 1);
  };

  const create = async () => {
    const name = window.prompt("Alert name", "Bounce rate spike");
    if (!name) return;
    const metric = window.prompt("Metric (bounce_rate | conversion_rate | pageviews | errors)", "bounce_rate");
    if (!metric) return;
    const op = window.prompt("Operator (gt | lt)", "gt");
    if (!op) return;
    const value = Number(window.prompt("Threshold value", "0.7"));
    if (Number.isNaN(value)) return;
    await fetch("/api/admin/analytics/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name, condition: { metric, op, value } }),
    });
    setRefresh((r) => r + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Alerts</h1>
          <p className="text-sm text-muted-foreground">Rule-based anomaly alerts (evaluated by the rollup cron)</p>
        </div>
        <button
          onClick={create}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
        >
          + New alert
        </button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingRow rows={2} />}

      {data && (
        <>
          <Panel title="Alert rules">
            {data.alerts.length === 0 ? (
              <EmptyState message="No alert rules yet. Create one to monitor a metric." />
            ) : (
              <div className="space-y-2">
                {data.alerts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="flex-1 truncate font-medium">{a.name}</span>
                    <code className="hidden rounded bg-muted px-2 py-0.5 font-mono text-xs sm:inline">
                      {a.condition?.metric ?? "?"} {a.condition?.op ?? "?"} {a.condition?.value ?? "?"}
                    </code>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${a.enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {a.enabled ? "enabled" : "disabled"}
                    </span>
                    <button onClick={() => toggle(a.id, !a.enabled)} className="text-xs text-muted-foreground hover:text-foreground">
                      {a.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => remove(a.id)} className="text-xs text-rose-500 hover:text-rose-600">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent triggers">
            {data.recent.length === 0 ? (
              <EmptyState message="No alerts have fired yet." />
            ) : (
              <div className="space-y-1.5 text-sm">
                {data.recent.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span className="flex-1 truncate font-medium">{r.alert_id.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(r.triggered_at).toLocaleString()}</span>
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