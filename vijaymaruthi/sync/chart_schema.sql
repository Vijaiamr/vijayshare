-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Chart & Fundamentals Schema (Option B)
--  Run this in Supabase Dashboard → SQL Editor (new query → paste → Run)
--  ⚠️ Run AFTER auth_schema_v2.sql (needs public.profiles for the RLS rule)
--
--  Adds:
--    • ohlcv        — one row per ticker: precomputed 5y daily candles (jsonb)
--    • fundamentals — one row per ticker: normalized fundamental snapshot (jsonb)
--
--  Security model is IDENTICAL to portfolio_snapshot:
--    1. RLS: anonymous sees NOTHING; only APPROVED logged-in users may read
--    2. service_role keeps full access (Mac cron backfill + Vercel proxy)
--
--  The Mac runs:  python3 sync_to_supabase.py --ohlcv-only --ohlcv-limit 500
--  to fill these tables, then the Vercel proxy routes /api/ohlcv/:symbol and
--  /api/fundamentals/:symbol serve them through the same auth as /api/dashboard.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Tables ──

create table if not exists public.ohlcv (
    ticker     text primary key,
    candles    jsonb not null default '[]'::jsonb,
    period     text not null default '5y',
    updated_at timestamptz not null default now()
);

create table if not exists public.fundamentals (
    ticker     text primary key,
    data       jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.ohlcv        enable row level security;
alter table public.fundamentals enable row level security;

-- ── 2. Row Level Security policies (same rule as snapshot_read_approved) ──

-- Approved authenticated users may read chart data
drop policy if exists "ohlcv_read_approved" on public.ohlcv;
create policy "ohlcv_read_approved"
    on public.ohlcv for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.approved
    ));

drop policy if exists "fundamentals_read_approved" on public.fundamentals;
create policy "fundamentals_read_approved"
    on public.fundamentals for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.approved
    ));

-- ── 3. Grants ──

-- Authenticated (logged-in, approved) users: read only
grant select on public.ohlcv        to authenticated;
grant select on public.fundamentals to authenticated;

-- Anonymous (not logged in): explicitly denied everything
revoke all on public.ohlcv        from anon;
revoke all on public.fundamentals from anon;

-- service_role keeps full access (Mac cron + Vercel proxy) — RLS bypassed.

-- ── Done ──
select 'Chart schema ready' as status;
