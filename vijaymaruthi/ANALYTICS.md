# VijayMaruthi Analytics — Product Analytics & Behavioral Intelligence

Enterprise-grade product analytics for the VijayMaruthi Wealth Platform.
This document is the source of truth for the analytics architecture, data
model, metric definitions, API surface, security model, and privacy rules.

---

## 1. Architecture

```text
Client tracker (browser) ──► POST /api/analytics/collect ──► analytics_events
                                                              │
                                                              ▼
                                              analytics_sessions (derived)
                                                              │
                                              analytics_identity (join)
                                                              │
                                              analytics_daily (rollup cron)
                                                              │
                                              Admin APIs (service_role)
                                                              │
                                              Analytics UI (admin section)
```

- **Ingestion**: the client tracker posts events to `/api/analytics/collect`
  (service_role insert). Sessions are upserted per `session_id`; non-UUID
  session ids are mapped to a stable UUID per batch (`sessionIdMap`).
- **Rollup**: `/api/cron/analytics-rollup` (Vercel cron, `0 1 * * *`,
  guarded by `CRON_SECRET`) aggregates daily stats into `analytics_daily`.
- **Read path**: every admin analytics API uses the service-role client and
  passes through `requireAnalytics()` — the server-side role gate.

## 2. Data model

| Table | Purpose |
|---|---|
| `analytics_events` | Raw event stream (page_view, time_spent, scroll, conversion, error, rage_click, dead_click, slow_interaction, LCP/CLS/INP, …) |
| `analytics_sessions` | Session aggregates (page_views, active_seconds, conversions, conversion_value, entry/exit, source/medium/campaign, device/browser/country) |
| `analytics_identity` | Anonymous → identified user join |
| `analytics_daily` | Daily rollup (cron) |
| `analytics_funnels` | Funnel definitions (ordered steps) |
| `analytics_audiences` | Audience segment definitions |
| `analytics_alerts` | Alert rules (metric/op/value) |
| `analytics_alert_events` | Triggered alert history |
| `analytics_audit_log` | Configuration-change audit trail |

All timestamps are stored and compared in **UTC**.

## 3. Global filters

Every analytics page and API honors the same filter set (URL-synced):

| Param | Values | Meaning |
|---|---|---|
| `range` | today, yesterday, 7d, 30d, 90d, thisMonth, lastMonth, custom | Primary period |
| `start` / `end` | YYYY-MM-DD | Custom range bounds |
| `compare` | none, previous, previousYear, custom | Comparison period |
| `cstart` / `cend` | YYYY-MM-DD | Custom comparison bounds |
| `segment` | all, new, returning, converted, highValue | User segment |
| `device` | all, desktop, mobile, tablet | Device filter |
| `browser` | all, chrome, safari, edge, firefox | Browser filter |
| `source` | all, direct, organic, paid, referral, social, campaign | Traffic source |
| `country` | all or ISO-3166 alpha-2 | Geo filter |
| `campaign` | all or UTM campaign | Campaign filter |

**Segment semantics** (documented in `lib/analytics/compute.ts`):

- `all` — every session in the period
- `new` — anonymous_id with NO activity before the period start
- `returning` — anonymous_id with activity before the period start
- `converted` — sessions with ≥1 conversion
- `highValue` — sessions with conversion_value ≥ ₹5,000

When a segment is active, event-level metrics (pageviews, conversions,
revenue) are derived from session aggregates / segment-scoped conversion
events so the segment applies consistently. Errors are dimension-filtered
only.

## 4. Metric definitions

Every KPI has one definition in `lib/analytics/metrics.ts` and is computed
in `lib/analytics/compute.ts` — pages can never drift.

| Metric | Formula | Denominator |
|---|---|---|
| Active Users | distinct `user_id` in sessions | sessions |
| Sessions | session rows in period | — |
| Pageviews | sum of `page_views` (or page_view events) | sessions |
| Unique Visitors | distinct `anonymous_id` | sessions |
| Conversion Rate | conversions ÷ sessions | sessions |
| Avg Session | Σ active_seconds ÷ sessions | sessions |
| Bounce Rate | sessions with ≤1 page_view ÷ sessions | sessions |
| Engagement Rate | sessions with ≥2 pageviews or ≥10s ÷ sessions | sessions |
| Revenue | Σ conversion event `metadata.value` (INR) | conversion events |
| Revenue / User | revenue ÷ unique visitors | visitors |
| Errors | error + api_error events | events |
| Retention | period visitors also active in previous period ÷ period visitors | visitors |

Revenue and conversions are always computed from **conversion events**
(`metadata.value` / `metadata.goal`) — the same source as the Revenue API —
so the two can never disagree.

## 5. API surface

All admin analytics APIs require an authenticated session with an analytics
role. They accept the global filter params above.

| Route | Capability | Purpose |
|---|---|---|
| `GET /api/admin/analytics/overview` | view | Executive KPIs + deltas + series + retention |
| `GET /api/admin/analytics/top-pages` | view | Most-viewed pages |
| `GET /api/admin/analytics/top-users` | view | Most engaged users |
| `GET /api/admin/analytics/events` | view | Raw event stream + breakdown |
| `GET /api/admin/analytics/realtime` | view | Live activity (fixed 30-min window) |
| `GET /api/admin/analytics/funnels` | view | Funnel definitions + live conversion |
| `GET /api/admin/analytics/journeys` | view | Session page-path journeys |
| `GET /api/admin/analytics/campaigns` | view | Campaign performance |
| `GET /api/admin/analytics/attribution` | view | Last-touch attribution |
| `GET /api/admin/analytics/audiences` | view | Audience member counts |
| `GET /api/admin/analytics/ux` | view | UX health + Core Web Vitals |
| `GET /api/admin/analytics/revenue` | view | Revenue intelligence |
| `GET /api/admin/analytics/alerts` | view | Alert rules + recent triggers |
| `POST /api/admin/analytics/alerts` | configure | create / toggle / delete alert |
| `GET /api/admin/analytics/audit` | configure | Audit log viewer |
| `GET /api/admin/analytics/users/[id]` | view | User profile drill-down |
| `GET /api/admin/analytics/sessions/[id]` | view | Session detail drill-down |

## 6. Security model

**Roles** (`profiles.role`, enforced server-side on every API):

| Role | View | Export | Configure | Manage users |
|---|---|---|---|---|
| `super_admin` | ✓ | ✓ | ✓ | ✓ |
| `admin` | ✓ | ✓ | ✓ | — |
| `analyst` | ✓ | ✓ | — | — |
| `viewer` | ✓ | — | — | — |
| `user` | — | — | — | — |

- `requireAnalytics(capability)` in `lib/analytics/admin.ts` is the gate for
  every analytics API (401 unauthenticated / 403 insufficient role).
- The client nav (`lib/admin-context.tsx`) is UX only — the server enforces.
- All reads/writes use the service-role client; RLS is bypassed by design
  because the Next.js route handlers are the only principals.
- The rollup cron is guarded by `CRON_SECRET` (401 without it).

**Privacy rules** (spec §15):

- Never store passwords, tokens, or API keys in analytics events.
- Sensitive fields are masked at the client tracker before ingestion.
- The audit log records actor email + action + entity (no sensitive payloads).

## 7. UI structure

- `components/admin/analytics/` — shared library:
  - `filter-context.tsx` — URL-synced global filter state
  - `filter-bar.tsx` — global filter controls
  - `header.tsx` — page header + filter bar + live indicator
  - `metric-card.tsx` — KPI card with delta + sparkline + formula tooltip
  - `data-table.tsx` — sortable / paginated / CSV-export table
  - `sparkline.tsx`, `states.tsx` — charts + loading/empty/error states
- Pages under `app/(app)/admin/analytics/` — Executive, Behavior, Events,
  Real-time, Funnels, Journeys, Campaigns, Attribution, Audiences, UX,
  Replay, AI Insights, Revenue, Alerts, Audit + drill-downs
  (users/[id], sessions/[id]).

## 8. Testing

- `tests/analytics/run_analytics_tests.sh` — Playwright smoke suite
  (login + all admin APIs + all pages render).
- `BASE_URL` env var switches between local (`http://localhost:3000`) and
  production (`https://vijaymaruthi.vercel.app`).
- Test accounts: `analytics-test@vijaymaruthi.local` (admin),
  `analytics-user@vijaymaruthi.local` (user, 403 checks).

## 9. Deferred (future phases)

- Dashboard builder, retention heatmap, performance percentiles
- AI LLM pipeline (aggregate → stat analysis → recommendations)
- Alert engine expansion (more conditions, channels)
- Session replay depth (DOM snapshots)