"use client";

/**
 * app/(app)/admin/analytics/events/page.tsx
 *
 * §70 — Event explorer: raw event stream with event-name filter and
 * breakdown, honoring the global filters.
 */

import * as React from "react";
import { AnalyticsFilterProvider, useAnalyticsFilters } from "@/components/admin/analytics/filter-context";
import { AnalyticsHeader } from "@/components/admin/analytics/header";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";
import { LoadingSkeleton, ErrorState, SectionTitle } from "@/components/admin/analytics/states";
import { buildQuery } from "@/lib/analytics/filters";
import { cn } from "@/lib/utils";

interface EventRow {
  id: string;
  event_name: string;
  page_path: string | null;
  events_at: string;
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
}

interface EventsData {
  days: number;
  breakdown: { name: string; count: number }[];
  total: number;
  events: EventRow[];
}

const EVENT_COLORS: Record<string, string> = {
  page_view: "bg-primary/10 text-primary",
  conversion: "bg-success/10 text-success",
  error: "bg-danger/10 text-danger",
  api_error: "bg-danger/10 text-danger",
  rage_click: "bg-warning/10 text-warning",
  dead_click: "bg-warning/10 text-warning",
  slow_interaction: "bg-warning/10 text-warning",
};

function EventBadge({ name }: { name: string }) {
  return (
    <code className={cn("rounded px-1.5 py-0.5 text-xs font-medium", EVENT_COLORS[name] ?? "bg-muted text-foreground")}>
      {name}
    </code>
  );
}

function EventsInner() {
  const { filters, days } = useAnalyticsFilters();
  const [data, setData] = React.useState<EventsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [eventFilter, setEventFilter] = React.useState<string>("");

  const fetchData = React.useCallback(
    async (signal?: AbortSignal, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const qs = buildQuery(filters);
        const suffix = qs ? `?${qs}` : "";
        const res = await fetch(`/api/admin/analytics/events${suffix}`, { signal });
        if (!res.ok) throw new Error(`${res.status}`);
        setData(await res.json());
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters],
  );

  React.useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  const cols: Column<EventRow>[] = [
    { key: "events_at", header: "Time", cell: (r) => <span className="tabular-nums">{new Date(r.events_at).toLocaleString()}</span> },
    { key: "event_name", header: "Event", cell: (r) => <EventBadge name={r.event_name} /> },
    { key: "page_path", header: "Page", cell: (r) => <code className="text-xs">{r.page_path ?? "—"}</code>, hideBelow: "sm" },
    {
      key: "user",
      header: "User",
      cell: (r) => {
        const label = r.user_id ?? r.anonymous_id ?? "—";
        return <span className="font-mono text-xs text-muted-foreground">{label.slice(0, 16)}</span>;
      },
      hideBelow: "md",
    },
    {
      key: "metadata",
      header: "Details",
      cell: (r) => {
        const keys = Object.keys(r.metadata ?? {});
        if (!keys.length) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {keys.slice(0, 3).map((k) => `${k}=${String(r.metadata[k]).slice(0, 24)}`).join(", ")}
          </span>
        );
      },
      hideBelow: "lg",
    },
  ];

  const filtered = eventFilter ? data?.events.filter((e) => e.event_name === eventFilter) ?? [] : data?.events ?? [];

  return (
    <div className="space-y-6">
      <AnalyticsHeader
        title="Event Explorer"
        description="Raw event stream with breakdown — honors the global filters"
        onRefresh={() => fetchData(undefined, true)}
        refreshing={refreshing}
        live
      />

      {error && <ErrorState message={error} onRetry={() => fetchData()} />}
      {loading && !data && <LoadingSkeleton rows={6} />}

      {data && (
        <>
          {/* Breakdown */}
          <section aria-label="Event breakdown" className="rounded-xl border border-border bg-surface p-4">
            <SectionTitle title="Event Breakdown" description={`${data.total.toLocaleString()} events in period`} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEventFilter("")}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  !eventFilter ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                All ({data.total.toLocaleString()})
              </button>
              {data.breakdown.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => setEventFilter(b.name)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    eventFilter === b.name ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {b.name} ({b.count.toLocaleString()})
                </button>
              ))}
            </div>
          </section>

          {/* Event stream */}
          <section aria-label="Event stream">
            <SectionTitle title="Event Stream" description={`${filtered.length} shown`} />
            <DataTable
              columns={cols}
              rows={filtered}
              rowKey={(r) => r.id}
              pageSize={20}
              initialSort={{ key: "events_at", dir: "desc" }}
              exportFilename={`events-${days}d${eventFilter ? `-${eventFilter}` : ""}`}
              emptyMessage="No events for the current filters."
            />
          </section>
        </>
      )}
    </div>
  );
}

export default function EventsPage() {
  return (
    <AnalyticsFilterProvider>
      <EventsInner />
    </AnalyticsFilterProvider>
  );
}