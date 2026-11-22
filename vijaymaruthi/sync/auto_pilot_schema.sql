-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Auto Pilot Schema (paper trading)
--  Run this in Supabase Dashboard → SQL Editor (create a new query, paste, run)
--
--  Design:
--    auto_pilot_state  → one row per user: starting capital, available cash,
--                        started_at (the "session" the pilot is running).
--    auto_pilot_trades → one row per paper position opened by the pilot.
--
--  Multi-user isolation (vijay sees ONLY vijay's pilot, mani ONLY mani's):
--    • Every table carries owner_id = auth.uid() of the row owner.
--    • Row Level Security is ENABLED on both tables.
--    • Policies allow access ONLY when auth.uid() = owner_id.
--    • The service_role key (used by Next.js route handlers) bypasses RLS,
--      but every server query still filters by owner_id — defense in depth.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Pilot state (one row per user) ──

create table if not exists public.auto_pilot_state (
    id             uuid primary key default gen_random_uuid(),
    owner_id       uuid not null references auth.users(id) on delete cascade,
    capital        double precision not null default 100000,   -- starting capital ₹
    available_cash double precision not null default 100000,   -- unallocated cash
    started_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (owner_id)
);

-- ── Paper trades ──

create table if not exists public.auto_pilot_trades (
    id            uuid primary key default gen_random_uuid(),
    owner_id      uuid not null references auth.users(id) on delete cascade,
    ticker        text not null,               -- e.g. RELIANCE.NS
    direction     text not null default 'BUY', -- BUY (long only for now)
    entry         double precision not null,   -- entry price
    target1       double precision not null,   -- take-profit level
    stop_loss     double precision not null,   -- stop-loss level
    quantity      integer not null,            -- whole shares
    notional      double precision not null,   -- quantity * entry
    qm_score      double precision,            -- snapshot of the app's score
    tech_signal   text,                        -- snapshot of the app's signal
    fund_score    double precision,            -- snapshot of the app's fundamental score
    fund_rating   text,                        -- snapshot of the app's fundamental rating
    status        text not null default 'OPEN',-- OPEN | CLOSED
    close_reason  text,                        -- take-profit | stop-loss | manual
    current_price double precision,            -- last marked price
    pnl           double precision,            -- realized/unrealized P&L (₹)
    pnl_pct       double precision,            -- P&L as % of notional
    open_date     timestamptz not null default now(),
    close_date    timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists idx_pilot_trades_owner on public.auto_pilot_trades (owner_id);
create index if not exists idx_pilot_trades_owner_status on public.auto_pilot_trades (owner_id, status);

-- ── Row Level Security ──

alter table public.auto_pilot_state  enable row level security;
alter table public.auto_pilot_trades enable row level security;

-- Users can only see / modify their OWN rows.
create policy "Users manage own pilot state"
    on public.auto_pilot_state
    for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users manage own pilot trades"
    on public.auto_pilot_trades
    for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);
