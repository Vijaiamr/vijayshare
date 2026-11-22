import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured, supabaseRequest } from "@/lib/supabase";
import {
  clientIpPrefix,
  velocityHit,
  DEFAULT_VELOCITY,
  RiskContext,
  blockKeys,
  defaultRiskScore,
  AUTO_BLOCK_EXPIRY_MS,
  toPrefix,
} from "@/lib/analytics/security";

export const dynamic = "force-dynamic";

const MAX_EVENTS = 100;
const MAX_META_BYTES = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Coerce to a valid UUID (client sends crypto.randomUUID(); sanitize the rest). */
function asUuid(v: unknown): string {
  return typeof v === "string" && UUID_RE.test(v) ? v : crypto.randomUUID();
}

interface IncomingEvent {
  id?: string;
  session_id?: string;
  anonymous_id?: string;
  event_name?: string;
  page_path?: string;
  page_url?: string;
  referrer?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  device?: string;
  browser?: string;
  os?: string;
  screen?: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
  events_at?: string;
}

/**
 * POST /api/analytics/collect
 *
 * Batched event ingest from the client tracker. Unlike most API routes this
 * deliberately accepts ANONYMOUS traffic — the (auth) pages track campaign
 * landings before sign-in. Logged-in users still must have an approved
 * profile (same rule as authenticate()). The server:
 *   1. attaches the country from the Vercel reader header
 *   2. upserts the session row (entry/exit page, active seconds, pageviews)
 *   3. merges anonymous → identified when a logged-in user carries an
 *      anonymous_id cookie (never overwrites an existing user_id)
 *   4. inserts events with client-generated ids (dedup on retry)
 */
export async function POST(request: Request) {
  // Resolve identity: allow anonymous, but enforce approved-profile for
  // logged-in users (mirrors authenticate() without the 401 for guests).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("approved")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.approved !== true) {
      return NextResponse.json(
        { error: "Account pending approval by the administrator" },
        { status: 403 },
      );
    }
  }

  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  let body: { events?: IncomingEvent[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (events.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  // ── SECURITY GATE (defense-in-depth, Layer 3): blocklist enforcement ──
  // Silent-200 drop: we return 200 but persist NOTHING so we never leak our
  // defenses back to an attacker. Anonymous identity is checked first (the
  // flagged "608-anonymous, 5 screens / 0 clicks" pattern keys on anon_id).
  const first = events[0];
  const riskCtx: RiskContext = {
    anonymous_id:
      typeof first?.anonymous_id === "string" ? first.anonymous_id.slice(0, 128) : null,
    ip_prefix: ip_prefix,
    device: typeof first?.device === "string" ? first.device.slice(0, 32) : null,
    browser: typeof first?.device === "string" ? first.device.slice(0, 32) : null,
  } as RiskContext;
  const ctx = normalizeRisk(riskCtx);
  const keys = blockKeys(ctx);
  const blocked = keys.length > 0 && keys.some((k) => isBlocked(k));  // reads live blocklist (see admin API)
  if (blocked) {
    // The blocklist (sourced from the same collect-time velocity losses) already
    // caught this source. Drop silently. Persist NOTHING.
    return NextResponse.json({ ok: true, inserted: 0 });
  }
  // ── Layer 1: velocity rate limiting (sliding window per anon_id) ──
  const velocity = velocityHit(ctx.anonymous_id ?? "?unknown?", DEFAULT_VELOCITY);
  if (velocity.over) {
    // Behavioral velocity breach (e.g. the flagged multi-screen/zero-click burst).
    // Escalate to blocklist so the admin sees it, then DROP this batch silently.
    await escalate({ ctx, reason: `velocity overrun (${velocity.strikes} strikes)` });
    return NextResponse.json({ ok: true, inserted: 0 });
  }


  const country =
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry") ||
    null;

  // PRIVACY: NEVER store a raw IP — only a k-anonymous truncated network
  // prefix (IPv4 /24, IPv6 /64 — Groupon/Google k-anonymity style). This
  // is what velocity + blocklist keys are built from and what gets written
  // to analytics_events/analytics_sessions.ip_prefix going forward.
  const ip_prefix = clientIpPrefix(request);

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const sessionIds = new Set<string>();
  const anonIds = new Set<string>();
  // Map raw (possibly non-UUID) session ids → one stable UUID per batch so
  // events sharing a session stay grouped even for malformed input.
  const sessionIdMap = new Map<string, string>();

  for (const ev of events) {
    const id = asUuid(ev.id);
    const rawSession = typeof ev.session_id === "string" && ev.session_id ? ev.session_id : "";
    let sessionId = sessionIdMap.get(rawSession);
    if (!sessionId) {
      sessionId = asUuid(ev.session_id);
      sessionIdMap.set(rawSession, sessionId);
    }
    const eventName = typeof ev.event_name === "string" ? ev.event_name.slice(0, 64) : "unknown";
    const pagePath = typeof ev.page_path === "string" ? ev.page_path.slice(0, 500) : null;
    const pageUrl = typeof ev.page_url === "string" ? ev.page_url.slice(0, 2000) : null;
    const anonId = typeof ev.anonymous_id === "string" ? ev.anonymous_id.slice(0, 128) : null;
    const eventsAt = typeof ev.events_at === "string" && !Number.isNaN(Date.parse(ev.events_at))
      ? ev.events_at
      : now;

    let metadata: Record<string, unknown> = {};
    if (ev.metadata && typeof ev.metadata === "object") {
      try {
        const s = JSON.stringify(ev.metadata);
        if (s.length <= MAX_META_BYTES) metadata = ev.metadata;
      } catch {
        /* ignore oversized metadata */
      }
    }

    if (anonId) anonIds.add(anonId);
    sessionIds.add(sessionId);

    rows.push({
      id,
      session_id: sessionId,
      user_id: user?.id ?? null,
      anonymous_id: anonId,
      event_name: eventName,
      page_path: pagePath,
      page_url: pageUrl,
      referrer: ev.referrer?.slice(0, 2000) ?? null,
      source: ev.source?.slice(0, 128) ?? null,
      medium: ev.medium?.slice(0, 64) ?? null,
      campaign: ev.campaign?.slice(0, 128) ?? null,
      device: ev.device?.slice(0, 32) ?? null,
      browser: ev.browser?.slice(0, 32) ?? null,
      os: ev.os?.slice(0, 32) ?? null,
      screen: ev.screen?.slice(0, 32) ?? null,
      country,
      ip_prefix,
      is_active: ev.is_active !== false,
      metadata,
      events_at: eventsAt,
      received_at: now,
    });
  }

  try {
    // ── 1. Insert events (client-generated ids → dedup on retry) ──
    await supabaseRequest("analytics_events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(rows),
    });

    // ── 2. Upsert sessions ──
    // Read-then-merge so counters ACCUMULATE across flushes (the client
    // flushes every 15s; each batch only carries its own delta).
    for (const sid of sessionIds) {
      const sessionEvents = rows.filter((r) => r.session_id === sid);
      const first = sessionEvents[0];
      const pageViews = sessionEvents.filter((r) => r.event_name === "page_view");
      const timeEvents = sessionEvents.filter((r) => r.event_name === "time_spent");
      const activeSecs = timeEvents.reduce(
        (sum, r) => sum + (typeof (r.metadata as Record<string, unknown>)?.seconds === "number"
          ? Number((r.metadata as Record<string, unknown>).seconds)
          : 0),
        0,
      );
      const conversions = sessionEvents.filter((r) => r.event_name === "conversion").length;
      const entryPage = pageViews[0]?.page_path ?? first?.page_path ?? null;
      const exitPage = pageViews[pageViews.length - 1]?.page_path ?? entryPage;

      // Read current counters (null when the session is new).
      let existing: Record<string, unknown> | null = null;
      try {
        const getRes = await supabaseRequest(
          `analytics_sessions?id=eq.${encodeURIComponent(sid)}&select=page_views,active_seconds,conversions`,
          { method: "GET" },
        );
        existing = Array.isArray(getRes) && getRes.length > 0 ? getRes[0] : null;
      } catch {
        /* session may not exist yet — treat as new */
      }

      const base = (k: string) =>
        typeof existing?.[k] === "number" ? Number(existing[k]) : 0;

      // Single merge-duplicates POST: inserts when new, merges when existing.
      await supabaseRequest(
        "analytics_sessions?on_conflict=id",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify([
            {
              id: sid,
              user_id: user?.id ?? null,
              anonymous_id: first?.anonymous_id ?? null,
              started_at: first?.events_at ?? now,
              last_seen_at: now,
              entry_page: entryPage,
              exit_page: exitPage,
              device: first?.device ?? null,
              browser: first?.browser ?? null,
              os: first?.os ?? null,
              screen: first?.screen ?? null,
              country: first?.country ?? null,
              source: first?.source ?? null,
              medium: first?.medium ?? null,
              campaign: first?.campaign ?? null,
              page_views: base("page_views") + pageViews.length,
              active_seconds: base("active_seconds") + activeSecs,
              conversions: base("conversions") + conversions,
            },
          ]),
        },
      );
    }

    // ── 3. Identity merge (anonymous → identified) ──
    if (user && anonIds.size > 0) {
      const anonList = [...anonIds];
      await supabaseRequest("analytics_identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates",
        },
        body: JSON.stringify(anonList.map((a) => ({ anonymous_id: a, user_id: user.id }))),
      });
      // Backfill past anonymous rows — only where user_id is still null.
      for (const a of anonList) {
        await supabaseRequest(
          `analytics_events?anonymous_id=eq.${encodeURIComponent(a)}&user_id=is.null`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ user_id: user.id }),
          },
        );
        await supabaseRequest(
          `analytics_sessions?anonymous_id=eq.${encodeURIComponent(a)}&user_id=is.null`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ user_id: user.id }),
          },
        );
      }
    }

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "collect failed";
    console.error("analytics-collect:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}