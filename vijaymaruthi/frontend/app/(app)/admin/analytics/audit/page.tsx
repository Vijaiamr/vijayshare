"use client";

/**
 * app/(app)/admin/analytics/audit/page.tsx
 *
 * §15 — Audit log: configuration changes (alerts, funnels, audiences)
 * with actor, action, entity and timestamp. Admin-only.
 */

import * as React from "react";
import { useAdmin } from "@/lib/admin-context";
import { LoadingSkeleton, ErrorState, SectionTitle } from "@/components/admin/analytics/states";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";

interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  create: "bg-success/10 text-success",
  toggle: "bg-info/10 text-info",
  delete: "bg-danger/10 text-danger",
  update: "bg-warning/10 text-warning",
};

export default function AuditPage() {
  const { canConfigure, loading: authLoading } = useAdmin();
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!canConfigure) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/admin/analytics/audit", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => setEntries(d.entries ?? []))
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [canConfigure]);

  const cols: Column<AuditEntry>[] = [
    { key: "created_at", header: "Time", cell: (r) => <span className="tabular-nums">{new Date(r.created_at).toLocaleString()}</span> },
    {
      key: "action",
      header: "Action",
      cell: (r) => (
        <code className={`rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_COLORS[r.action] ?? "bg-muted text-foreground"}`}>
          {r.action}
        </code>
      ),
    },
    { key: "entity", header: "Entity", cell: (r) => <span className="text-sm">{r.entity}</span> },
    { key: "entity_id", header: "Entity ID", cell: (r) => <code className="font-mono text-xs text-muted-foreground">{r.entity_id?.slice(0, 16) ?? "—"}</code>, hideBelow: "sm" },
    { key: "actor_email", header: "Actor", cell: (r) => <span className="text-sm">{r.actor_email ?? "system"}</span> },
    {
      key: "details",
      header: "Details",
      cell: (r) => {
        if (!r.details) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {Object.entries(r.details).slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(", ")}
          </span>
        );
      },
      hideBelow: "md",
    },
  ];

  if (authLoading) return <LoadingSkeleton rows={4} />;

  if (!canConfigure) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-600 dark:text-rose-400">
        Forbidden — admin access required to view the audit log.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configuration changes across analytics — who did what, when</p>
      </div>

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
      {loading && !entries.length && <LoadingSkeleton rows={6} />}

      <section aria-label="Audit entries">
        <SectionTitle title="Recent Activity" description={`${entries.length} entries`} />
        <DataTable
          columns={cols}
          rows={entries}
          rowKey={(r) => r.id}
          pageSize={20}
          initialSort={{ key: "created_at", dir: "desc" }}
          exportFilename="analytics-audit-log"
          emptyMessage="No audit entries yet — configuration changes will appear here."
        />
      </section>
    </div>
  );
}