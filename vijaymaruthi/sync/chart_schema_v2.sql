-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Chart Interactivity Schema v2
--  Run this in Supabase Dashboard → SQL Editor (new query → paste → Run)
--  ⚠️ Run AFTER auth_schema_v2.sql (needs public.profiles for the RLS rule)
--
--  Adds:
--    • chart_drawings    — user drawing objects per (ticker, interval)
--    • chart_layouts     — saved multi-chart layouts per user
--    • chart_alerts      — in-app price alerts per user (Phase C4)
--    • chart_notifications — fired alert notifications per user (Phase C4)
--
--  Security model: each user may only read/write THEIR OWN rows
--  (user_id = auth.uid()). service_role keeps full access (Vercel proxy).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Tables ──

create table if not exists public.chart_drawings (
    id         text primary key,             -- client-generated (d_...)
    user_id    uuid not null references auth.users(id) on delete cascade,
    ticker     text not null,
    interval   text not null default '1d',
    type       text not null,                 -- trendline|hline|vline|fib|rect|text|measure
    points     jsonb not null default '[]'::jsonb,  -- [{time, price}, ...]
    text       text,
    color      text not null default '#22d3ee',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists chart_drawings_user_ticker_idx
    on public.chart_drawings (user_id, ticker, interval);

create table if not exists public.chart_layouts (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    name       text not null,
    layout     jsonb not null default '[]'::jsonb,  -- [{ticker, interval, lookback, chartType}, ...]
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists chart_layouts_user_idx
    on public.chart_layouts (user_id);

create table if not exists public.chart_alerts (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    ticker     text not null,
    direction  text not null check (direction in ('above', 'below')),
    price      numeric not null,
    note       text,
    active     boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists chart_alerts_user_idx
    on public.chart_alerts (user_id, active);

create table if not exists public.chart_notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    alert_id   uuid references public.chart_alerts(id) on delete set null,
    ticker     text not null,
    message    text not null,
    read       boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists chart_notifications_user_idx
    on public.chart_notifications (user_id, read);

-- ── 2. Row Level Security (own rows only) ──

alter table public.chart_drawings      enable row level security;
alter table public.chart_layouts       enable row level security;
alter table public.chart_alerts        enable row level security;
alter table public.chart_notifications enable row level security;

-- chart_drawings
drop policy if exists "chart_drawings_select_own" on public.chart_drawings;
create policy "chart_drawings_select_own"
    on public.chart_drawings for select to authenticated
    using (user_id = auth.uid());

drop policy if exists "chart_drawings_insert_own" on public.chart_drawings;
create policy "chart_drawings_insert_own"
    on public.chart_drawings for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists "chart_drawings_update_own" on public.chart_drawings;
create policy "chart_drawings_update_own"
    on public.chart_drawings for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "chart_drawings_delete_own" on public.chart_drawings;
create policy "chart_drawings_delete_own"
    on public.chart_drawings for delete to authenticated
    using (user_id = auth.uid());

-- chart_layouts
drop policy if exists "chart_layouts_select_own" on public.chart_layouts;
create policy "chart_layouts_select_own"
    on public.chart_layouts for select to authenticated
    using (user_id = auth.uid());

drop policy if exists "chart_layouts_insert_own" on public.chart_layouts;
create policy "chart_layouts_insert_own"
    on public.chart_layouts for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists "chart_layouts_update_own" on public.chart_layouts;
create policy "chart_layouts_update_own"
    on public.chart_layouts for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "chart_layouts_delete_own" on public.chart_layouts;
create policy "chart_layouts_delete_own"
    on public.chart_layouts for delete to authenticated
    using (user_id = auth.uid());

-- chart_alerts
drop policy if exists "chart_alerts_select_own" on public.chart_alerts;
create policy "chart_alerts_select_own"
    on public.chart_alerts for select to authenticated
    using (user_id = auth.uid());

drop policy if exists "chart_alerts_insert_own" on public.chart_alerts;
create policy "chart_alerts_insert_own"
    on public.chart_alerts for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists "chart_alerts_update_own" on public.chart_alerts;
create policy "chart_alerts_update_own"
    on public.chart_alerts for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "chart_alerts_delete_own" on public.chart_alerts;
create policy "chart_alerts_delete_own"
    on public.chart_alerts for delete to authenticated
    using (user_id = auth.uid());

-- chart_notifications
drop policy if exists "chart_notifications_select_own" on public.chart_notifications;
create policy "chart_notifications_select_own"
    on public.chart_notifications for select to authenticated
    using (user_id = auth.uid());

drop policy if exists "chart_notifications_insert_own" on public.chart_notifications;
create policy "chart_notifications_insert_own"
    on public.chart_notifications for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists "chart_notifications_update_own" on public.chart_notifications;
create policy "chart_notifications_update_own"
    on public.chart_notifications for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "chart_notifications_delete_own" on public.chart_notifications;
create policy "chart_notifications_delete_own"
    on public.chart_notifications for delete to authenticated
    using (user_id = auth.uid());

-- ── 3. Grants ──

grant select, insert, update, delete on
    public.chart_drawings, public.chart_layouts,
    public.chart_alerts, public.chart_notifications
    to authenticated;

-- Anonymous: explicitly denied everything
revoke all on public.chart_drawings, public.chart_layouts,
    public.chart_alerts, public.chart_notifications
    from anon;

-- service_role keeps full access (Vercel proxy) — RLS bypassed.

-- ── Done ──
select 'Chart interactivity schema v2 ready' as status;