#!/usr/bin/env python3
"""
apply_schema_fix.py — apply pending Supabase schema migrations from local.

Why this exists
---------------
The sync script (sync_to_supabase.py) pushes rows to Supabase via PostgREST,
which can only run DML — it cannot run DDL (CREATE/ALTER TABLE). When the
analysis engine adds new columns (e.g. the Auto Pilot trade levels
entry_low/entry_high/target1-3/stop_loss), the production table must be
altered BEFORE the sync can push those fields. Without this, every sync
fails with HTTP 400 "Could not find the 'X' column ... in the schema cache"
and the cloud snapshot stays frozen on old data.

How it works
------------
Two connection paths, tried in order:

  1. Supabase Management API (preferred) — needs a personal access token:
       Supabase Dashboard → Account → Access Tokens → Generate new token
     Add it to sync/.env as:
       SUPABASE_ACCESS_TOKEN=sbp_...
     Runs SQL via POST https://api.supabase.com/v1/projects/{ref}/database/query

  2. Direct Postgres (fallback) — uses the service_role key as the DB
     password (works on projects where the legacy direct host is enabled).
     Tries db.<ref>.supabase.co, <ref>.supabase.com, and the pooler hosts.

Migrations are idempotent (add column if not exists), so re-running is safe.

Usage
-----
    python3 apply_schema_fix.py            # apply pending migrations
    python3 apply_schema_fix.py --check    # only report what's missing
    python3 apply_schema_fix.py --list     # list all known migrations

Config: reads sync/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
optionally SUPABASE_ACCESS_TOKEN) — same file the sync script uses.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from typing import Dict, List, Tuple

try:
    import requests
    import certifi
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

# ── Schema files (full CREATE TABLE scripts) ────────────────────────────────
# Each entry: (description, filename, primary_table). The file is applied
# (statement by statement) only when the primary table does not exist yet.
SCHEMA_FILES: List[Tuple[str, str, str]] = [
    (
        "analytics: user behavior + marketing analytics data model",
        "analytics_schema.sql",
        "analytics_events",
    ),
]


def table_exists(run_sql, table: str) -> bool:
    rows = run_sql(
        "select 1 from information_schema.tables "
        f"where table_schema = 'public' and table_name = '{table}'"
    )
    return bool(rows)


def split_sql(sql: str) -> List[str]:
    """Split a SQL script into statements on ';' at end-of-line (safe for
    CREATE TABLE / INDEX / ALTER / GRANT scripts without embedded semicolons)."""
    return [s.strip() for s in sql.split(";\n") if s.strip()]


# ── Known migrations ────────────────────────────────────────────────────────
# Each entry: (description, [sql statements]). Statements must be idempotent.
MIGRATIONS: List[Tuple[str, List[str]]] = [
    (
        "portfolio_snapshot: Auto Pilot trade levels (2026-09-04)",
        [
            "alter table public.portfolio_snapshot add column if not exists entry_low  double precision;",
            "alter table public.portfolio_snapshot add column if not exists entry_high double precision;",
            "alter table public.portfolio_snapshot add column if not exists target1    double precision;",
            "alter table public.portfolio_snapshot add column if not exists target2    double precision;",
            "alter table public.portfolio_snapshot add column if not exists target3    double precision;",
            "alter table public.portfolio_snapshot add column if not exists stop_loss  double precision;",
        ],
    ),
    (
        "portfolio_snapshot: health_pass flag (v3 methodology)",
        [
            "alter table public.portfolio_snapshot add column if not exists health_pass boolean;",
        ],
    ),
    (
        "analytics: extended roles + audit log (2026-09-14)",
        [
            "alter table public.profiles drop constraint if exists profiles_role_check;",
            "alter table public.profiles add constraint profiles_role_check check (role in ('super_admin', 'admin', 'analyst', 'viewer', 'user'));",
            "create table if not exists public.analytics_audit_log ("
            "  id uuid primary key default gen_random_uuid(),"
            "  actor_id uuid references auth.users (id) on delete set null,"
            "  actor_email text,"
            "  action text not null,"
            "  entity text not null,"
            "  entity_id text,"
            "  details jsonb,"
            "  created_at timestamptz not null default now()"
            ");",
            "alter table public.analytics_audit_log enable row level security;",
            "grant select, insert, update, delete on public.analytics_audit_log to service_role;",
        ],
    ),
    (
        "analytics: security blocklist + privacy ip prefix (2026-09-20)",
        [
            "alter table public.analytics_sessions add column if not exists ip_prefix text;"
            "alter table public.analytics_events   add column if not exists ip_prefix text;"
            "create table if not exists public.analytics_blocklist ("
            "  id uuid primary key default gen_random_uuid(),"
            "  key_type text not null,"
            "  key text not null,"
            "  reason text,"
            "  risk_score integer not null default 0,"
            "  source text not null default 'auto',"
            "  expires_at timestamptz,"
            "  hit_count integer not null default 0,"
            "  active boolean not null default true,"
            "  created_at timestamptz not null default now(),"
            "  created_by uuid references auth.users (id) on delete set null,"
            "  constraint analytics_blocklist_key_unique unique (key_type, key)"
            ");",
            "create index if not exists analytics_blocklist_active_idx on public.analytics_blocklist (active, expires_at);",
            "alter table public.analytics_blocklist enable row level security;",
            "grant select, insert, update, delete on public.analytics_blocklist to service_role;",
        ],
    ),
]


def load_dotenv(path: str) -> Dict[str, str]:
    """Minimal .env loader (KEY=VALUE lines, # comments)."""
    out: Dict[str, str] = {}
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def get_config() -> Dict[str, str]:
    cfg = {**load_dotenv(ENV_FILE), **dict(os.environ)}
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not cfg.get(k)]
    if missing:
        sys.exit(
            f"Missing required config: {', '.join(missing)}\n"
            f"  Copy sync/.env.example to sync/.env and fill in your Supabase "
            f"project URL and service_role key."
        )
    return cfg


def project_ref(cfg: Dict[str, str]) -> str:
    url = cfg["SUPABASE_URL"].rstrip("/")
    m = re.search(r"https?://([^.]+)\.supabase\.co", url)
    if not m:
        sys.exit(f"Cannot parse project ref from SUPABASE_URL: {url}")
    return m.group(1)


# ── Path 1: Supabase Management API ─────────────────────────────────────────

def run_sql_management(cfg: Dict[str, str], sql: str) -> None:
    token = cfg.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN not set")
    ref = project_ref(cfg)
    url = f"https://api.supabase.com/v1/projects/{ref}/database/query"
    if HAS_REQUESTS:
        resp = requests.post(
            url,
            json={"query": sql},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
            verify=certifi.where(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Management API HTTP {resp.status_code}: {resp.text[:300]}")
        if resp.text.strip():
            print(f"    response: {resp.text[:200]}")
        return
    req = urllib.request.Request(
        url,
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode()
            if body.strip():
                print(f"    response: {body[:200]}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:300]
        raise RuntimeError(f"Management API HTTP {exc.code}: {detail}")


# ── Path 2: Direct Postgres (fallback) ──────────────────────────────────────

def build_dsn_candidates(cfg: Dict[str, str]) -> List[str]:
    """Build candidate libpq DSNs (service_role key as the DB password)."""
    ref = project_ref(cfg)
    key = cfg["SUPABASE_SERVICE_ROLE_KEY"]
    base = f"dbname=postgres user=postgres password={key} sslmode=require connect_timeout=15"
    candidates = [
        f"host=db.{ref}.supabase.co port=5432 {base}",
        f"host={ref}.supabase.com port=5432 {base}",
    ]
    pooler_base = base.replace("user=postgres ", f"user=postgres.{ref} ", 1)
    for region in ("ap-south-1", "ap-southeast-1", "us-east-1", "us-west-1", "eu-west-1"):
        candidates.append(f"host=aws-0-{region}.pooler.supabase.com port=5432 {pooler_base}")
        candidates.append(f"host=aws-0-{region}.pooler.supabase.com port=6543 {pooler_base}")
    return candidates


def run_sql_direct(cfg: Dict[str, str], sql: str) -> None:
    try:
        import psycopg2
    except ImportError:
        raise RuntimeError("psycopg2 is required for the direct path: pip install psycopg2-binary")
    last_exc: Exception | None = None
    for dsn in build_dsn_candidates(cfg):
        try:
            conn = psycopg2.connect(dsn)
            cur = conn.cursor()
            cur.execute(sql)
            conn.commit()
            cur.close()
            conn.close()
            return
        except Exception as exc:
            last_exc = exc
    raise last_exc if last_exc else RuntimeError("no connection candidates")


# ── Migration helpers ───────────────────────────────────────────────────────

def existing_columns_via_sql(run_sql, table: str) -> set:
    """Return the set of column names for a table by running a query.

    run_sql must accept SQL and return rows (list of tuples) or None.
    """
    rows = run_sql(
        "select column_name from information_schema.columns "
        f"where table_schema = 'public' and table_name = '{table}'"
    )
    return {r[0] for r in (rows or [])}


def make_runner(cfg: Dict[str, str]):
    """Return a run_sql callable that returns rows when possible."""
    if cfg.get("SUPABASE_ACCESS_TOKEN"):
        def run_sql(sql: str):
            token = cfg["SUPABASE_ACCESS_TOKEN"]
            ref = project_ref(cfg)
            url = f"https://api.supabase.com/v1/projects/{ref}/database/query"
            if HAS_REQUESTS:
                resp = requests.post(
                    url,
                    json={"query": sql},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=60,
                    verify=certifi.where(),
                )
                if resp.status_code >= 400:
                    raise RuntimeError(f"Management API HTTP {resp.status_code}: {resp.text[:300]}")
                if not resp.text.strip():
                    return []
                data = resp.json()
                if isinstance(data, dict) and "result" in data:
                    return data["result"]
                return data if isinstance(data, list) else []
            req = urllib.request.Request(
                url,
                data=json.dumps({"query": sql}).encode(),
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    body = resp.read().decode()
                    if not body.strip():
                        return []
                    data = json.loads(body)
                    # Management API returns {"result": [...]} or a list
                    if isinstance(data, dict) and "result" in data:
                        return data["result"]
                    return data if isinstance(data, list) else []
            except urllib.error.HTTPError as exc:
                raise RuntimeError(f"Management API HTTP {exc.code}: {exc.read().decode()[:300]}")
        return run_sql, "management-api"

    def run_sql(sql: str):
        try:
            import psycopg2
        except ImportError:
            raise RuntimeError("psycopg2 is required for the direct path")
        last_exc: Exception | None = None
        for dsn in build_dsn_candidates(cfg):
            try:
                conn = psycopg2.connect(dsn)
                cur = conn.cursor()
                cur.execute(sql)
                if cur.description:
                    rows = cur.fetchall()
                else:
                    rows = []
                conn.commit()
                cur.close()
                conn.close()
                return rows
            except Exception as exc:
                last_exc = exc
        raise last_exc if last_exc else RuntimeError("no connection candidates")
    return run_sql, "direct-postgres"


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply pending Supabase schema migrations")
    ap.add_argument("--check", action="store_true", help="only report what's missing, don't apply")
    ap.add_argument("--list", action="store_true", help="list known migrations and exit")
    args = ap.parse_args()

    if args.list:
        for i, (desc, stmts) in enumerate(MIGRATIONS, 1):
            print(f"{i}. {desc}")
            for s in stmts:
                print(f"     {s}")
        return 0

    cfg = get_config()
    run_sql, path = make_runner(cfg)
    print(f"Using connection path: {path}")

    try:
        pending = 0

        # ── Schema files (full CREATE TABLE scripts) ──
        for desc, filename, primary_table in SCHEMA_FILES:
            if table_exists(run_sql, primary_table):
                print(f"OK   {desc} — already applied")
                continue
            print(f"PEND {desc} — applying {filename} …")
            sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
            with open(sql_path, encoding="utf-8") as fh:
                sql = fh.read()
            stmts = split_sql(sql)
            if args.check:
                print(f"  would apply {len(stmts)} statement(s)")
                pending += 1
                continue
            for stmt in stmts:
                run_sql(stmt)
            print(f"  ✔ applied {len(stmts)} statement(s)")

        # ── Column migrations ──
        for desc, stmts in MIGRATIONS:
            table = re.search(r"alter table public\.(\w+)", stmts[0]).group(1)
            want = {re.search(r"add column if not exists (\w+)", s).group(1) for s in stmts}
            have = existing_columns_via_sql(run_sql, table)
            missing = sorted(want - have)
            if not missing:
                print(f"OK   {desc} — already applied")
                continue
            print(f"PEND {desc} — missing: {', '.join(missing)}")
            pending += 1
            if args.check:
                continue
            for stmt in stmts:
                run_sql(stmt)
            print(f"  ✔ applied {len(stmts)} statement(s)")

        if args.check:
            print("\nCheck complete." if pending == 0 else f"\n{pending} migration(s) pending.")
            return 0 if pending == 0 else 2

        print("\nAll migrations applied ✔")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())