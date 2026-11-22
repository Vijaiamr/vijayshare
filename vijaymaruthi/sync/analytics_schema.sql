-- ═══════════════════════════════════════════════════════════════════════
--  analytics_schema.sql — User Behavior + Marketing Analytics data model
--
--  Event-based analytics (extensible event schema). All tables are
--  ADMIN-ONLY: RLS is enabled and NO grants are given to anon or
--  authenticated. The browser never touches these tables directly —
--  every read/write goes through Next.js route handlers using the
--  service_role key (admin-gated for reads).
--
--  Security model (defense in depth):
--    1. Client tracker → POST /api/analytics/collect (service_role insert)
--    2. Admin dashboards → GET /api/admin/analytics/* (requireAdmin + service_role)
--    3. RLS blocks anonymous/authenticated access even if bypassed
--    4. Nightly rollup (Vercel Cron) writes analytics_daily + fires alerts
--
--  Privacy (section 16):
--    • No passwords / payment credentials / auth tokens / form values
--    • user_id is nullable — anonymous activity stays anonymous
--    • Deleting an auth user cascades to their analytics rows
--    • Raw events pruned by retention policy (rollup job); aggregates kept
--
--  NOTE: this file is applied by sync/apply_schema_fix.py (SCHEMA_FILES)
--  only when public.analytics_events does not exist yet. The column shapes
--  below match the Next.js route handlers exactly (collect / admin / cron).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Events (the core event stream) ──

create table if not exists public.analytics_events (
    id           uuid primary key,               -- client-generated (dedup key)
    session_id   uuid not null,
    user_id      uuid references auth.users (id) on delete cascade,  -- nullable = anonymous
    anonymous_id text,
    event_name   text not null,                  -- page_view | time_spent | click | rage_click | dead_click | scroll | form_start | form_interact | form_abandon | outbound_link | download | error | cwv | session_start | conversion | funnel_step | ...
    page_path    text,                           -- normalized app route (/market, /stock/RELIANCE)
    page_url     text,                           -- full URL (for UTM/referrer parsing)
    referrer     text,
    source       text,                           -- utm_source / referrer-derived
    medium       text,                           -- utm_medium
    campaign     text,                           -- utm_campaign
    device       text,                           -- mobile | tablet | desktop
    browser      text,
    os           text,
    screen       text,                           -- "1440x900"
    country      text,                           -- from Vercel reader header (server-side)
    ip_prefix    text,                           -- PRIVACY: truncated network prefix only (IPv4 /24, IPv6 /64 — k-anonymous). NEVER a raw IP.
    is_active    boolean not null default true,  -- false = idle/background time
    metadata     jsonb not null default '{}'::jsonb,  -- extensible: scroll depth, element, error, value, cwv, ...
    events_at    timestamptz not null default now(),
    received_at  timestamptz not null default now()
);

create index if not exists analytics_events_at_idx      on public.analytics_events (events_at desc);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id);
create index if not exists analytics_events_user_idx    on public.analytics_events (user_id);
create index if not exists analytics_events_name_idx    on public.analytics_events (event_name);
create index if not exists analytics_events_source_idx  on public.analytics_events (source, medium, campaign);

-- ── 2. Sessions ──

create table if not exists public.analytics_sessions (
    id                 uuid primary key,          -- session_id
    user_id            uuid references auth.users (id) on delete cascade,
    anonymous_id       text,
    started_at         timestamptz not null default now(),
    last_seen_at       timestamptz not null default now(),
    ended_at           timestamptz,
    duration_seconds   integer not null default 0,
    active_seconds     integer not null default 0,
    idle_seconds       integer not null default 0,
    entry_page         text,
    exit_page          text,
    device             text,
    browser            text,
    os                 text,
    screen             text,
    country            text,
    ip_prefix          text,   -- PRIVACY: IPv4 /24 or IPv6 /64 truncated network prefix only — NEVER a raw IP (k-anonymity).
    source             text,
    medium             text,
    campaign           text,
    is_bounce          boolean not null default false,
    page_views         integer not null default 0,
    conversions        integer not null default 0,
    conversion_value   numeric not null default 0
);

create index if not exists analytics_sessions_user_idx  on public.analytics_sessions (user_id);
create index if not exists analytics_sessions_start_idx on public.analytics_sessions (started_at desc);
create index if not exists analytics_sessions_seen_idx  on public.analytics_sessions (last_seen_at desc);

-- ── 3. Identity map (anonymous → identified merge) ──

create table if not exists public.analytics_identity (
    anonymous_id    text primary key,
    user_id         uuid not null references auth.users (id) on delete cascade,
    first_linked_at timestamptz not null default now()
);

-- ── 4. Daily rollups (nightly job; fast dashboard queries) ──
-- Key-value shape: one row per (date, metric). Written by the Vercel cron
-- /api/cron/analytics-rollup; read by the admin dashboards.

create table if not exists public.analytics_daily (
    date   date not null,
    metric text not null,   -- pageviews | sessions | visitors | conversions | revenue | errors | avg_session_seconds | bounce_rate | conversion_rate
    value  numeric not null default 0,
    primary key (date, metric)
);

create index if not exists analytics_daily_date_idx on public.analytics_daily (date desc);

-- ── 5. Funnel definitions ──

create table if not exists public.analytics_funnels (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    steps      jsonb not null default '[]'::jsonb,  -- [{type:'page'|'event', value:'/market'}]
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ── 6. Audience definitions ──

create table if not exists public.analytics_audiences (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    definition jsonb not null default '{}'::jsonb,  -- {type:'source'|'country'|'device'|'returning'|'converted'|'engaged', value:...}
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ── 7. Alert definitions ──

create table if not exists public.analytics_alerts (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    condition  jsonb not null default '{}'::jsonb,  -- {metric:'bounce_rate'|'conversion_rate'|'pageviews'|'errors', op:'gt'|'lt', value:number}
    enabled    boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ── 8. Fired-alert history ──

create table if not exists public.analytics_alert_events (
    id           uuid primary key default gen_random_uuid(),
    alert_id     uuid references public.analytics_alerts (id) on delete cascade,
    payload      jsonb not null default '{}'::jsonb,  -- {metric, op, threshold, actual, date}
    triggered_at timestamptz not null default now()
);

create index if not exists analytics_alert_events_alert_idx on public.analytics_alert_events (alert_id, triggered_at desc);

-- ── Seed: default funnels + audiences (idempotent) ──

insert into public.analytics_funnels (name, steps) values
    ('Signup funnel', '[{"type":"page","value":"/login"},{"type":"page","value":"/signup"},{"type":"event","value":"conversion"}]'::jsonb)
on conflict do nothing;

insert into public.analytics_audiences (name, definition) values
    ('Returning visitors', '{"type":"returning","value":true}'::jsonb),
    ('Converted users',    '{"type":"converted","value":true}'::jsonb),
    ('Engaged users',      '{"type":"engaged","value":true}'::jsonb),
    ('Mobile users',       '{"type":"device","value":"mobile"}'::jsonb)
on conflict do nothing;

-- ── 7b. Security blocklist (risk-scored, expiry-aware) ──
-- Privacy-safe by construction: keys are k-anonymous network prefixes
-- (IPv4 /24, IPv6 /64), anonymous_ids, devices, and countries — NEVER raw IP.
-- Enforced at the top of the collect route + admin-raced (auto-burn after
-- N consecutive blocklist hits).

create table if not exists public.analytics_blocklist (
    id           uuid primary key default gen_random_uuid(),
    key_type     text not null check (key_type in ('anonymous_id','ip_prefix','device','country')),
    key          text not null,
    reason       text,
    risk_score   integer not null default 40,
    source       text not null default 'auto' check (source in ('auto','manual')),
    expires_at   timestamptz,
    hit_count    integer not null default 0,
    active       boolean not null default true,
    created_by   uuid references auth.users (id) on delete set null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (key_type, key)
);

create index if not exists analytics_blocklist_active_idx on public.analytics_blocklist (active, expires_at);

-- ── Row Level Security ──
-- Admin-only by construction: no anon/authenticated grants at all.
-- service_role bypasses RLS and is the only principal that ever touches
-- these tables (via Next.js route handlers).

alter table public.analytics_events        enable row level security;
alter table public.analytics_sessions      enable row level security;
alter table public.analytics_identity      enable row level security;
alter table public.analytics_daily         enable row level security;
alter table public.analytics_funnels       enable row level security;
alter table public.analytics_audiences     enable row level security;
alter table public.analytics_alerts        enable row level security;
alter table public.analytics_alert_events  enable row level security;
alter table public.analytics_blocklist                 enable row level security;

grant select, insert, update, delete on public.analytics_events        to service_role;
grant select, insert, update, delete on public.analytics_sessions      to service_role;
grant select, insert, update, delete on public.analytics_identity      to service_role;
grant select, insert, update, delete on public.analytics_daily         to service_role;
grant select, insert, update, delete on public.analytics_funnels       to service_role;
grant select, insert, update, delete on public.analytics_audiences     to service_role;
grant select, insert, update, delete on public.analytics_alerts        to service_role;
grant select, insert, update, delete on public.analytics_alert_events  to service_role;
grant select, insert, update, delete on public.analytics_blocklist    to service_role;

-- NOTE: no grants to anon/authenticated — browser clients never touch these
-- tables. All access goes through Next.js route handlers (service_role).