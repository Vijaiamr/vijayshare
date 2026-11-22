"use client";

/**
 * app/(app)/admin/analytics/sessions/page.tsx
 *
 * §70 — Session search: find historical sessions by person, date, screen,
 * campaign, source, device or conversion, then open the full Session Journey.
 */

import * as React from "react";
import Link from "next/link";
import { Search, Calendar, Monitor, Globe, Flag, Repeat, Filter, X } from "lucide-react";
import { LoadingSkeleton, ErrorState, SectionTitle, EmptyState } from "@/components/admin/analytics/states";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDuration, screenName } from "@/lib/analytics/journey";

interface SessionRow {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  started_at: string;
  last_seen_at: string;
  entry_page: string | null;
  exit_page: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  page_views: number;
  active_seconds: number;
  conversions: number;
  conversion_value: number;
}

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function SessionsPage() {
  const [rows, setRows] = React.useState<SessionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [days, setDays] = React.useState(30);
  const [convertedOnly, setConvertedOnly] = React.useState(false);
  const [debouncedQ, setDebouncedQ] = React.useState("");

  // Support deep links (e.g. from the Visitors page): prefill the search box
  // from ?q= on first mount.
  React.useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) setQ(initial);
  }, []);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days), limit: "100" });
    if (debouncedQ) params.set("q", debouncedQ);
    if (convertedOnly) params.set("converted", "1");
    fetch(`/api/admin/analytics/sessions?${params.toString()}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => setRows(d.sessions ?? []))
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debouncedQ, days, convertedOnly]);

  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.conversion_value, 0);
  const totalViews = rows.reduce((s, r) => s + r.page_views, 0);

  const cols: Column<SessionRow>[] = [
    {
      key: "started_at",
      header: "Started",
      sortValue: (r) => new Date(r.started_at).getTime(),
      cell: (r) => (
        <Link href={`/admin/analytics/sessions/${r.id}`} className="hover:underline">
          <span className="tabular-nums">{fmtDateTime(r.started_at)}</span>
        </Link>
      ),
    },
    {
      key: "entry_page",
      header: "Journey",
      cell: (r) => (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-foreground">{screenName(r.entry_page)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium text-foreground">{screenName(r.exit_page)}</span>
        </div>
      ),
    },
    { key: "page_views", header: "Views", sortValue: (r) => r.page_views, align: "right", cell: (r) => <span className="tabular-nums">{r.page_views}</span> },
    { key: "active_seconds", header: "Active", sortValue: (r) => r.active_seconds, align: "right", cell: (r) => <span className="tabular-nums">{fmtDuration(r.active_seconds)}</span>, hideBelow: "sm" },
    { key: "conversions", header: "Conv.", sortValue: (r) => r.conversions, align: "right", cell: (r) => <span className={cn("tabular-nums", r.conversions > 0 ? "text-success" : "text-muted-foreground")}>{r.conversions}</span> },
    { key: "conversion_value", header: "Value", sortValue: (r) => r.conversion_value, align: "right", cell: (r) => <span className="tabular-nums">{r.conversion_value > 0 ? `₹${r.conversion_value.toLocaleString()}` : "—"}</span>, hideBelow: "md" },
    { key: "source", header: "Source", cell: (r) => <span className="text-muted-foreground">{r.source ?? "direct"}</span>, hideBelow: "md" },
    { key: "campaign", header: "Campaign", cell: (r) => <span className="text-muted-foreground">{r.campaign ?? "—"}</span>, hideBelow: "lg" },
    { key: "device", header: "Device", cell: (r) => <span className="text-muted-foreground">{r.device ?? "—"}</span>, hideBelow: "lg" },
    { key: "country", header: "Country", cell: (r) => <span className="text-muted-foreground">{r.country ?? "—"}</span>, hideBelow: "lg" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Session Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find any historical session by person, screen, campaign, source, device or conversion — then open its full journey.
        </p>
      </div>

      {/* Search + filters */}
      <section aria-label="Search filters" className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search screens, campaigns, sources, devices, emails…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                  days === p.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setConvertedOnly((c) => !c)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              convertedOnly
                ? "border-success/40 bg-success/10 text-success"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            Converted only
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {debouncedQ ? (
            <>
              Showing sessions matching <span className="font-medium text-foreground">“{debouncedQ}”</span> in the last {days} days.
            </>
          ) : (
            <>Showing sessions from the last {days} days.</>
          )}
        </p>
      </section>

      {/* Summary strip */}
      {!loading && !error && rows.length > 0 && (
        <section aria-label="Search summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: <Calendar className="h-3.5 w-3.5" />, label: "Sessions", value: rows.length.toLocaleString() },
            { icon: <Repeat className="h-3.5 w-3.5" />, label: "Page Views", value: totalViews.toLocaleString() },
            { icon: <Flag className="h-3.5 w-3.5" />, label: "Conversions", value: totalConversions.toLocaleString() },
            { icon: <Monitor className="h-3.5 w-3.5" />, label: "Revenue", value: `₹${totalRevenue.toLocaleString()}` },
          ].map((m) => (
            <div key={m.label} className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">{m.icon}</span>
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">{m.label}</p>
                <p className="text-base font-bold tabular-nums text-foreground">{m.value}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
      {loading && <LoadingSkeleton rows={6} />}

      {!loading && !error && (
        <section aria-label="Session results">
          <SectionTitle title="Sessions" description={`${rows.length} result${rows.length === 1 ? "" : "s"} · click a session to open its journey`} />
          <div className="mt-3">
            <DataTable
              columns={cols}
              rows={rows}
              rowKey={(r) => r.id}
              pageSize={20}
              initialSort={{ key: "started_at", dir: "desc" }}
              exportFilename={`sessions-${days}d${debouncedQ ? `-${debouncedQ.slice(0, 20)}` : ""}`}
              emptyMessage={
                debouncedQ || convertedOnly
                  ? "No sessions match the current search. Try a different term or widen the period."
                  : "No sessions recorded in this period yet."
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}