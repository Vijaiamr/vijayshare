/**
 * lib/analytics/journey.ts
 *
 * Session Journey engine — turns raw analytics events into a complete,
 * human-readable story of a single session:
 *
 *   • chronological timeline (screens + actions + scroll + time)
 *   • screens visited (aggregated per screen)
 *   • human-readable action labels (Level 1) vs raw events (Level 2)
 *   • time spent per screen (total / active / idle)
 *   • navigation path with revisits, back/forward and loops
 *   • scroll behavior (max depth + time-to-threshold)
 *   • natural-language session summary
 *   • session statistics
 *   • entry / exit (landing, referrer, campaign, UTM)
 *   • raw technical event log
 *
 * Pure functions — no server dependencies, unit-testable.
 */

export interface JourneyEvent {
  id: string;
  event_name: string;
  page_path: string | null;
  events_at: string;
  metadata: Record<string, unknown>;
  referrer?: string | null;
}

export interface JourneySessionMeta {
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
  os: string | null;
  country: string | null;
  page_views: number;
  active_seconds: number;
  conversions: number;
  conversion_value: number;
}

/* ─────────────────────────────────────────────────────────────────────
   Human-readable labels
   ───────────────────────────────────────────────────────────────────── */

const SCREEN_NAMES: Record<string, string> = {
  "/": "Home",
  "/market": "Market",
  "/portfolio": "Portfolio",
  "/analytics": "Analytics",
  "/convolution": "Convolution",
  "/pilot": "Pilot",
  "/pilot/aiops": "AI Ops",
  "/backtest": "Backtest",
  "/pattern-backtest": "Pattern Backtest",
  "/charts": "Charts",
  "/calculator": "Calculator",
  "/ledger": "Ledger",
  "/settings": "Settings",
  "/about": "About",
  "/login": "Login",
  "/signup": "Sign Up",
  "/admin": "Admin",
  "/admin/users": "Admin · Users",
  "/admin/analytics": "Admin Analytics · Behavior",
  "/admin/analytics/exec": "Admin Analytics · Executive",
  "/admin/analytics/events": "Admin Analytics · Events",
  "/admin/analytics/realtime": "Admin Analytics · Real-time",
  "/admin/analytics/funnels": "Admin Analytics · Funnels",
  "/admin/analytics/journeys": "Admin Analytics · Journeys",
  "/admin/analytics/campaigns": "Admin Analytics · Campaigns",
  "/admin/analytics/attribution": "Admin Analytics · Attribution",
  "/admin/analytics/audiences": "Admin Analytics · Audiences",
  "/admin/analytics/ux": "Admin Analytics · UX & Errors",
  "/admin/analytics/replay": "Admin Analytics · Replay",
  "/admin/analytics/insights": "Admin Analytics · AI Insights",
  "/admin/analytics/revenue": "Admin Analytics · Revenue",
  "/admin/analytics/alerts": "Admin Analytics · Alerts",
  "/admin/analytics/audit": "Admin Analytics · Audit",
  "/admin/analytics/sessions": "Admin Analytics · Sessions",
};

/** Map a page path to a friendly screen name. */
export function screenName(path: string | null | undefined): string {
  if (!path) return "Unknown screen";
  const exact = SCREEN_NAMES[path];
  if (exact) return exact;
  if (path.startsWith("/stock/")) {
    const sym = path.slice("/stock/".length).split("/")[0].toUpperCase();
    return sym ? `Stock · ${sym}` : "Stock Analysis";
  }
  if (path.startsWith("/admin/analytics/")) {
    const rest = path.slice("/admin/analytics/".length).replace(/\/$/, "");
    if (!rest) return "Admin Analytics";
    const seg = rest.split("/")[0];
    return `Admin Analytics · ${seg.charAt(0).toUpperCase() + seg.slice(1)}`;
  }
  if (path.startsWith("/admin/")) {
    const rest = path.slice("/admin/".length).replace(/\/$/, "");
    if (!rest) return "Admin";
    const seg = rest.split("/")[0];
    return `Admin · ${seg.charAt(0).toUpperCase() + seg.slice(1)}`;
  }
  const cleaned = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (cleaned.length === 0) return "Home";
  return cleaned
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" · ");
}

/** Format seconds as a compact human duration ("2m 30s", "45s"). */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min ? `${h}h ${min}m` : `${h}h`;
}

/** Format a clock time ("14:32:05"). */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Format a date + time ("Sep 19, 14:32"). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cleanText(v: unknown, max = 60): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function hostOf(v: unknown): string {
  if (typeof v !== "string") return "";
  try {
    return new URL(v).host.replace(/^www\./, "");
  } catch {
    return v.slice(0, 40);
  }
}

function clickLabel(m: Record<string, unknown>): string {
  const text = cleanText(m.text);
  if (text) return `"${text}"`;
  if (typeof m.id === "string" && m.id) return `#${m.id}`;
  const href = hostOf(m.href);
  if (href) return href;
  if (typeof m.tag === "string" && m.tag) return `<${m.tag}>`;
  return "";
}

function fieldLabel(v: unknown): string {
  if (typeof v !== "string" || !v) return "form";
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map a raw event to a human-readable action sentence (Level 1). */
export function humanizeEvent(ev: JourneyEvent): string {
  const m = ev.metadata ?? {};
  switch (ev.event_name) {
    case "page_view":
      return `Opened ${screenName(ev.page_path)}`;
    case "time_spent":
      return `Active for ${fmtDuration(Number(m.seconds) || 0)}`;
    case "click": {
      const label = clickLabel(m);
      return label ? `Clicked ${label}` : "Clicked an element";
    }
    case "dead_click":
      return `Clicked a non-interactive area${clickLabel(m) ? ` (${clickLabel(m)})` : ""}`;
    case "rage_click":
      return `Clicked repeatedly on ${clickLabel(m) || "an element"}`;
    case "scroll":
      return `Scrolled to ${m.depth}% of the page`;
    case "form_start":
      return "Started filling a form";
    case "form_interact":
      return `Interacted with the ${fieldLabel(m.field)} field`;
    case "form_submit":
      return "Submitted a form";
    case "form_abandon":
      return "Left a form incomplete";
    case "outbound_link":
      return `Opened external link ${hostOf(m.href) || ""}`.trim();
    case "download":
      return `Downloaded ${cleanText(m.filename, 40) || "a file"}`;
    case "error": {
      const msg = cleanText(m.message, 80);
      return msg ? `Encountered an error: ${msg}` : "Encountered an error";
    }
    case "conversion":
      return `Completed a conversion${m.goal ? ` (${cleanText(m.goal, 40)})` : ""}`;
    case "stock_analyzed":
      return `Ran a full analysis on ${cleanText(m.symbol, 20) || "a stock"}`;
    case "session_start":
      return "Session started";
    case "cwv":
      return `Measured web performance (${cleanText(m.name, 30) || "metric"})`;
    default:
      return ev.event_name.replace(/_/g, " ");
  }
}

/** Whether an event is a meaningful user action (shown in the journey). */
export function isActionEvent(name: string): boolean {
  return !["page_view", "time_spent", "session_start", "cwv"].includes(name);
}

/* ─────────────────────────────────────────────────────────────────────
   Journey structures
   ───────────────────────────────────────────────────────────────────── */

export interface JourneyAction {
  at: string;
  label: string;
  eventName: string;
  metadata: Record<string, unknown>;
}

export interface ScrollThreshold {
  depth: number;
  at: string;
  /** Seconds from the screen visit to reaching this depth. */
  secondsFromVisit: number;
}

export interface JourneyScreenVisit {
  path: string;
  name: string;
  at: string;
  /** Wall-clock duration until the next screen (or session end). */
  totalSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  maxScrollDepth: number;
  scrollThresholds: ScrollThreshold[];
  actions: JourneyAction[];
  prevScreen: string | null;
  nextScreen: string | null;
}

export type JourneyStep =
  | { kind: "start"; at: string; label: string }
  | { kind: "screen"; at: string; visit: JourneyScreenVisit }
  | { kind: "end"; at: string; label: string };

export interface JourneyScreen {
  path: string;
  name: string;
  visits: number;
  totalSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  firstVisitAt: string;
  lastVisitAt: string;
  isEntry: boolean;
  isExit: boolean;
  maxScrollDepth: number;
  actionCount: number;
}

export interface JourneyPathNode {
  path: string;
  name: string;
  at: string;
  durationSeconds: number;
  revisit: boolean;
}

export interface JourneyRevisit {
  path: string;
  name: string;
  at: string;
  returnedAfterSeconds: number;
}

export interface JourneyLoop {
  path: string;
  name: string;
  count: number;
}

export interface JourneyNavigation {
  backNavigations: number;
  forwardNavigations: number;
  revisits: JourneyRevisit[];
  loops: JourneyLoop[];
}

export interface JourneyEntryExit {
  entryPage: string | null;
  entryName: string | null;
  entryAt: string | null;
  exitPage: string | null;
  exitName: string | null;
  exitAt: string | null;
  referrer: string | null;
  referrerHost: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
}

export interface JourneyStats {
  durationSeconds: number;
  screensVisited: number;
  interactions: number;
  returningScreens: number;
  avgScreenSeconds: number;
  maxScrollDepth: number;
  conversions: number;
  conversionValue: number;
}

export interface JourneySummary {
  text: string;
  personName: string;
  durationSeconds: number;
  screensCount: number;
  mostTimeScreen: string | null;
  interactions: number;
  conversions: number;
  entryScreen: string | null;
  exitScreen: string | null;
}

export interface Journey {
  summary: JourneySummary;
  stats: JourneyStats;
  entryExit: JourneyEntryExit;
  path: JourneyPathNode[];
  timeline: JourneyStep[];
  screens: JourneyScreen[];
  navigation: JourneyNavigation;
  actions: JourneyAction[];
  eventLog: JourneyEvent[];
}

/* ─────────────────────────────────────────────────────────────────────
   Engine
   ───────────────────────────────────────────────────────────────────── */

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function personName(session: JourneySessionMeta): string {
  return session.user_id ? "This user" : "An anonymous visitor";
}

/** Build the complete human-readable journey for a session. */
export function buildJourney(
  session: JourneySessionMeta,
  rawEvents: JourneyEvent[],
): Journey {
  const events = [...rawEvents]
    .filter((e) => e && e.event_name)
    .sort((a, b) => a.events_at.localeCompare(b.events_at));

  const startedAt = session.started_at;
  const endedAt = session.last_seen_at;

  /* ── 1. Walk events chronologically, attributing to the current screen ── */
  const visits: JourneyScreenVisit[] = [];
  let current: JourneyScreenVisit | null = null;
  const actions: JourneyAction[] = [];

  for (const ev of events) {
    if (ev.event_name === "page_view") {
      if (current) {
        current.totalSeconds = Math.max(
          0,
          (new Date(ev.events_at).getTime() - new Date(current.at).getTime()) / 1000,
        );
        current.idleSeconds = Math.max(0, current.totalSeconds - current.activeSeconds);
      }
      current = {
        path: ev.page_path ?? "/",
        name: screenName(ev.page_path),
        at: ev.events_at,
        totalSeconds: 0,
        activeSeconds: 0,
        idleSeconds: 0,
        maxScrollDepth: 0,
        scrollThresholds: [],
        actions: [],
        prevScreen: visits.length ? visits[visits.length - 1].path : null,
        nextScreen: null,
      };
      visits.push(current);
      continue;
    }

    if (!current) {
      // Events before the first page_view (e.g. session_start) — attach to
      // the first screen once it appears, otherwise collect as session-level.
      if (ev.event_name === "time_spent") {
        // ignore pre-screen time; it is negligible
      }
      continue;
    }

    if (ev.event_name === "time_spent") {
      current.activeSeconds += num(ev.metadata?.seconds);
      continue;
    }

    if (ev.event_name === "scroll") {
      const depth = num(ev.metadata?.depth);
      if (depth > 0) {
        current.maxScrollDepth = Math.max(current.maxScrollDepth, depth);
        current.scrollThresholds.push({
          depth,
          at: ev.events_at,
          secondsFromVisit: Math.max(
            0,
            (new Date(ev.events_at).getTime() - new Date(current.at).getTime()) / 1000,
          ),
        });
      }
      continue;
    }

    if (isActionEvent(ev.event_name)) {
      const action: JourneyAction = {
        at: ev.events_at,
        label: humanizeEvent(ev),
        eventName: ev.event_name,
        metadata: ev.metadata ?? {},
      };
      current.actions.push(action);
      actions.push(action);
    }
  }

  // Close the last visit at session end.
  if (current) {
    current.totalSeconds = Math.max(
      0,
      (new Date(endedAt).getTime() - new Date(current.at).getTime()) / 1000,
    );
    current.idleSeconds = Math.max(0, current.totalSeconds - current.activeSeconds);
  }
  for (let i = 0; i < visits.length; i++) {
    if (i + 1 < visits.length) visits[i].nextScreen = visits[i + 1].path;
  }

  /* ── 2. Timeline steps ── */
  const timeline: JourneyStep[] = [
    { kind: "start", at: startedAt, label: "Session started" },
    ...visits.map<JourneyStep>((v) => ({ kind: "screen", at: v.at, visit: v })),
    { kind: "end", at: endedAt, label: "Session ended" },
  ];

  /* ── 3. Screens aggregated ── */
  const screenMap = new Map<string, JourneyScreen>();
  for (const v of visits) {
    const existing = screenMap.get(v.path);
    if (existing) {
      existing.visits += 1;
      existing.totalSeconds += v.totalSeconds;
      existing.activeSeconds += v.activeSeconds;
      existing.idleSeconds += v.idleSeconds;
      existing.lastVisitAt = v.at;
      existing.maxScrollDepth = Math.max(existing.maxScrollDepth, v.maxScrollDepth);
      existing.actionCount += v.actions.length;
    } else {
      screenMap.set(v.path, {
        path: v.path,
        name: v.name,
        visits: 1,
        totalSeconds: v.totalSeconds,
        activeSeconds: v.activeSeconds,
        idleSeconds: v.idleSeconds,
        firstVisitAt: v.at,
        lastVisitAt: v.at,
        isEntry: visits[0]?.path === v.path,
        isExit: visits[visits.length - 1]?.path === v.path,
        maxScrollDepth: v.maxScrollDepth,
        actionCount: v.actions.length,
      });
    }
  }
  const screens = [...screenMap.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);

  /* ── 4. Navigation path + revisits / back / forward / loops ── */
  const path: JourneyPathNode[] = visits.map((v, i) => ({
    path: v.path,
    name: v.name,
    at: v.at,
    durationSeconds: v.totalSeconds,
    revisit: visits.slice(0, i).some((p) => p.path === v.path),
  }));

  const seen = new Map<string, number>();
  const revisits: JourneyRevisit[] = [];
  let backNavigations = 0;
  let forwardNavigations = 0;
  const loopCounts = new Map<string, number>();

  for (let i = 0; i < visits.length; i++) {
    const v = visits[i];
    const firstSeen = seen.get(v.path);
    if (firstSeen !== undefined) {
      revisits.push({
        path: v.path,
        name: v.name,
        at: v.at,
        returnedAfterSeconds: Math.max(
          0,
          (new Date(v.at).getTime() - new Date(visits[firstSeen].at).getTime()) / 1000,
        ),
      });
      // Back navigation: A → B → A (returned to the screen before the last).
      if (i >= 2 && visits[i - 2].path === v.path) backNavigations += 1;
      // Forward navigation: A → B → A → B (left again to the same next screen).
      if (i >= 3 && visits[i - 1].path === visits[i - 3].path) forwardNavigations += 1;
      // Loop detection: same screen visited 3+ times.
      const count = visits.slice(0, i + 1).filter((p) => p.path === v.path).length;
      if (count >= 3) loopCounts.set(v.path, count);
    }
    seen.set(v.path, i);
  }
  const loops: JourneyLoop[] = [...loopCounts.entries()].map(([path, count]) => ({
    path,
    name: screenName(path),
    count,
  }));

  /* ── 5. Entry / exit ── */
  // Referrer is captured per-event (not on the session row); use the first
  // event that carries one.
  const firstReferrer =
    events.find((e) => typeof e.referrer === "string" && e.referrer)?.referrer ?? null;
  const entryExit: JourneyEntryExit = {
    entryPage: session.entry_page ?? visits[0]?.path ?? null,
    entryName: screenName(session.entry_page ?? visits[0]?.path ?? null),
    entryAt: visits[0]?.at ?? startedAt,
    exitPage: session.exit_page ?? visits[visits.length - 1]?.path ?? null,
    exitName: screenName(session.exit_page ?? visits[visits.length - 1]?.path ?? null),
    exitAt: visits[visits.length - 1]?.at ?? endedAt,
    referrer: firstReferrer,
    referrerHost: firstReferrer ? hostOf(firstReferrer) : null,
    source: session.source,
    medium: session.medium,
    campaign: session.campaign,
    device: session.device,
    browser: session.browser,
    os: session.os,
    country: session.country,
  };

  /* ── 6. Stats ── */
  const durationSeconds = Math.max(
    0,
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  );
  const interactions = actions.length;
  const returningScreens = screens.filter((s) => s.visits > 1).length;
  const stats: JourneyStats = {
    durationSeconds,
    screensVisited: screens.length,
    interactions,
    returningScreens,
    avgScreenSeconds: screens.length ? durationSeconds / screens.length : 0,
    maxScrollDepth: Math.max(0, ...visits.map((v) => v.maxScrollDepth)),
    conversions: session.conversions,
    conversionValue: session.conversion_value,
  };

  /* ── 7. Natural-language summary ── */
  const mostTimeScreen = screens.length ? screens[0].name : null;
  const person = personName(session);
  const deviceDesc = [session.device, session.browser].filter(Boolean).join(" on ") || "their device";
  const locationDesc = session.country ? ` from ${session.country}` : "";
  const entryName = entryExit.entryName ?? "an unknown screen";
  const exitName = entryExit.exitName ?? "an unknown screen";

  const parts: string[] = [];
  parts.push(
    `${person}${locationDesc} spent ${fmtDuration(durationSeconds)} across ${screens.length} screen${screens.length === 1 ? "" : "s"} (${deviceDesc}).`,
  );
  if (screens.length) {
    parts.push(
      `The journey started on ${entryName} and ended on ${exitName}.`,
    );
  }
  if (mostTimeScreen && screens.length > 1) {
    const top = screens[0];
    parts.push(
      `Most time was spent on ${top.name} — ${fmtDuration(top.totalSeconds)} across ${top.visits} visit${top.visits === 1 ? "" : "s"}.`,
    );
  }
  if (interactions > 0) {
    parts.push(`${interactions} interaction${interactions === 1 ? "" : "s"} were recorded.`);
  }
  if (stats.maxScrollDepth >= 100) {
    parts.push("The visitor scrolled to the bottom of at least one page.");
  } else if (stats.maxScrollDepth >= 50) {
    parts.push(`The deepest scroll reached ${stats.maxScrollDepth}% of a page.`);
  }
  if (session.conversions > 0) {
    parts.push(
      `${session.conversions} conversion${session.conversions === 1 ? "" : "s"} completed, worth ₹${session.conversion_value.toLocaleString()}.`,
    );
  }
  if (revisits.length > 0) {
    parts.push(
      `${revisits.length} screen${revisits.length === 1 ? " was" : "s were"} revisited.`,
    );
  }

  const summary: JourneySummary = {
    text: parts.join(" "),
    personName: person,
    durationSeconds,
    screensCount: screens.length,
    mostTimeScreen,
    interactions,
    conversions: session.conversions,
    entryScreen: entryName,
    exitScreen: exitName,
  };

  return {
    summary,
    stats,
    entryExit,
    path,
    timeline,
    screens,
    navigation: { backNavigations, forwardNavigations, revisits, loops },
    actions,
    eventLog: events,
  };
}