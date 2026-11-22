"use client";

/**
 * app/(app)/admin/analytics/sessions/[id]/page.tsx
 *
 * §69 — Session Journey: a complete, human-readable story of one session.
 *
 * Level 1 (human-readable): natural-language summary, statistics, entry/exit,
 * navigation path, chronological timeline, screens visited, time per screen,
 * scroll behavior, navigation behavior, replay, comparison.
 * Level 2 (technical): raw event log — hidden by default, expandable.
 */

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Route,
  User as UserIcon,
  Clock,
  MousePointerClick,
  ScrollText,
  Monitor,
  Globe,
  Calendar,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ClipboardList,
  PenLine,
  Activity,
  Repeat,
  CornerUpLeft,
  CornerUpRight,
  GitCompare,
  Eye,
  EyeOff,
  Shield,
  Sparkles,
  Timer,
  Layers,
  Flag,
  LogIn,
  LogOut,
  MapPin,
} from "lucide-react";
import { LoadingSkeleton, ErrorState, SectionTitle, EmptyState } from "@/components/admin/analytics/states";
import { DataTable, type Column } from "@/components/admin/analytics/data-table";
import { SessionReplay } from "@/components/admin/analytics/session-replay";
import { cn } from "@/lib/utils";
import {
  fmtClock,
  fmtDateTime,
  fmtDuration,
  screenName,
  type Journey,
  type JourneyAction,
  type JourneyEvent,
  type JourneyScreen,
  type JourneyScreenVisit,
  type JourneySessionMeta,
} from "@/lib/analytics/journey";

interface ComparisonSession {
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

interface SessionData {
  session: JourneySessionMeta;
  journey: Journey;
  comparison: ComparisonSession[];
}

/* ── Action icon mapping ── */
function ActionIcon({ name, className }: { name: string; className?: string }) {
  const cls = cn("h-3.5 w-3.5 shrink-0", className);
  switch (name) {
    case "click":
      return <MousePointerClick className={cls} />;
    case "dead_click":
      return <MousePointerClick className={cn(cls, "text-muted-foreground/60")} />;
    case "rage_click":
      return <AlertTriangle className={cn(cls, "text-warning")} />;
    case "form_start":
      return <ClipboardList className={cls} />;
    case "form_interact":
      return <PenLine className={cls} />;
    case "form_submit":
      return <CheckCircle2 className={cn(cls, "text-success")} />;
    case "form_abandon":
      return <XCircle className={cn(cls, "text-danger")} />;
    case "outbound_link":
      return <ExternalLink className={cls} />;
    case "download":
      return <Download className={cls} />;
    case "error":
      return <AlertTriangle className={cn(cls, "text-danger")} />;
    case "conversion":
      return <CheckCircle2 className={cn(cls, "text-success")} />;
    default:
      return <Activity className={cls} />;
  }
}

/* ── Level badge ── */
function LevelBadge({ level }: { level: 1 | 2 }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wider",
        level === 1 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      Level {level} · {level === 1 ? "Human-readable" : "Technical"}
    </span>
  );
}

/* ── Stat card ── */
function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
      <span className="text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-lg font-bold tabular-nums text-foreground">{value}</span>
      {hint && <span className="text-[0.68rem] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/* ── Entry / exit card ── */
function EntryExitCard({ journey }: { journey: Journey }) {
  const e = journey.entryExit;
  const items: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <LogIn className="h-3.5 w-3.5" />, label: "Entry", value: e.entryName ?? "—" },
    { icon: <LogOut className="h-3.5 w-3.5" />, label: "Exit", value: e.exitName ?? "—" },
    { icon: <MapPin className="h-3.5 w-3.5" />, label: "Referrer", value: e.referrerHost ?? (e.referrer ? e.referrer : "Direct / none") },
    { icon: <Flag className="h-3.5 w-3.5" />, label: "Campaign", value: e.campaign ?? "—" },
    { icon: <Monitor className="h-3.5 w-3.5" />, label: "Device", value: [e.device, e.browser, e.os].filter(Boolean).join(" · ") || "—" },
    { icon: <Globe className="h-3.5 w-3.5" />, label: "Country", value: e.country ?? "—" },
  ];
  return (
    <section aria-label="Entry and exit" className="rounded-xl border border-border bg-surface p-4">
      <SectionTitle
        title="Entry & Exit"
        description="How the visitor arrived and where they left"
        actions={<LevelBadge level={1} />}
      />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground">
              {it.icon} {it.label}
            </span>
            <span className="truncate text-sm font-medium text-foreground" title={it.value}>
              {it.value}
            </span>
          </div>
        ))}
      </div>
      {(e.source || e.medium) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Acquisition: <span className="font-medium text-foreground">{e.source ?? "direct"}</span>
          {e.medium ? ` via ${e.medium}` : ""}
          {e.campaign ? ` · campaign “${e.campaign}”` : ""}
        </p>
      )}
    </section>
  );
}

/* ── Navigation path visual ── */
function PathVisual({ journey }: { journey: Journey }) {
  const path = journey.path;
  if (path.length === 0) return <EmptyState message="No page views recorded for this session." />;
  return (
    <section aria-label="Navigation path" className="rounded-xl border border-border bg-surface p-4">
      <SectionTitle
        title="Navigation Path"
        description="The route the visitor took, with time spent on each screen"
        actions={<LevelBadge level={1} />}
      />
      <div className="mt-4 flex flex-wrap items-center gap-y-3">
        {path.map((node, i) => (
          <React.Fragment key={`${node.path}-${i}`}>
            {i > 0 && (
              <span className="mx-1 flex items-center gap-0.5 text-muted-foreground" aria-hidden>
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                  node.revisit
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-border bg-muted/60 text-foreground",
                )}
                title={node.path}
              >
                {node.name}
              </span>
              <span className="text-[0.65rem] tabular-nums text-muted-foreground">
                {fmtDuration(node.durationSeconds)}
                {node.revisit ? " · revisit" : ""}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

/* ── Timeline ── */
function TimelineSection({ journey }: { journey: Journey }) {
  const steps = journey.timeline;
  return (
    <section aria-label="Session timeline" className="rounded-xl border border-border bg-surface p-4">
      <SectionTitle
        title="Session Timeline"
        description="Every screen and action, in order — with time spent and scroll depth"
        actions={<LevelBadge level={1} />}
      />
      <ol className="mt-4 space-y-0">
        {steps.map((step, i) => {
          if (step.kind === "start") {
            return (
              <li key={`start-${i}`} className="relative flex gap-3 pb-4">
                <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/20 ring-4 ring-success/10">
                  <span className="h-2 w-2 rounded-full bg-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{step.label}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(step.at)}</p>
                </div>
              </li>
            );
          }
          if (step.kind === "end") {
            return (
              <li key={`end-${i}`} className="relative flex gap-3 pt-1">
                <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted ring-4 ring-muted/30">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{step.label}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(step.at)}</p>
                </div>
              </li>
            );
          }
          return <TimelineScreen key={`screen-${i}`} visit={step.visit} />;
        })}
      </ol>
    </section>
  );
}

function TimelineScreen({ visit }: { visit: JourneyScreenVisit }) {
  return (
    <li className="relative flex gap-3 pb-5">
      {/* rail */}
      <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />
      <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 ring-4 ring-primary/10">
        <span className="h-2 w-2 rounded-full bg-primary" />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-background/50 p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{visit.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground">
            {visit.path}
          </code>
          <span className="text-xs tabular-nums text-muted-foreground">{fmtClock(visit.at)}</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium tabular-nums text-foreground">
            <Timer className="h-3 w-3 text-muted-foreground" />
            {fmtDuration(visit.totalSeconds)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Activity className="h-3 w-3" /> Active {fmtDuration(visit.activeSeconds)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> Idle {fmtDuration(visit.idleSeconds)}
          </span>
          {visit.maxScrollDepth > 0 && (
            <span className="inline-flex items-center gap-1">
              <ScrollText className="h-3 w-3" /> Scrolled to {visit.maxScrollDepth}%
            </span>
          )}
          {visit.prevScreen && (
            <span className="inline-flex items-center gap-1">
              <CornerUpLeft className="h-3 w-3" /> From {screenName(visit.prevScreen)}
            </span>
          )}
          {visit.nextScreen && (
            <span className="inline-flex items-center gap-1">
              <CornerUpRight className="h-3 w-3" /> To {screenName(visit.nextScreen)}
            </span>
          )}
        </div>

        {visit.actions.length > 0 && (
          <ul className="mt-2.5 space-y-1 border-t border-border/60 pt-2.5">
            {visit.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <ActionIcon name={a.eventName} className="mt-0.5" />
                <span className="min-w-0 flex-1">{a.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">{fmtClock(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/* ── Screens visited ── */
function ScreensSection({ journey }: { journey: Journey }) {
  const screens = journey.screens;
  const cols: Column<JourneyScreen>[] = [
    {
      key: "name",
      header: "Screen",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{r.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">{r.path}</code>
          {r.isEntry && <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-success">Entry</span>}
          {r.isExit && <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-danger">Exit</span>}
        </div>
      ),
    },
    { key: "visits", header: "Visits", sortValue: (r) => r.visits, align: "right", cell: (r) => <span className="tabular-nums">{r.visits}</span> },
    { key: "totalSeconds", header: "Total Time", sortValue: (r) => r.totalSeconds, align: "right", cell: (r) => <span className="tabular-nums">{fmtDuration(r.totalSeconds)}</span> },
    { key: "activeSeconds", header: "Active", sortValue: (r) => r.activeSeconds, align: "right", cell: (r) => <span className="tabular-nums">{fmtDuration(r.activeSeconds)}</span>, hideBelow: "sm" },
    { key: "maxScrollDepth", header: "Max Scroll", sortValue: (r) => r.maxScrollDepth, align: "right", cell: (r) => <span className="tabular-nums">{r.maxScrollDepth > 0 ? `${r.maxScrollDepth}%` : "—"}</span>, hideBelow: "sm" },
    { key: "actionCount", header: "Actions", sortValue: (r) => r.actionCount, align: "right", cell: (r) => <span className="tabular-nums">{r.actionCount}</span>, hideBelow: "md" },
    { key: "firstVisitAt", header: "First Visit", cell: (r) => <span className="tabular-nums text-muted-foreground">{fmtDateTime(r.firstVisitAt)}</span>, hideBelow: "md" },
  ];
  return (
    <section aria-label="Screens visited">
      <SectionTitle
        title="Screens Visited"
        description={`${screens.length} unique screen${screens.length === 1 ? "" : "s"} · time spent per screen`}
        actions={<LevelBadge level={1} />}
      />
      <div className="mt-3">
        <DataTable
          columns={cols}
          rows={screens}
          rowKey={(r) => r.path}
          pageSize={10}
          initialSort={{ key: "totalSeconds", dir: "desc" }}
          emptyMessage="No screens recorded for this session."
        />
      </div>
    </section>
  );
}

/* ── Scroll behavior ── */
function ScrollSection({ journey }: { journey: Journey }) {
  const visits = journey.timeline.filter((s): s is Extract<typeof s, { kind: "screen" }> => s.kind === "screen").map((s) => s.visit);
  const withScroll = visits.filter((v) => v.maxScrollDepth > 0);
  if (withScroll.length === 0) {
    return (
      <section aria-label="Scroll behavior" className="rounded-xl border border-border bg-surface p-4">
        <SectionTitle title="Scroll Behavior" description="How far the visitor scrolled on each screen" actions={<LevelBadge level={1} />} />
        <div className="mt-3">
          <EmptyState message="No scroll activity recorded in this session." />
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Scroll behavior" className="rounded-xl border border-border bg-surface p-4">
      <SectionTitle title="Scroll Behavior" description="Maximum depth reached and time to each threshold" actions={<LevelBadge level={1} />} />
      <div className="mt-4 space-y-3">
        {withScroll.map((v, i) => (
          <div key={`${v.path}-${i}`} className="rounded-lg border border-border bg-background/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{v.name}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">{v.path}</code>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">max {v.maxScrollDepth}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${v.maxScrollDepth}%` }} />
            </div>
            {v.scrollThresholds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {v.scrollThresholds.map((t, j) => (
                  <span key={j} className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] tabular-nums text-muted-foreground">
                    {t.depth}% in {fmtDuration(t.secondsFromVisit)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Navigation behavior ── */
function NavigationSection({ journey }: { journey: Journey }) {
  const nav = journey.navigation;
  const hasData = nav.backNavigations > 0 || nav.forwardNavigations > 0 || nav.revisits.length > 0 || nav.loops.length > 0;
  return (
    <section aria-label="Navigation behavior" className="rounded-xl border border-border bg-surface p-4">
      <SectionTitle title="Navigation Behavior" description="Back / forward moves, revisits and loops" actions={<LevelBadge level={1} />} />
      {!hasData ? (
        <div className="mt-3">
          <EmptyState message="The visitor moved forward through the screens without revisiting any." />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CornerUpLeft className="h-4 w-4 text-muted-foreground" /> Back navigations
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{nav.backNavigations}</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CornerUpRight className="h-4 w-4 text-muted-foreground" /> Forward navigations
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{nav.forwardNavigations}</span>
            </div>
            {nav.loops.length > 0 && (
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Repeat className="h-4 w-4 text-warning" /> Loops
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                  {nav.loops.map((l) => `${l.name} ×${l.count}`).join(", ")}
                </span>
              </div>
            )}
          </div>
          <div>
            <p className="text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground">Revisits</p>
            {nav.revisits.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No screens were revisited.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {nav.revisits.slice(0, 6).map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Repeat className="h-3 w-3 shrink-0" />
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span>returned after {fmtDuration(r.returnedAfterSeconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Comparison ── */
function ComparisonSection({ comparison }: { comparison: ComparisonSession[] }) {
  if (comparison.length === 0) return null;
  return (
    <section aria-label="Session comparison">
      <SectionTitle
        title="Compare with Other Sessions"
        description={`${comparison.length} other session${comparison.length === 1 ? "" : "s"} from the same visitor`}
        actions={<LevelBadge level={1} />}
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {comparison.map((c) => (
          <Link
            key={c.id}
            href={`/admin/analytics/sessions/${c.id}`}
            className="group rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span className="tabular-nums">{fmtDateTime(c.started_at)}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="font-medium text-foreground">{screenName(c.entry_page)}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">{screenName(c.exit_page)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
              <span className="tabular-nums">{fmtDuration(c.active_seconds)} active</span>
              <span className="tabular-nums">{c.page_views} views</span>
              {c.conversions > 0 && <span className="tabular-nums text-success">{c.conversions} conv.</span>}
              <span>{c.device ?? "—"}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── Technical event log (Level 2, hidden by default) ── */
function EventLogSection({ events }: { events: JourneyEvent[] }) {
  const [open, setOpen] = React.useState(false);
  const cols: Column<JourneyEvent>[] = [
    { key: "events_at", header: "Time", cell: (r) => <span className="tabular-nums">{fmtClock(r.events_at)}</span> },
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
    <section aria-label="Technical event log" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
            <Shield className="h-4 w-4 text-muted-foreground" />
            Technical Event Log
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {events.length} raw events · hidden by default · passwords, form values and payment data are never captured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LevelBadge level={2} />
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {open ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {open ? "Hide" : "Show"} event log
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3">
          <DataTable
            columns={cols}
            rows={events}
            rowKey={(r) => r.id}
            pageSize={20}
            exportFilename={`session-${events[0]?.id?.slice(0, 8) ?? "events"}-log`}
            emptyMessage="No events recorded for this session."
          />
        </div>
      )}
    </section>
  );
}

/* ── Main page ── */
export default function SessionJourneyPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = React.useState<SessionData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics/sessions/${id}`, { signal: ctrl.signal })
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

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/analytics" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Behavior
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Session Journey</h1>
          <LevelBadge level={1} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {data ? `${fmtDateTime(data.session.started_at)} · ${data.session.id.slice(0, 8)}` : id}
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
      {loading && !data && <LoadingSkeleton rows={6} />}

      {data && (
        <>
          {/* Natural-language summary */}
          <section aria-label="Session summary" className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-surface p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.68rem] font-medium uppercase tracking-wider text-primary">Session Summary</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground">{data.journey.summary.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {data.session.user_id ? (
                    <Link href={`/admin/analytics/users/${data.session.user_id}`} className="inline-flex items-center gap-1 hover:underline">
                      <UserIcon className="h-3 w-3" /> View user profile
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" /> Anonymous visitor
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {fmtDateTime(data.session.started_at)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Route className="h-3 w-3" /> {data.journey.stats.screensVisited} screens
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Statistics */}
          <section aria-label="Session statistics">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard label="Duration" value={fmtDuration(data.journey.stats.durationSeconds)} hint="wall-clock" />
              <StatCard label="Active Time" value={fmtDuration(data.session.active_seconds)} hint="tracked activity" />
              <StatCard label="Screens" value={data.journey.stats.screensVisited.toLocaleString()} hint={`${data.session.page_views} page views`} />
              <StatCard label="Interactions" value={data.journey.stats.interactions.toLocaleString()} hint="clicks, forms, links" />
              <StatCard label="Avg / Screen" value={fmtDuration(data.journey.stats.avgScreenSeconds)} hint="across screens" />
              <StatCard label="Returning Screens" value={data.journey.stats.returningScreens.toLocaleString()} hint="visited more than once" />
              <StatCard label="Max Scroll" value={data.journey.stats.maxScrollDepth > 0 ? `${data.journey.stats.maxScrollDepth}%` : "—"} hint="deepest page depth" />
              <StatCard
                label="Conversions"
                value={data.journey.stats.conversions.toLocaleString()}
                hint={data.journey.stats.conversionValue > 0 ? `₹${data.journey.stats.conversionValue.toLocaleString()} value` : "no revenue"}
              />
            </div>
          </section>

          <EntryExitCard journey={data.journey} />
          <PathVisual journey={data.journey} />
          <SessionReplay steps={data.journey.timeline} />
          <TimelineSection journey={data.journey} />
          <ScreensSection journey={data.journey} />
          <ScrollSection journey={data.journey} />
          <NavigationSection journey={data.journey} />
          <ComparisonSection comparison={data.comparison} />
          <EventLogSection events={data.journey.eventLog} />
        </>
      )}
    </div>
  );
}