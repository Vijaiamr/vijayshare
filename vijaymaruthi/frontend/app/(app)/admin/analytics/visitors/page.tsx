"use client";

/**
 * app/(app)/admin/analytics/visitors/page.tsx
 *
 * §70 — Visitors drill-down: every unique visitor behind the "Unique Visitors"
 * KPI. Identified visitors link to their profile; anonymous visitors link to
 * their sessions. Honors the global filters (range, segment, device, browser,
 * source) exactly like the dashboard so the count matches the KPI.
 */

import * as React from "react";
import Link from "next/link";
import { Search, Users, UserCheck, UserX, Flag, IndianRupee, X, Filter } from "lucide-react";
import { LoadingSkeleton, ErrorState, SectionTitle, EmptyState } from "@/components/admin/analytics/states";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDuration, screenName } from "@/lib/analytics/journey";

interface VisitorRow {
  key: string;
  user_id: string | null;
  email: string | null;
  anonymous_id: string | null;
  sessions: number;
  pageviews: number;
  activeSeconds: number;
  conversions: number;
  conversionValue: number;
  firstSeen: string | null;
  lastSeen: string | null;
  entryPage: string | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  latestSessionId: string | null;
}

interface VisitorsResponse {
  days: number;
  summary: {
    total: number;
    identified: number;
    anonymous: number;
    converted: number;
    revenue: number;
  };
  visitors: VisitorRow[];
}

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function VisitorsPage() {
  const [data, setData] = React.useState<VisitorsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [days, setDays] = React.useState(30);
  const [identifiedOnly, setIdentifiedOnly] = React.useState(false);
  const [convertedOnly, setConvertedOnly] = React.useState(false);
  const [debouncedQ, setDebouncedQ] = React.useState("");

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days), limit: "500" });
    if (debouncedQ) params.set("q", debouncedQ);
    if (identifiedOnly) params.set("identified", "1");
    if (convertedOnly) params.set("converted", "1");
    fetch(`/api/admin/analytics/visitors?${params.toString()}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debouncedQ, days, identifiedOnly, convertedOnly]);

  const rows = data?.visitors ?? [];
  const summary = data?.summary;

  const cols: Column<VisitorRow>[] = [
    {
      key: "email",
      header: "Visitor",
      cell: (r) =>
        r.user_id ? (
          <Link href={`/admin/analytics/users/${r.user_id}`} className="hover:underline">
            <span className="font-medium text-foreground">{r.email ?? "Identified user"}</span>
          </Link>
        ) : (
          <Link
            href={`/admin/analytics/sessions?q=${encodeURIComponent(r.anonymous_id ?? r.key)}`}
            className="hover:underline"
            title="Open this visitor's sessions"
          >
            <span className="text-muted-foreground">Anonymous visitor</span>
            <span className="ml-1.5 font-mono text-[0.65rem] text-muted-foreground/70">
              {r.anonymous_id ? r.anonymous_id.slice(0, 8) : r.key.slice(0, 8)}
            </span>
          </Link>
        ),
    },
    {
      key: "sessions",
      header: "Sessions",
      sortValue: (r) => r.sessions,
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.sessions}</span>,
    },
    {
      key: "pageviews",
      header: "Views",
      sortValue: (r) => r.pageviews,
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.pageviews}</span>,
    },
    {
      key: "activeSeconds",
      header: "Active",
      sortValue: (r) => r.activeSeconds,
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtDuration(r.activeSeconds)}</span>,
      hideBelow: "sm",
    },
    {
      key: "conversions",
      header: "Conv.",
      sortValue: (r) => r.conversions,
      align: "right",
      cell: (r) => (
        <span className={cn("tabular-nums", r.conversions > 0 ? "text-success" : "text-muted-foreground")}>
          {r.conversions}
        </span>
      ),
    },
    {
      key: "conversionValue",
      header: "Value",
      sortValue: (r) => r.conversionValue,
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{r.conversionValue > 0 ? `₹${r.conversionValue.toLocaleString()}` : "—"}</span>
      ),
      hideBelow: "md",
    },
    {
      key: "lastSeen",
      header: "Last seen",
      sortValue: (r) => (r.lastSeen ? new Date(r.lastSeen).getTime() : 0),
      cell: (r) => <span className="tabular-nums text-muted-foreground">{r.lastSeen ? fmtDateTime(r.lastSeen) : "—"}</span>,
      hideBelow: "md",
    },
    {
      key: "entryPage",
      header: "Entry",
      cell: (r) => <span className="text-muted-foreground">{r.entryPage ? screenName(r.entryPage) : "—"}</span>,
      hideBelow: "lg",
    },
    {
      key: "device",
      header: "Device",
      cell: (r) => <span className="text-muted-foreground">{r.device ?? "—"}</span>,
      hideBelow: "lg",
    },
    {
      key: "country",
      header: "Country",
      cell: (r) => <span className="text-muted-foreground">{r.country ?? "—"}</span>,
      hideBelow: "lg",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Visitors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every unique visitor behind the Unique Visitors KPI — who they are, how engaged they were, and what they converted.
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
              placeholder="Search by email or visitor id…"
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
            onClick={() => setIdentifiedOnly((c) => !c)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              identifiedOnly
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <UserCheck className="h-3.5 w-3.5" />
            Identified only
          </button>
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
              Showing visitors matching <span className="font-medium text-foreground">“{debouncedQ}”</span> in the last {days} days.
            </>
          ) : (
            <>Showing visitors from the last {days} days.</>
          )}
        </p>
      </section>

      {/* Summary strip */}
      {!loading && !error && summary && (
        <section aria-label="Visitor summary" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { icon: <Users className="h-3.5 w-3.5" />, label: "Unique Visitors", value: summary.total.toLocaleString() },
            { icon: <UserCheck className="h-3.5 w-3.5" />, label: "Identified", value: summary.identified.toLocaleString() },
            { icon: <UserX className="h-3.5 w-3.5" />, label: "Anonymous", value: summary.anonymous.toLocaleString() },
            { icon: <Flag className="h-3.5 w-3.5" />, label: "Converted", value: summary.converted.toLocaleString() },
            { icon: <IndianRupee className="h-3.5 w-3.5" />, label: "Revenue", value: `₹${summary.revenue.toLocaleString()}` },
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
        <section aria-label="Visitor results">
          <SectionTitle
            title="Visitors"
            description={`${rows.length} result${rows.length === 1 ? "" : "s"} · identified visitors open their profile, anonymous visitors open their sessions`}
          />
          <div className="mt-3">
            <DataTable
              columns={cols}
              rows={rows}
              rowKey={(r) => r.key}
              pageSize={20}
              initialSort={{ key: "lastSeen", dir: "desc" }}
              exportFilename={`visitors-${days}d${debouncedQ ? `-${debouncedQ.slice(0, 20)}` : ""}`}
              emptyMessage={
                debouncedQ || identifiedOnly || convertedOnly
                  ? "No visitors match the current search. Try a different term or widen the period."
                  : "No visitors recorded in this period yet."
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}