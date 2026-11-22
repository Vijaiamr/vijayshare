"use client";

/**
 * app/(app)/admin/analytics/users/[id]/page.tsx
 *
 * §68 — User profile drill-down: identity, lifetime summary, sessions,
 * event timeline, conversions and errors.
 */

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, User as UserIcon, Mail, Calendar, Monitor, Globe, ExternalLink } from "lucide-react";
import { LoadingSkeleton, ErrorState, SectionTitle, EmptyState } from "@/components/admin/analytics/states";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";
import { fmtDuration, screenName } from "@/lib/analytics/journey";

interface SessionRow {
  id: string;
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

interface EventRow {
  id: string;
  event_name: string;
  page_path: string | null;
  events_at: string;
  metadata: Record<string, unknown>;
}

interface UserProfileData {
  id: string;
  identity: {
    email: string | null;
    role: string | null;
    accountCreated: string | null;
    anonymousId: string | null;
  };
  summary: {
    sessions: number;
    pageviews: number;
    activeSeconds: number;
    conversions: number;
    revenue: number;
    firstSeen: string | null;
    lastSeen: string | null;
    devices: string[];
    countries: string[];
  };
  sessions: SessionRow[];
  events: EventRow[];
  conversions: { at: string; page: string | null; goal: string; value: number }[];
  errors: { at: string; page: string | null; message: string }[];
}

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = React.useState<UserProfileData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics/users/${id}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [id]);

  const sessionCols: Column<SessionRow>[] = [
    {
      key: "started_at",
      header: "Started",
      cell: (r) => (
        <Link href={`/admin/analytics/sessions/${r.id}`} className="hover:underline">
          {new Date(r.started_at).toLocaleString()}
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
    { key: "conversions", header: "Conv.", sortValue: (r) => r.conversions, align: "right", cell: (r) => <span className="tabular-nums text-success">{r.conversions}</span> },
    { key: "conversion_value", header: "Value", sortValue: (r) => r.conversion_value, align: "right", cell: (r) => <span className="tabular-nums">₹{r.conversion_value.toLocaleString()}</span>, hideBelow: "md" },
    { key: "device", header: "Device", cell: (r) => <span className="text-muted-foreground">{r.device ?? "—"}</span>, hideBelow: "lg" },
  ];

  const eventCols: Column<EventRow>[] = [
    { key: "events_at", header: "Time", cell: (r) => <span className="tabular-nums">{new Date(r.events_at).toLocaleString()}</span> },
    { key: "event_name", header: "Event", cell: (r) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.event_name}</code> },
    { key: "page_path", header: "Page", cell: (r) => <code className="text-xs">{r.page_path ?? "—"}</code>, hideBelow: "sm" },
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
      hideBelow: "md",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/analytics" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Behavior
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">User Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Drill-down for {id}</p>
      </div>

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
      {loading && !data && <LoadingSkeleton rows={6} />}

      {data && (
        <>
          {/* Identity */}
          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">{data.identity.email ?? "Anonymous visitor"}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {data.identity.role && (
                    <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {data.identity.role}</span>
                  )}
                  {data.identity.accountCreated && (
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Joined {new Date(data.identity.accountCreated).toLocaleDateString()}</span>
                  )}
                  {data.summary.devices.length > 0 && (
                    <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" /> {data.summary.devices.join(", ")}</span>
                  )}
                  {data.summary.countries.length > 0 && (
                    <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {data.summary.countries.join(", ")}</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Summary */}
          <section aria-label="Lifetime summary">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {[
                { label: "Sessions", value: data.summary.sessions.toLocaleString() },
                { label: "Pageviews", value: data.summary.pageviews.toLocaleString() },
                { label: "Active Time", value: fmtDuration(data.summary.activeSeconds) },
                { label: "Conversions", value: data.summary.conversions.toLocaleString() },
                { label: "Revenue", value: `₹${data.summary.revenue.toLocaleString()}` },
                { label: "First Seen", value: data.summary.firstSeen ? new Date(data.summary.firstSeen).toLocaleDateString() : "—" },
              ].map((m) => (
                <div key={m.label} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
                  <span className="text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground">{m.label}</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">{m.value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Sessions */}
          <section aria-label="Sessions">
            <SectionTitle
              title="Sessions"
              description={`${data.sessions.length} most recent · each opens the full Session Journey`}
              actions={
                <Link
                  href={`/admin/analytics/sessions?user=${id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View all sessions
                </Link>
              }
            />
            <DataTable
              columns={sessionCols}
              rows={data.sessions}
              rowKey={(r) => r.id}
              pageSize={10}
              initialSort={{ key: "started_at", dir: "desc" }}
              exportFilename={`user-${id.slice(0, 8)}-sessions`}
              emptyMessage="No sessions for this user."
            />
          </section>

          {/* Conversions */}
          <section aria-label="Conversions">
            <SectionTitle title="Conversions" description={`${data.conversions.length} conversion events`} />
            {data.conversions.length === 0 ? (
              <EmptyState message="No conversions for this user." />
            ) : (
              <DataTable
                columns={[
                  { key: "at", header: "Time", cell: (r) => <span className="tabular-nums">{new Date(r.at).toLocaleString()}</span> },
                  { key: "goal", header: "Goal", cell: (r) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.goal}</code> },
                  { key: "page", header: "Page", cell: (r) => <code className="text-xs">{r.page ?? "—"}</code> },
                  { key: "value", header: "Value", sortValue: (r) => r.value, align: "right", cell: (r) => <span className="tabular-nums text-success">₹{r.value.toLocaleString()}</span> },
                ]}
                rows={data.conversions}
                rowKey={(r) => `${r.at}-${r.goal}`}
                pageSize={10}
                exportFilename={`user-${id.slice(0, 8)}-conversions`}
              />
            )}
          </section>

          {/* Errors */}
          <section aria-label="Errors">
            <SectionTitle title="Errors" description={`${data.errors.length} error events`} />
            {data.errors.length === 0 ? (
              <EmptyState message="No errors for this user." />
            ) : (
              <DataTable
                columns={[
                  { key: "at", header: "Time", cell: (r) => <span className="tabular-nums">{new Date(r.at).toLocaleString()}</span> },
                  { key: "page", header: "Page", cell: (r) => <code className="text-xs">{r.page ?? "—"}</code> },
                  { key: "message", header: "Message", cell: (r) => <span className="text-xs text-danger">{r.message}</span> },
                ]}
                rows={data.errors}
                rowKey={(r) => `${r.at}-${r.message}`}
                pageSize={10}
                exportFilename={`user-${id.slice(0, 8)}-errors`}
              />
            )}
          </section>

          {/* Event timeline */}
          <section aria-label="Event timeline">
            <SectionTitle title="Event Timeline" description={`${data.events.length} most recent events`} />
            <DataTable
              columns={eventCols}
              rows={data.events}
              rowKey={(r) => r.id}
              pageSize={15}
              initialSort={{ key: "events_at", dir: "desc" }}
              exportFilename={`user-${id.slice(0, 8)}-events`}
              emptyMessage="No events for this user."
            />
          </section>
        </>
      )}
    </div>
  );
}