-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Supabase Schema (Option B pipeline)
--  Run this in Supabase Dashboard → SQL Editor (create a new query, paste, run)
--
--  Design:
--    portfolio_snapshot  → one row per ticker (latest analysis from your Mac)
--    sync_meta           → key/value sync metadata (last sync time, counts)
--
--  Security (default = LOCKED DOWN):
--    • Row Level Security enabled on both tables
--    • NO anonymous read policy → the browser anon key can see NOTHING
--    • Only the service_role key can read/write (used by your Mac cron
--      script and by your Vercel server-side proxy route)
--    • If you later want public dashboard access, uncomment the anon policy
-- ═══════════════════════════════════════════════════════════════════════

-- ── Dashboard snapshot: latest analysis per ticker ──

create table if not exists public.portfolio_snapshot (
    ticker           text primary key,          -- e.g. 'RELIANCE.NS'
    price            double precision,
    qm_rating        text,                      -- Strong Buy / Buy / Hold / Sell / Strong Sell
    qm_score         double precision,          -- 0-100 blended
    tech_signal      text,                      -- BUY / SELL / HOLD
    tech_confidence  double precision,          -- 0-100
    tech_score       double precision,          -- 0-100
    fund_rating      text,                      -- screening rating
    fund_score       double precision,          -- 0-100
    cap_category     text,                      -- large / mid / small
    trend            text,                      -- improving / deteriorating / stable
    score_change     double precision,          -- vs previous run
    last_analyzed    date,                      -- YYYY-MM-DD of latest run
    history_runs     integer,                   -- number of tracked runs
    health_pass      boolean,                   -- v3 health methodology (null = pre-v3)
    rank             integer,                   -- 1 = highest qm_score
    cached           boolean default true,
    updated_at       timestamptz default now()
);

create index if not exists idx_snapshot_qm_score on public.portfolio_snapshot (qm_score desc);
create index if not exists idx_snapshot_rating   on public.portfolio_snapshot (qm_rating);

-- ── Real-engine trade levels (Auto Pilot) ────────────────────────────────
-- Added 2026-09-04 so the Auto Pilot can trade on the SAME analysis engine
-- as the rest of the platform (entry_zone / targets / invalidation from
-- _classify_signal). Idempotent for existing tables.
alter table public.portfolio_snapshot add column if not exists entry_low  double precision;
alter table public.portfolio_snapshot add column if not exists entry_high double precision;
alter table public.portfolio_snapshot add column if not exists target1    double precision;
alter table public.portfolio_snapshot add column if not exists target2    double precision;
alter table public.portfolio_snapshot add column if not exists target3    double precision;
alter table public.portfolio_snapshot add column if not exists stop_loss  double precision;

-- ── Sync metadata ──

create table if not exists public.sync_meta (
    key        text primary key,
    value      text,
    updated_at timestamptz default now()
);

-- ── Row Level Security ──

alter table public.portfolio_snapshot enable row level security;
alter table public.sync_meta          enable row level security;

-- Service role (used by Mac cron + Vercel server proxy) — full access.
-- NOTE: service_role bypasses RLS automatically; policies below are for
-- completeness and explicit grants.

-- ── Grants ──
-- Only service_role can touch the data. The anon key gets NOTHING.

grant select, insert, update, delete on public.portfolio_snapshot to service_role;
grant select, insert, update, delete on public.sync_meta          to service_role;

-- ── Optional: allow public read (UNCOMMENT only if you want the live
--    dashboard readable by anyone with the URL — e.g. shared reports).
--    Otherwise keep locked down; the app reads via your server proxy.

-- create policy "anon read snapshot" on public.portfolio_snapshot
--   for select to anon using (true);
-- create policy "anon read meta" on public.sync_meta
--   for select to anon using (true);
-- grant select on public.portfolio_snapshot to anon;
-- grant select on public.sync_meta          to anon;

-- ── Done ──
select 'Schema ready' as status;
