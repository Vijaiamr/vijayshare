/**
 * tests/journey.test.ts
 *
 * Unit tests for the Session Journey engine (lib/analytics/journey.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildJourney,
  fmtDuration,
  humanizeEvent,
  screenName,
  type JourneyEvent,
  type JourneySessionMeta,
} from "../lib/analytics/journey";

const T0 = "2026-09-19T10:00:00.000Z";

function session(overrides: Partial<JourneySessionMeta> = {}): JourneySessionMeta {
  return {
    id: "s1",
    user_id: "u1",
    anonymous_id: null,
    started_at: T0,
    last_seen_at: "2026-09-19T10:05:00.000Z",
    entry_page: "/",
    exit_page: "/ledger",
    source: "google",
    medium: "organic",
    campaign: null,
    device: "desktop",
    browser: "Chrome",
    os: "macOS",
    country: "IN",
    page_views: 3,
    active_seconds: 120,
    conversions: 1,
    conversion_value: 5000,
    ...overrides,
  };
}

function ev(
  event_name: string,
  page_path: string | null,
  at: string,
  metadata: Record<string, unknown> = {},
  referrer: string | null = null,
): JourneyEvent {
  return { id: `${event_name}-${at}`, event_name, page_path, events_at: at, metadata, referrer };
}

test("screenName maps known routes and falls back gracefully", () => {
  assert.equal(screenName("/"), "Home");
  assert.equal(screenName("/market"), "Market");
  assert.equal(screenName("/ledger"), "Ledger");
  assert.equal(screenName("/stock/RELIANCE"), "Stock · RELIANCE");
  assert.equal(screenName("/admin/analytics/exec"), "Admin Analytics · Executive");
  assert.equal(screenName("/custom-page"), "Custom-page");
  assert.equal(screenName(null), "Unknown screen");
  assert.equal(screenName(""), "Unknown screen");
});

test("fmtDuration formats compactly", () => {
  assert.equal(fmtDuration(0), "0s");
  assert.equal(fmtDuration(45), "45s");
  assert.equal(fmtDuration(150), "2m 30s");
  assert.equal(fmtDuration(3600), "1h");
  assert.equal(fmtDuration(3661), "1h 1m");
});

test("humanizeEvent produces human-readable labels", () => {
  assert.equal(humanizeEvent(ev("page_view", "/market", T0)), "Opened Market");
  assert.equal(humanizeEvent(ev("click", "/market", T0, { text: "  NIFTY 50  " })), 'Clicked "NIFTY 50"');
  assert.equal(humanizeEvent(ev("click", "/market", T0, { id: "btn-buy" })), "Clicked #btn-buy");
  assert.equal(humanizeEvent(ev("scroll", "/market", T0, { depth: 75 })), "Scrolled to 75% of the page");
  assert.equal(humanizeEvent(ev("form_interact", "/signup", T0, { field: "email_address" })), "Interacted with the Email Address field");
  assert.equal(humanizeEvent(ev("form_submit", "/signup", T0)), "Submitted a form");
  assert.equal(humanizeEvent(ev("outbound_link", "/", T0, { href: "https://www.example.com/x" })), "Opened external link example.com");
  assert.equal(humanizeEvent(ev("download", "/", T0, { filename: "report.pdf" })), "Downloaded report.pdf");
  assert.equal(humanizeEvent(ev("error", "/", T0, { message: "boom" })), "Encountered an error: boom");
  assert.equal(humanizeEvent(ev("conversion", "/", T0, { goal: "tax_calc" })), "Completed a conversion (tax_calc)");
  assert.equal(humanizeEvent(ev("rage_click", "/", T0, { text: "Save" })), "Clicked repeatedly on \"Save\"");
  assert.equal(humanizeEvent(ev("custom_event", "/", T0)), "custom event");
});

test("buildJourney produces a chronological timeline with time attribution", () => {
  const events = [
    ev("session_start", null, T0),
    ev("page_view", "/", T0),
    ev("time_spent", "/", "2026-09-19T10:00:15.000Z", { seconds: 15 }),
    ev("click", "/", "2026-09-19T10:00:20.000Z", { text: "Open Market" }),
    ev("page_view", "/market", "2026-09-19T10:01:00.000Z"),
    ev("time_spent", "/market", "2026-09-19T10:01:15.000Z", { seconds: 15 }),
    ev("scroll", "/market", "2026-09-19T10:01:30.000Z", { depth: 50 }),
    ev("page_view", "/ledger", "2026-09-19T10:03:00.000Z"),
    ev("time_spent", "/ledger", "2026-09-19T10:03:15.000Z", { seconds: 15 }),
    ev("conversion", "/ledger", "2026-09-19T10:04:00.000Z", { goal: "tax_calc" }),
  ];
  const j = buildJourney(session(), events);

  // Timeline: start + 3 screens + end
  assert.equal(j.timeline.length, 5);
  assert.equal(j.timeline[0].kind, "start");
  assert.equal(j.timeline[4].kind, "end");

  const screens = j.timeline.filter((s): s is Extract<typeof s, { kind: "screen" }> => s.kind === "screen");
  assert.equal(screens.length, 3);
  assert.equal(screens[0].visit.name, "Home");
  assert.equal(screens[1].visit.name, "Market");
  assert.equal(screens[2].visit.name, "Ledger");

  // Time attribution: Home 60s (10:00 → 10:01), Market 120s (10:01 → 10:03), Ledger 120s (10:03 → 10:05)
  assert.equal(Math.round(screens[0].visit.totalSeconds), 60);
  assert.equal(Math.round(screens[1].visit.totalSeconds), 120);
  assert.equal(Math.round(screens[2].visit.totalSeconds), 120);

  // Active time attribution
  assert.equal(Math.round(screens[0].visit.activeSeconds), 15);
  assert.equal(Math.round(screens[1].visit.activeSeconds), 15);
  assert.equal(Math.round(screens[2].visit.activeSeconds), 15);

  // Idle = total - active
  assert.equal(Math.round(screens[0].visit.idleSeconds), 45);

  // Actions attributed to the right screen
  assert.equal(screens[0].visit.actions.length, 1);
  assert.equal(screens[0].visit.actions[0].label, 'Clicked "Open Market"');
  assert.equal(screens[2].visit.actions.length, 1);
  assert.equal(screens[2].visit.actions[0].eventName, "conversion");

  // Scroll attributed to Market
  assert.equal(screens[1].visit.maxScrollDepth, 50);
  assert.equal(screens[1].visit.scrollThresholds.length, 1);
  assert.equal(screens[1].visit.scrollThresholds[0].depth, 50);
  assert.equal(Math.round(screens[1].visit.scrollThresholds[0].secondsFromVisit), 30);

  // Prev / next
  assert.equal(screens[0].visit.nextScreen, "/market");
  assert.equal(screens[1].visit.prevScreen, "/");
  assert.equal(screens[1].visit.nextScreen, "/ledger");
  assert.equal(screens[2].visit.prevScreen, "/market");
});

test("buildJourney aggregates screens and marks entry/exit", () => {
  const events = [
    ev("page_view", "/", T0),
    ev("page_view", "/market", "2026-09-19T10:01:00.000Z"),
    ev("page_view", "/", "2026-09-19T10:02:00.000Z"),
    ev("page_view", "/ledger", "2026-09-19T10:03:00.000Z"),
  ];
  const j = buildJourney(session(), events);

  assert.equal(j.screens.length, 3);
  const home = j.screens.find((s) => s.path === "/")!;
  assert.equal(home.visits, 2);
  assert.equal(home.isEntry, true);
  assert.equal(home.isExit, false);
  const ledger = j.screens.find((s) => s.path === "/ledger")!;
  assert.equal(ledger.isExit, true);

  // Path marks revisits
  assert.equal(j.path.length, 4);
  assert.equal(j.path[0].revisit, false);
  assert.equal(j.path[2].revisit, true);

  // Navigation behavior: / → /market → / is a back navigation
  assert.equal(j.navigation.backNavigations, 1);
  assert.equal(j.navigation.revisits.length, 1);
  assert.equal(j.navigation.revisits[0].path, "/");
  assert.equal(Math.round(j.navigation.revisits[0].returnedAfterSeconds), 120);
});

test("buildJourney detects loops (3+ visits to the same screen)", () => {
  const events = [
    ev("page_view", "/", T0),
    ev("page_view", "/market", "2026-09-19T10:01:00.000Z"),
    ev("page_view", "/", "2026-09-19T10:02:00.000Z"),
    ev("page_view", "/market", "2026-09-19T10:03:00.000Z"),
    ev("page_view", "/", "2026-09-19T10:04:00.000Z"),
  ];
  const j = buildJourney(session(), events);
  assert.equal(j.navigation.loops.length, 1);
  assert.equal(j.navigation.loops[0].path, "/");
  assert.equal(j.navigation.loops[0].count, 3);
});

test("buildJourney generates a natural-language summary", () => {
  const events = [
    ev("page_view", "/", T0),
    ev("time_spent", "/", "2026-09-19T10:00:15.000Z", { seconds: 15 }),
    ev("click", "/", "2026-09-19T10:00:20.000Z", { text: "Open Market" }),
    ev("page_view", "/market", "2026-09-19T10:01:00.000Z"),
    ev("scroll", "/market", "2026-09-19T10:01:30.000Z", { depth: 100 }),
    ev("page_view", "/ledger", "2026-09-19T10:03:00.000Z"),
    ev("conversion", "/ledger", "2026-09-19T10:04:00.000Z", { goal: "tax_calc" }),
  ];
  const j = buildJourney(session(), events);

  assert.match(j.summary.text, /spent 5m across 3 screens/);
  assert.match(j.summary.text, /started on Home and ended on Ledger/);
  assert.match(j.summary.text, /Most time was spent on/);
  assert.match(j.summary.text, /2 interactions/);
  assert.match(j.summary.text, /scrolled to the bottom/);
  assert.match(j.summary.text, /1 conversion/);
  assert.equal(j.summary.screensCount, 3);
  assert.equal(j.summary.interactions, 2);
  assert.equal(j.summary.conversions, 1);
});

test("buildJourney handles empty and single-screen sessions", () => {
  const empty = buildJourney(session(), []);
  assert.equal(empty.timeline.length, 2); // start + end
  assert.equal(empty.screens.length, 0);
  assert.equal(empty.stats.screensVisited, 0);
  assert.equal(empty.path.length, 0);

  const single = buildJourney(session({ exit_page: "/" }), [ev("page_view", "/", T0)]);
  assert.equal(single.screens.length, 1);
  assert.equal(single.screens[0].isEntry, true);
  assert.equal(single.screens[0].isExit, true);
  assert.equal(single.stats.avgScreenSeconds, 300);
});

test("buildJourney derives referrer from events", () => {
  const events = [
    ev("page_view", "/", T0, {}, "https://www.google.com/search?q=stocks"),
    ev("page_view", "/market", "2026-09-19T10:01:00.000Z"),
  ];
  const j = buildJourney(session(), events);
  assert.equal(j.entryExit.referrer, "https://www.google.com/search?q=stocks");
  assert.equal(j.entryExit.referrerHost, "google.com");
});