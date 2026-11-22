-- ═══════════════════════════════════════════════════════════════════════
--  VijayMaruthi Wealth Management — Auth & Security Schema (v2)
--  Run this in Supabase Dashboard → SQL Editor (new query → paste → Run)
--
--  Adds:
--    • profiles table (one row per auth user: email, role, approved)
--    • auto-create profile when a user signs up (trigger on auth.users)
--    • FIRST user to sign up becomes admin + approved (that's you)
--    • is_admin() helper used by RLS policies
--    • RLS: anonymous sees NOTHING; only APPROVED logged-in users may read
--      the dashboard data; users can read/update their own profile
--
--  Security model (defense in depth):
--    1. Middleware redirects unauthenticated visitors to /login
--    2. /api/dashboard proxy requires a valid session + approved profile
--    3. RLS blocks anonymous access even if someone bypasses the app
--    4. The Mac cron keeps using service_role (full access, bypasses RLS)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Profiles table ──

create table if not exists public.profiles (
    id         uuid primary key references auth.users (id) on delete cascade,
    email      text unique not null,
    role       text not null default 'user' check (role in ('admin', 'user')),
    approved   boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ── 2. Auto-create profile on signup; first user becomes admin ──

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    is_first boolean;
begin
    select not exists (select 1 from public.profiles) into is_first;
    insert into public.profiles (id, email, role, approved)
    values (new.id, new.email,
            case when is_first then 'admin' else 'user' end,
            is_first)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ── 3. Admin helper ──

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    );
$$;

-- ── 4. Row Level Security policies ──

-- Profiles: users may read & update their own row; admins may read all
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select to authenticated
    using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update to authenticated
    using (auth.uid() = id);

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
    on public.profiles for select to authenticated
    using (public.is_admin());

-- Dashboard data: only APPROVED authenticated users may read.
-- (The app normally reads via the server proxy; this protects direct reads.)
drop policy if exists "snapshot_read_approved" on public.portfolio_snapshot;
create policy "snapshot_read_approved"
    on public.portfolio_snapshot for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.approved
    ));

drop policy if exists "meta_read_approved" on public.sync_meta;
create policy "meta_read_approved"
    on public.sync_meta for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.approved
    ));

-- ── 5. Grants ──

-- Authenticated (logged-in) users: read dashboard data, manage own profile
grant select on public.portfolio_snapshot to authenticated;
grant select on public.sync_meta          to authenticated;
grant select, update on public.profiles   to authenticated;

-- Anonymous (not logged in): explicitly denied everything
revoke all on public.portfolio_snapshot from anon;
revoke all on public.sync_meta          from anon;
revoke all on public.profiles           from anon;

-- service_role keeps full access (Mac cron + Vercel proxy) — RLS bypassed.

-- ── Done ──
select 'Auth schema ready' as status;
