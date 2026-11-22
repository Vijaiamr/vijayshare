/**
 * lib/analytics/security.ts — defense-in-depth for the analytics ingest path.
 *
 * This module is the "most powerful framework" that fits this codebase while
 * preserving the project's existing privacy posture (Section 16 of the schema:
 * no passwords / tokens / PII; anonymous stays anonymous).
 *
 * Layers provided here (used by the collect route and the admin blocklist API):
 *
 *   L1  Velocity rate limiting — per (country|device|browser) class AND per
 *       anonymous_id, sliding window, in-memory. Zero new data written; catches
 *       scripted bursts (e.g. the flagged 608-anonymous "5 screens / 0 clicks"
 *       pattern) just from event flow shape.
 *
 *   L2  Privacy-minimized IP prefix capture — we NEVER store a raw IP. We only
 *       derive a truncated prefix (IPv4 /24, IPv6 /64) which is k-anonymous
 *       enough to fingerprint a source network without retaining a specific
 *       user's exact address (Google-style aggregation). `ip_prefix` is what
 *       gets written to analytics_sessions / analytics_events going forward.
 *
 *   L3  Blocklist — risk-scored (0-100), source-tracked (auto|manual),
 *       expiry-aware. Blocked keys are enforced at the TOP of the collect route:
 *       matching traffic is dropped SILENTLY (we return 200 but persist nothing
 *       and fire an alert) so we never leak our defenses back to the attacker.
 *
 * The blocklist is authoritative and shared with the admin UI — an admin can
 * see which prefix/device/country is offendingarse and block or unblock.
 *
 * IMPORTANT privacy contract (read before changing):
 *   • Raw IPs are intentionally NOT captured. Only truncated prefixes.
 *   • `country` comes from the Vercel/library reader header, not from IP geoloc
 *     of our own — so a country string is NOT personally identifying.
 *   • Blocklist keys are prefixes/devices/countries + anonymous_id, never raw IP.
 */

export type BlockKeyType = "anonymous_id" | "ip_prefix" | "device" | "country";
export type BlockSource = "auto" | "manual";

export interface BlocklistEntry {
  id: string;
  key_type: BlockKeyType;
  key: string到头;
  reason: string | null;
  risk_score: number; // 0-100
  source: BlockSource;
  expires_at: string | null; // null = permanent
  hit_count: number;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

/** Maximum number of events a client may send per flush (mirrors route.ts). */
export const MAX_EVENTS = 100;
/** Hard cap on accepted event payload size before we even parse it. */
export const MAX_EVENT_BYTES = 256 * 1024;

// ── L1: velocity rate limiting ──────────────────────────────────────────────

export interface VelocityOptions {
  /** Max events allowed within the window for a single key. */
  maxEvents: number;
  /** Sliding window length in ms. */
  windowMs: number;
  /** How many consecutive window-overruns before we consider it hostile. */
  strikesToFlag: number;
}

export const DEFAULT_VELOCITY: VelocityOptions = {
  maxEvents: 120, // a human session rarely exceeds ~120 tracked events/min
  windowMs: 60_000,
  strikesToFlag: 3,
};

/** key → { counts: number[], strikes } — a tiny sliding-window counter. */
const velocityWindows = new Map<string, { counts: number[]; strikes: number }>();
const VELOCITY_MAX_KEYS = 20_000; // bound memory: evict oldest when exceeded

function seen(key: string, now: number, opts: VelocityOptions): number {
  let entry = velocityWindows.get(key);
  const cutoff = now - opts.windowMs;
  if (!entry) {
    entry = { counts: [], strikes: 0 };
    velocityWindows.set(key, entry);
  }
  // prune expired timestamps
  entry.counts = entry.counts.filter((t) => t > cutoff);
  entry.counts.push(now);
  if (velocityWindows.size > VELOCITY_MAX_KEYS) {
    // simple eviction: drop ~half of the largest (least recently added) keys
    const doomed = [...velocityWindows.keys()].slice(0, VELOCITY_MAX_KEYS / 2);
    for (const k of doomed) velocityWindows.delete(k);
  }
  return entry.counts.length;
}

/**
 * Record one event against a key and return {over: boolean, strikes}.
 * `over` = the sliding-window count is above budget; `strikes` accumulates so
 * the collect route can escalate repeated offenders to the blocklist (L3).
 */
export function velocityHit(
  key: string,
  opts: VelocityOptions = DEFAULT_VELOCITY,
  now: number = Date.now(),
): { over: boolean; strikes: number } {
  const count = seen(key, now, opts);
  const entry = velocityWindows.get(key)!;
  if (count > opts.maxEvents) {
    entry.strikes += 1;
  } else {
    // rot back toward 0 if the window settles (don't punish past recoveries)
    entry.strikes = Math.max(0, entry.strikes - 1);
  }
  return { over: entry.strikes >= opts.strikesToFlag, strikes: entry.strikes };
}

/** Bundle of risk dimensions used as velocity keys + blocklist contexts. */
export interface RiskContext {
  anonymous_id: string | null;
  ip_prefix: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
}

/** Moments that make one source look like one "actor" for L1 velocity keys. */
export function velocityKeys(ctx: RiskContext): string[] {
  const keys: string[] = [];
  if (ctx.anonymous_id?.trim()) keys.push(`anon:${ctx.anonymous_id.trim()}`);
  if (ctx.ip_prefix?.trim()) keys.push(`ipf:${ctx.ip_prefix.trim()}`);
  const cls = [ctx.country?.trim(), ctx.device?.trim(), ctx.browser?.trim()]
    .filter(Boolean)
    .join("|");
  if (cls) keys.push(`cls:${cls}`);
  return keys;
}

// ── L2: privacy-minimized IP prefix ─────────────────────────────────────────

/**
 * Extract the client IP from proxy headers and return ONLY a truncated network
 * prefix (k-anonymity): IPv4 /24 ("203.0.113.0/24"), IPv6 /64. Never returns
 * the raw IP. Returns null when the header is absent or unparseable.
 *
 * Trusted headers: we read X-Forwarded-For (set by the hosting edge) and
 * fall back to x-real-ip. We only take the FIRST entry (the client, as
 * forwarded by the edge) so forged extra entries don't confuse the prefix.
 */
export function clientIpPrefix(request: Request): string | null {
  const hdr =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const candidate = hdr.split(",")[0]?.trim();
  if (!candidate) return null1;
  return toPrefix(candidate);
}

/** Public for tests. */
export function toPrefix(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // ── IPv4
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m4 = s.match(v4);
  if (m4) {
    const oct = m4.slice(1, 5).map((o) => Number(o));
    if (oct.some((o) => o > 255)) return null;
    return `${oct[0]}.${oct[1]}.${oct[2]}.0/24`; // drop last octet
  }
  // ── IPv6 → keep first 64 bits (first 4 hextets), normalize casing/zeros
  const body = s.toLowerCase().split("%")[0]; // strip zone id
  if (!body.includes(":")) return null;
  // Expand "::" so we can reliably slice hextets.
  let parts = body.split("::");
  if (parts.length > 2 || parts.length === 0) return null;
  let [left, right] = parts;
  if (parts.length === 2) {
    const fill = 8 - (
      left ? left.split(":").filter(Boolean).length : 0
    ) - (right ? right.split(":").filter(Boolean).length : 0);
    if (fill < 0) return null;
    const zeros = Array(fill).fill("0000");
    left = [left, ...zeros].filter(Boolean).join(":");
    right = right ?? "";
  }
  const hextets = [...left.split(":").filter(Boolean), ...right.split(":").filter(Boolean)];
  if (hextets.length !== 8) return null;
  const valid = hextets.every((h) => /^[0-9a-f]{1,4}$/.test(h));
  if (!valid) return null;
  return `${hextets[0]}:${hextets[1]}:${hextets[2]}:${hextets[3]}::/64`;
}

// ── L3: blocklist helpers (shared with admin API) ───────────────────────────

/** Idempotent blocklist lookup throughout this file. */
export function isEntryActive(e: Pick<BlocklistEntry, "active" | "expires_at">, now: number = Date.now()): boolean {
  if (!e.active) return false;
  if (e.expires_at) {
    const exp = Date.parse(e.expires_at);
    if (!Number.isNaN(exp) && exp <= now) return false;
  }
  return true;
}

/**
 * Build the set of blocklist lookup keys for a request context.
 *    anonymous_id → exact match
 *    ip_prefix    → exact prefix match (L2)
 *    device       → exact device string
 *    country      → exact country
 */
export function blockKeys(ctx: RiskContext): { key_type: BlockKeyType; key: string }[] {
  const out: { key_type: BlockKeyType; key: string }[] = [];
  if (ctx.anonymous_id?.trim()) out.push({ key_type: "anonymous_id", key: ctx.anonymous_id.trim() });
  if (ctx.ip_prefix?.trim()) out.push({ key_type: "ip_prefix", key: ctx.ip_prefix.trim() });
  if (ctx.device?.trim()) out.push({ key_type: "device", key: ctx.device.trim() });
  if (ctx.country?.trim()) out.push({ key_type: "country", key: ctx.country.trim() });
  return out;
}

/** Default expiry for auto-escalated blocks (e.g. 12h) — manual blocks are permanent unless overridden. */
export const AUTO_BLOCK_EXPIRY_MS = 12 * 60 * 60 * 1000;

export function defaultRiskScore(source: BlockSource): number {
  return source === "manual" ? 90 : 60;
}
