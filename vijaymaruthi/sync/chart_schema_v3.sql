-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Intraday Chart Schema v3
--  Run this in Supabase Dashboard → SQL Editor (new query → paste → Run)
--  ⚠️ Run AFTER auth_schema_v2.sql (needs public.profiles for the RLS rule)
--
--  Adds:
--    • ohlcv_intraday — one row per (ticker, interval): precomputed intraday
--      candles (jsonb) for 1m/5m/15m/30m/1h/4h, so the deployed chart can
--      render intraday timeframes without a live Yahoo call on Vercel.
--
--  Security model is IDENTICAL to public.ohlcv (chart_schema.sql):
--    1. RLS: anonymous sees NOTHING; only APPROVED logged-in users may read
--    2. service_role keeps full access (Mac cron backfill + Vercel proxy)
--
--  The Mac runs:  python3 sync_to_supabase.py --intraday-only --intraday-limit 100
--  to fill this table, then the Vercel proxy route /api/ohlcv/:symbol serves
--  it when the chart requests an intraday interval (falling back to daily).
--
--  Storage estimate (documented for capacity planning):
--    • 1h × 730d  ≈ 2,920 candles ≈ ~0.5 MB / row
--    • 1m × 7d    ≈ 2,250 candles ≈ ~0.4 MB / row
--    • 100 tickers × 6 intervals ≈ ~200 MB — acceptable; tune --intraday-limit.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Table ──

create table if not exists public.ohlcv_intraday (
    ticker     text not null,
    interval   text not null check (interval in ('1m','5m','15m','30m','1h','4h')),
    candles    jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (ticker, interval)
);

create index if not exists ohlcv_intraday_ticker_idx
    on public.ohlcv_intraday (ticker);

alter table public.ohlcv_intraday enable row level security;

-- ── 2. Row Level Security policies (same rule as ohlcv_read_approved) ──

-- Approved authenticated users may read intraday chart data
drop policy if exists "ohlcv_intraday_read_approved" on public.ohlcv_intraday;
create policy "ohlcv_intraday_read_approved"
    on public.ohlcv_intraday for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.approved
    ));

-- ── 3. Grants ──

-- Authenticated (logged-in, approved) users: read only
grant select on public.ohlcv_intraday to authenticated;

-- Anonymous (not logged in): explicitly denied everything
revoke all on public.ohlcv_intraday from anon;

-- service_role keeps full access (Mac cron + Vercel proxy) — RLS bypassed.

-- ── Done ──
select 'Intraday chart schema v3 ready' as status;