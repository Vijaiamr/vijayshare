-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Ledger Schema (per-user spending tracker)
--  Run this in Supabase Dashboard → SQL Editor (create a new query, paste, run)
--
--  Design:
--    ledger_transactions → one row per bank-statement transaction
--    ledger_budgets      → per-category monthly budget limits
--    ledger_corrections  → user-taught categorization overrides
--
--  Multi-user isolation (vijay sees ONLY vijay's data, mani ONLY mani's):
--    • Every table carries owner_id = auth.uid() of the row owner.
--    • Row Level Security is ENABLED on all three tables.
--    • Policies allow access ONLY when auth.uid() = owner_id.
--    • The service_role key (used by Next.js route handlers) bypasses RLS,
--      but every server query still filters by owner_id — defense in depth.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Transactions ──

create table if not exists public.ledger_transactions (
    id               uuid primary key default gen_random_uuid(),
    owner_id         uuid not null references auth.users(id) on delete cascade,
    date             text not null,               -- YYYY-MM-DD
    description      text not null,
    amount           double precision not null,   -- positive = expense, negative = income
    categories       jsonb not null default '[]'::jsonb,
    recurring        boolean not null default false,
    confidence       text,                        -- high / medium / low
    matched_keywords jsonb,                       -- { category: matchedKeyword }
    learned          boolean not null default false,
    payee            text,                        -- extracted UPI payee key
    raw_category     text,                        -- category supplied by the file itself
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists idx_ledger_tx_owner_date on public.ledger_transactions (owner_id, date desc);
create index if not exists idx_ledger_tx_owner      on public.ledger_transactions (owner_id);

-- ── Budgets ──

create table if not exists public.ledger_budgets (
    id                   uuid primary key default gen_random_uuid(),
    owner_id             uuid not null references auth.users(id) on delete cascade,
    category             text not null,
    suggested_percentage double precision,
    limit_amount         double precision not null,
    updated_at           timestamptz not null default now(),
    unique (owner_id, category)
);

-- ── Learned corrections ──

create table if not exists public.ledger_corrections (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null references auth.users(id) on delete cascade,
    description text not null,
    categories  jsonb not null default '[]'::jsonb,
    payee       text,
    created_at  timestamptz not null default now(),
    unique (owner_id, description)
);

-- ── Row Level Security ──

alter table public.ledger_transactions enable row level security;
alter table public.ledger_budgets      enable row level security;
alter table public.ledger_corrections  enable row level security;

-- Users can only see / modify their OWN rows.
create policy "Users manage own ledger transactions"
    on public.ledger_transactions
    for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users manage own ledger budgets"
    on public.ledger_budgets
    for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users manage own ledger corrections"
    on public.ledger_corrections
    for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

-- ── Grants ──
-- Service role bypasses RLS automatically. Explicit grants keep the schema
-- self-documenting and allow the anon key to be locked down by default.

grant select, insert, update, delete on public.ledger_transactions to service_role;
grant select, insert, update, delete on public.ledger_budgets      to service_role;
grant select, insert, update, delete on public.ledger_corrections  to service_role;

-- NOTE: no grants to anon/authenticated — browser clients never touch these
-- tables directly. All access goes through Next.js route handlers which use
-- the service_role key server-side and filter by the authenticated user.