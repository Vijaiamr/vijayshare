/**
 * Client-side analytics tracker (singleton).
 *
 * Captures user behavior without blocking the page:
 *   • page views + active/idle time per page (background/idle time is NEVER
 *     counted as engagement — visibility-based)
 *   • clicks, dead clicks, rage clicks
 *   • scroll depth (25/50/75/90/100%)
 *   • form start / interaction / submit / abandonment (field NAMES only —
 *     never values, never passwords)
 *   • outbound links, downloads
 *   • JS errors + unhandled rejections
 *   • Core Web Vitals (LCP / CLS / INP) when the browser supports it
 *   • session + anonymous identity (cookies), referrer + UTM capture
 *
 * Events are queued and flushed in batches (fetch keepalive / sendBeacon) so
 * analytics never blocks rendering or navigation.
 *
 * Privacy: no passwords, payment credentials, auth tokens, or form values are
 * ever captured. user_id is resolved server-side from the session cookie.
 */

export interface AnalyticsEvent {
  id: string; // client-generated uuid — dedup key
  session_id: string;
  anonymous_id: string;
  event_name: string;
  page_path: string;
  page_url: string;
  referrer?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  device?: string;
  browser?: string;
  os?: string;
  screen?: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  events_at: string;
}

const COLLECT_URL = "/api/analytics/collect";
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_QUEUE_SIZE = 25;
const TIME_BATCH_MS = 15_000; // send time_spent in 15s chunks
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min inactivity = new session
const ANON_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// ── Cookie helpers ──────────────────────────────────────────────────────────

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string, maxAgeSec: number): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Enrichment ──────────────────────────────────────────────────────────────

function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) {
    return "tablet";
  }
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function detectOS(): string {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

function parseUTM(url: string): { source?: string; medium?: string; campaign?: string } {
  try {
    const p = new URL(url, window.location.origin);
    const get = (k: string) => p.searchParams.get(k)?.trim() || undefined;
    const source = get("utm_source");
    const medium = get("utm_medium");
    const campaign = get("utm_campaign");
    if (source || medium || campaign) {
      return { source, medium, campaign };
    }
    // Paid-click adapters
    if (p.searchParams.has("gclid")) return { source: "google", medium: "cpc" };
    if (p.searchParams.has("fbclid")) return { source: "facebook", medium: "cpc" };
    if (p.searchParams.has("msclkid")) return { source: "bing", medium: "cpc" };
  } catch {
    /* ignore */
  }
  return {};
}

function referrerInfo(): { referrer?: string; source?: string; medium?: string } {
  const ref = document.referrer;
  if (!ref) return {};
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    const social = ["facebook.com", "instagram.com", "x.com", "twitter.com", "linkedin.com", "youtube.com", "whatsapp.com", "telegram.org"];
    const medium = social.includes(host) ? "social" : "referral";
    return { referrer: ref, source: host, medium };
  } catch {
    return { referrer: ref };
  }
}

// ── Tracker state ───────────────────────────────────────────────────────────

let initialized = false;
let queue: AnalyticsEvent[] = [];
let sessionId = "";
let anonymousId = "";
let currentPath = "";
let lastTickAt = 0;
let visible = true;
let pendingMs = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastClickTarget: Element | null = null;
let clickCount = 0;
let clickWindowStart = 0;
let maxScrollDepth = 0;
let formStarted = false;
let formFields = new Set<string>();
let lastScrollAt = 0;

function baseEvent(eventName: string, metadata: Record<string, unknown>, opts?: { path?: string; isActive?: boolean }): AnalyticsEvent {
  const utm = parseUTM(window.location.href);
  const ref = referrerInfo();
  return {
    id: uuid(),
    session_id: sessionId,
    anonymous_id: anonymousId,
    event_name: eventName,
    page_path: opts?.path ?? currentPath,
    page_url: window.location.href,
    referrer: ref.referrer,
    source: utm.source ?? ref.source,
    medium: utm.medium ?? ref.medium,
    campaign: utm.campaign,
    device: detectDevice(),
    browser: detectBrowser(),
    os: detectOS(),
    screen: `${window.screen.width}x${window.screen.height}`,
    is_active: opts?.isActive ?? visible,
    metadata,
    events_at: new Date().toISOString(),
  };
}

function track(eventName: string, metadata: Record<string, unknown> = {}, opts?: { path?: string; isActive?: boolean }): void {
  if (!initialized) return;
  queue.push(baseEvent(eventName, metadata, opts));
  if (queue.length >= FLUSH_QUEUE_SIZE) flush();
}

function refreshSession(): void {
  const now = Date.now();
  const existing = getCookie("vm_session");
  const existingAt = existing ? Number(getCookie("vm_session_at") ?? "0") : 0;
  if (!existing || now - existingAt > SESSION_TTL_MS) {
    sessionId = uuid();
    setCookie("vm_session", sessionId, SESSION_TTL_MS / 1000);
    setCookie("vm_session_at", String(now), SESSION_TTL_MS / 1000);
    track("session_start", {}, { isActive: true });
  } else {
    sessionId = existing;
    setCookie("vm_session_at", String(now), SESSION_TTL_MS / 1000);
  }
}

function ensureAnonymousId(): void {
  const existing = getCookie("vm_anon");
  if (existing) {
    anonymousId = existing;
  } else {
    anonymousId = uuid();
    setCookie("vm_anon", anonymousId, ANON_TTL_MS / 1000);
  }
}

// ── Flush ───────────────────────────────────────────────────────────────────

async function flush(): Promise<void> {
  if (!initialized || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(COLLECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    // Re-queue on failure (bounded — drop if the queue is already large)
    if (queue.length < FLUSH_QUEUE_SIZE * 2) {
      queue.unshift(...batch);
    }
  }
}

function flushBeacon(): void {
  if (!initialized || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const blob = new Blob([JSON.stringify({ events: batch })], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(COLLECT_URL, blob);
    } else {
      void fetch(COLLECT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: blob,
        keepalive: true,
      });
    }
  } catch {
    /* best effort */
  }
}

// ── Time tracking (active only) ─────────────────────────────────────────────

function tick(): void {
  const now = Date.now();
  const elapsed = now - lastTickAt;
  lastTickAt = now;
  if (!visible || !currentPath) return;
  pendingMs += elapsed;
  if (pendingMs >= TIME_BATCH_MS) {
    const secs = Math.floor(pendingMs / 1000);
    pendingMs -= secs * 1000;
    track("time_spent", { seconds: secs }, { path: currentPath, isActive: true });
  }
}

function flushPendingTime(): void {
  if (pendingMs >= 1000 && currentPath) {
    const secs = Math.floor(pendingMs / 1000);
    pendingMs -= secs * 1000;
    track("time_spent", { seconds: secs }, { path: currentPath, isActive: visible });
  }
}

// ── Auto-capture listeners ──────────────────────────────────────────────────

function isInteractive(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (["a", "button", "input", "select", "textarea", "summary", "label"].includes(tag)) return true;
  if (el.getAttribute("role") === "button" || el.getAttribute("role") === "link") return true;
  if (el.closest("a, button, input, select, textarea, [role=button], [role=link]")) return true;
  return false;
}

function describeTarget(el: Element | null): Record<string, unknown> {
  if (!el) return {};
  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : undefined;
  const text = (el.textContent ?? "").trim().slice(0, 60) || undefined;
  const href = el.getAttribute("href") || undefined;
  return { tag, id, cls, text, href };
}

function onDocumentClick(e: MouseEvent): void {
  const target = e.target instanceof Element ? e.target : null;
  const desc = describeTarget(target);
  const now = Date.now();

  // Rage click: 3+ clicks on the same element within 5s
  if (target === lastClickTarget) {
    clickCount++;
    if (now - clickWindowStart > 5000) {
      clickCount = 1;
      clickWindowStart = now;
    }
    if (clickCount === 3) {
      track("rage_click", { ...desc, clicks: clickCount });
    }
  } else {
    lastClickTarget = target;
    clickCount = 1;
    clickWindowStart = now;
  }

  // Dead click: click on a non-interactive element (no link/button/input)
  if (!isInteractive(target)) {
    track("dead_click", desc);
    return;
  }

  track("click", desc);

  // Outbound link
  const anchor = target?.closest("a");
  if (anchor?.href) {
    try {
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) {
        track("outbound_link", { href: anchor.href, text: (anchor.textContent ?? "").trim().slice(0, 60) });
      }
    } catch {
      /* ignore */
    }
  }

  // Download
  if (anchor?.getAttribute("download") != null || /\.(pdf|zip|docx?|xlsx?|csv|png|jpg|jpeg)$/i.test(anchor?.href ?? "")) {
    track("download", { href: anchor?.href });
  }
}

function onScroll(): void {
  const now = Date.now();
  if (now - lastScrollAt < 500) return;
  lastScrollAt = now;
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  if (max <= 0) return;
  const depth = Math.round((window.scrollY / max) * 100);
  if (depth > maxScrollDepth) {
    maxScrollDepth = depth;
    for (const threshold of [25, 50, 75, 90, 100]) {
      if (depth >= threshold && !scrollThresholdsSent.has(threshold)) {
        scrollThresholdsSent.add(threshold);
        track("scroll", { depth: threshold });
      }
    }
  }
}

const scrollThresholdsSent = new Set<number>();

function onFocusIn(e: FocusEvent): void {
  const el = e.target instanceof Element ? e.target : null;
  if (!el) return;
  const tag = el.tagName.toLowerCase();
  if (!["input", "select", "textarea"].includes(tag)) return;
  const name = el.getAttribute("name") || el.id || tag;
  if (!formStarted) {
    formStarted = true;
    track("form_start", { form: el.closest("form")?.getAttribute("name") || el.closest("form")?.id || undefined });
  }
  if (!formFields.has(name)) {
    formFields.add(name);
    track("form_interact", { field: name, type: el.getAttribute("type") || tag });
  }
}

function onFormSubmit(e: SubmitEvent): void {
  const form = e.target instanceof HTMLFormElement ? e.target : null;
  track("form_submit", { form: form?.getAttribute("name") || form?.id || undefined });
  formStarted = false;
  formFields.clear();
}

function onError(e: ErrorEvent): void {
  track("error", { type: "js", message: e.message?.slice(0, 200), source: e.filename, line: e.lineno });
}

function onRejection(e: PromiseRejectionEvent): void {
  const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
  track("error", { type: "unhandledrejection", message: reason.slice(0, 200) });
}

function observeCWV(): void {
  try {
    if (typeof PerformanceObserver === "undefined") return;
    const send = (name: string, value: number) => track("cwv", { metric: name, value: Math.round(value * 1000) / 1000 });

    const lcp = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "largest-contentful-paint") send("LCP", entry.startTime);
      }
    });
    lcp.observe({ type: "largest-contentful-paint", buffered: true });

    const cls = new PerformanceObserver((list) => {
      let value = 0;
      for (const entry of list.getEntries()) {
        if (!(entry as unknown as { hadRecentInput?: boolean }).hadRecentInput) {
          value += (entry as unknown as { value?: number }).value ?? 0;
        }
      }
      if (value > 0) send("CLS", value);
    });
    cls.observe({ type: "layout-shift", buffered: true });

    if ("INP" in PerformanceObserver.supportedEntryTypes) {
      const inp = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          send("INP", (entry as unknown as { duration?: number }).duration ?? 0);
        }
      });
      inp.observe({ type: "event", buffered: true } as PerformanceObserverInit);
    }
  } catch {
    /* ignore */
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export const analytics = {
  /** Initialize once (idempotent). Called from the AnalyticsTracker component. */
  init(): void {
    if (initialized) return;
    initialized = true;
    ensureAnonymousId();
    refreshSession();
    lastTickAt = Date.now();
    visible = document.visibilityState === "visible";

    // Route changes are driven by the component (usePathname) → pageView()
    // Time tick
    flushTimer = setInterval(() => {
      tick();
      if (queue.length > 0) flush();
    }, FLUSH_INTERVAL_MS);

    // Visibility: pause/resume active-time accounting
    document.addEventListener("visibilitychange", () => {
      const wasVisible = visible;
      visible = document.visibilityState === "visible";
      if (wasVisible && !visible) {
        flushPendingTime();
        flushBeacon();
      } else if (!wasVisible && visible) {
        lastTickAt = Date.now();
      }
    });

    // Page hide / unload: flush everything
    window.addEventListener("pagehide", () => {
      flushPendingTime();
      flushBeacon();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushPendingTime();
        flushBeacon();
      }
    });

    // Auto-capture
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("submit", onFormSubmit, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    observeCWV();
  },

  /** Called on every route change (and once on mount). */
  pageView(path: string): void {
    if (!initialized) return;
    flushPendingTime();
    currentPath = path;
    maxScrollDepth = 0;
    scrollThresholdsSent.clear();
    formStarted = false;
    formFields.clear();
    track("page_view", {}, { path, isActive: visible });
  },

  /** Manual event (used by app code for conversions, e.g. pilot start). */
  track(eventName: string, metadata: Record<string, unknown> = {}): void {
    track(eventName, metadata);
  },

  /** Flush immediately (used before navigation). */
  flushNow(): void {
    flushPendingTime();
    void flush();
  },
};