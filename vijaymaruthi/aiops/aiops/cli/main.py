"""AIOps CLI — entry point ``aiops`` (see pyproject.toml).

Subcommands: init, status, morning, evening, backtest, lessons, validate, serve.
Exit codes: 0 success, 1 error.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from typing import Any

from .. import config
from ..db.engine import connect, init_db
from ..learning.knowledge import current_knowledge
from ..learning.lessons import list_lessons, promote_lessons
from ..learning.recipes import seed_default_recipes
from ..opencode.client import OpenCodeClient
from ..workflows.backtest import run_backtest
from ..workflows.evening import run_evening
from ..workflows.morning import run_morning
from ..workflows.runs import build_status


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="aiops",
        description="AIOPS — NSE AI Market Intelligence & Continuous Learning Agent",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="create DB, schema, seed symbols + recipes")

    sub.add_parser("status", help="show runs, predictions, validation, lessons, calibration, knowledge")

    p_morning = sub.add_parser("morning", help="fetch data and predict for day D")
    p_morning.add_argument("--date", default=None, help="YYYY-MM-DD (default: today IST)")
    p_morning.add_argument("--force", action="store_true", help="re-run even if completed")
    p_morning.add_argument("--mode", choices=["llm", "baseline"], default="llm")

    p_evening = sub.add_parser("evening", help="fetch D close, validate, calibrate")
    p_evening.add_argument("--date", default=None, help="YYYY-MM-DD (default: today IST)")
    p_evening.add_argument("--force", action="store_true", help="re-run even if completed")

    p_backtest = sub.add_parser("backtest", help="replay trading days (last N or a date range)")
    p_backtest.add_argument("--days", type=int, default=None, help="last N trading days (backward compat)")
    p_backtest.add_argument("--start", default=None, help="YYYY-MM-DD start date (default: today - years)")
    p_backtest.add_argument("--end", default=None, help="YYYY-MM-DD end date (default: today, or start + years when --start given)")
    p_backtest.add_argument("--years", type=int, default=5, help="years back (default 5 when --start given)")
    p_backtest.add_argument("--mode", choices=["llm", "baseline"], default="baseline")
    p_backtest.add_argument("--validate-mode", choices=["deterministic", "agent"], default="deterministic")

    p_fundamentals = sub.add_parser("fundamentals", help="fetch current fundamentals for active symbols")
    p_data = sub.add_parser("data", help="show per-symbol market_daily coverage")

    p_lessons = sub.add_parser("lessons", help="list or promote lessons")
    p_lessons.add_argument("--promote", action="store_true", help="promote/reject lessons with enough observations")

    sub.add_parser("validate", help="run internal consistency checks")

    sub.add_parser("serve", help="local HTTP API (P4 — not yet implemented)")

    return parser


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    return date.fromisoformat(value)


def _make_llm_client() -> OpenCodeClient:
    return OpenCodeClient(
        base_url=config.OPENCODE_SERVER_URL,
        password=config.OPENCODE_SERVER_PASSWORD,
        agent=config.OPENCODE_AGENT,
        directory=config.OPENCODE_DIRECTORY,
        model=config.OPENCODE_MODEL,
    )


def _llm_client_or_error() -> OpenCodeClient | None:
    client = _make_llm_client()
    if not client.health():
        print(
            f"error: opencode server not reachable at {config.OPENCODE_SERVER_URL} "
            f"(start `opencode serve` or use --mode baseline)",
            file=sys.stderr,
        )
        return None
    return client


# ── Commands ────────────────────────────────────────────────────────────────

def cmd_init() -> int:
    conn = init_db()
    n = seed_default_recipes(conn)
    conn.close()
    print(f"initialized database at {config.DB_PATH}")
    print(f"seeded {len(config.symbols())} symbols, {n} recipes")
    return 0


def cmd_status() -> int:
    conn = connect()
    try:
        s = build_status(conn)
    finally:
        conn.close()
    print("AIOPS status")
    print("===========")
    kv = s["knowledge"]
    print(f"knowledge: version={kv['knowledge_version']} hash={kv['knowledge_hash'] or '(none)'}")
    print(f"predictions: {s['predictions']}")
    v = s["validation"]
    print(f"validation: total={v['total']} hits={v['hits']} hit_rate={v['hit_rate']}")
    lessons = s["lessons"]
    print(
        "lessons: "
        + ", ".join(f"{k}={lessons.get(k, 0)}" for k in ("proposed", "accepted", "rejected"))
    )
    print("runs (last 10):")
    for r in s["runs"][:10]:
        print(
            f"  #{r['id']} {r['run_type']} {r['run_date']} {r['status']} "
            f"as_of={r['as_of'] or '-'}"
        )
    if s["calibration"]:
        print("calibration:")
        for c in s["calibration"]:
            print(
                f"  {c['symbol']} {c['bucket']} n={c['n']} hits={c['hits']} "
                f"hit_rate={c['hit_rate']}"
            )
    else:
        print("calibration: (none)")
    return 0


def cmd_morning(args: argparse.Namespace) -> int:
    llm_client = None
    if args.mode == "llm":
        llm_client = _llm_client_or_error()
        if llm_client is None:
            return 1
    conn = connect()
    try:
        res = run_morning(
            conn,
            run_date=_parse_date(args.date),
            force=args.force,
            mode=args.mode,
            llm_client=llm_client,
        )
    finally:
        conn.close()
    if res.get("skipped"):
        print(f"morning {res['date']}: skipped (already completed; use --force to re-run)")
        return 0
    print(f"morning run #{res['run_id']} for {res['date']} (mode={args.mode})")
    print(f"symbols: {res['symbols']}, predictions: {len(res['predictions'])}, insufficient: {res['insufficient']}")
    for p in res["predictions"]:
        print(
            f"  {p['symbol']}: {p['direction']} conf={p['confidence']} "
            f"target={p['target_price']} stop={p['stop_price']} — {p['rationale']}"
        )
    return 0


def cmd_evening(args: argparse.Namespace) -> int:
    conn = connect()
    try:
        res = run_evening(
            conn,
            run_date=_parse_date(args.date),
            force=args.force,
            llm_client=None,
        )
    finally:
        conn.close()
    if res.get("skipped"):
        print(f"evening {res['date']}: skipped (already completed; use --force to re-run)")
        return 0
    v = res["validation"]
    print(f"evening run #{res['run_id']} for {res['date']}")
    print(f"validated: {v['total']} predictions, hits={v['hits']}, hit_rate={v['hit_rate']}")
    for sym, sv in v["per_symbol"].items():
        print(f"  {sym}: {sv['total']} validated, {sv['hits']} hits ({sv['hit_rate']})")
    print(f"lessons proposed: {len(res['lessons_proposed'])}")
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    llm_client = None
    if args.mode == "llm":
        llm_client = _llm_client_or_error()
        if llm_client is None:
            return 1
    conn = connect()
    try:
        if args.days is not None:
            res = run_backtest(
                conn,
                days=args.days,
                mode=args.mode,
                validate_mode=args.validate_mode,
                llm_client=llm_client,
            )
        else:
            res = run_backtest(
                conn,
                start=args.start,
                end=args.end,
                years=args.years,
                mode=args.mode,
                validate_mode=args.validate_mode,
                llm_client=llm_client,
            )
    finally:
        conn.close()
    print(
        f"backtest: {res['days']} days [{res['start']} → {res['end']}], "
        f"{res['predictions']} predictions, hits={res['hits']}, "
        f"hit_rate={res['hit_rate']}, skipped={res['skipped']}"
    )
    print("per direction:")
    for d, v in res["per_direction"].items():
        print(f"  {d}: n={v['n']} hits={v['hits']} hit_rate={v['hit_rate']}")
    print("calibration:")
    for b, v in res["calibration"].items():
        print(f"  {b}: n={v['n']} hits={v['hits']} hit_rate={v['hit_rate']}")
    print("per symbol:")
    for sym, v in res["per_symbol"].items():
        print(
            f"  {sym}: {v['first_date'] or '-'} → {v['last_date'] or '-'} "
            f"bars={v['bars']} preds={v['predictions']} hits={v['hits']} "
            f"hit_rate={v['hit_rate']} skipped={v['skipped']}"
        )
    if res["patterns"]:
        print("patterns:")
        for pat, v in res["patterns"].items():
            print(f"  {pat}: n={v['n']} hits={v['hits']} hit_rate={v['hit_rate']}")
    k = res["knowledge"]
    print(
        f"knowledge promoted: positive={k['added_positive']} "
        f"negative={k['added_negative']} considered={k['considered']}"
    )
    return 0


def cmd_fundamentals(args: argparse.Namespace) -> int:
    from ..market.fetch import fetch_fundamentals, store_fundamentals
    from ..workflows.runs import active_symbols

    conn = connect()
    rows = []
    try:
        symbols = active_symbols(conn)
        for sym in symbols:
            row = fetch_fundamentals(sym)
            if row:
                store_fundamentals(conn, row)
                rows.append(row)
            else:
                print(f"  {sym}: fundamentals fetch failed (skipped)", file=sys.stderr)
    finally:
        conn.close()
    if not rows:
        print("fundamentals: (none fetched)")
        return 0
    print(f"fundamentals ({len(rows)} symbols, as_of {rows[0]['as_of']}):")
    print(f"  {'symbol':<16} {'pe':>8} {'pb':>8} {'roe':>8} {'mcap':>14} {'sector'}")
    for r in rows:
        mcap = f"{r['market_cap'] / 1e9:.1f}B" if r.get("market_cap") else "-"
        pe = f"{r['pe']:.2f}" if r.get("pe") is not None else "-"
        pb = f"{r['pb']:.2f}" if r.get("pb") is not None else "-"
        roe = f"{r['roe'] * 100:.1f}%" if r.get("roe") is not None else "-"
        print(
            f"  {r['symbol']:<16} {pe:>8} {pb:>8} {roe:>8} {mcap:>14} "
            f"{r.get('sector') or '-'}"
        )
    return 0


def cmd_data(args: argparse.Namespace) -> int:
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT symbol, MIN(date) AS first_date, MAX(date) AS last_date,
                      COUNT(*) AS bars
               FROM market_daily GROUP BY symbol ORDER BY symbol"""
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        print("data: (no market_daily rows)")
        return 0
    print("market_daily coverage:")
    print(f"  {'symbol':<16} {'first_date':<12} {'last_date':<12} {'bars':>6}")
    for r in rows:
        print(
            f"  {r['symbol']:<16} {r['first_date']:<12} {r['last_date']:<12} "
            f"{r['bars']:>6}"
        )
    return 0


def cmd_lessons(args: argparse.Namespace) -> int:
    conn = connect()
    try:
        if args.promote:
            res = promote_lessons(conn)
            print(f"promoted: accepted={len(res['accepted'])} rejected={len(res['rejected'])}")
        lessons = list_lessons(conn)
    finally:
        conn.close()
    if not lessons:
        print("lessons: (none)")
        return 0
    for l in lessons:
        print(
            f"#{l['id']} [{l['status']}] {l['symbol'] or '-'} obs={l['observations']} "
            f"{l['title']}"
        )
    return 0


def _validate_checks(conn: Any) -> list[str]:
    """Internal consistency checks. Returns a list of issues (empty = pass)."""
    issues: list[str] = []

    triggers = {
        r["name"]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()
    }
    for t in ("trg_market_daily_immutable", "trg_predictions_immutable"):
        if t not in triggers:
            issues.append(f"missing immutability trigger: {t}")

    preds = conn.execute("SELECT * FROM predictions").fetchall()
    for p in preds:
        row = conn.execute(
            """SELECT COUNT(*) AS c FROM market_daily
               WHERE symbol = ? AND date >= ? AND available_at <= ?""",
            (p["symbol"], p["run_date"], p["as_of"]),
        ).fetchone()
        if row["c"]:
            issues.append(
                f"future leakage: prediction #{p['id']} ({p['symbol']} {p['run_date']}) "
                f"has {row['c']} bars with date >= run_date available at as_of"
            )

    n_pred = len(preds)
    n_val = conn.execute("SELECT COUNT(*) AS c FROM validation").fetchone()["c"]
    if n_val > n_pred:
        issues.append(f"validation rows ({n_val}) exceed predictions ({n_pred})")

    return issues


def cmd_validate() -> int:
    conn = connect()
    try:
        issues = _validate_checks(conn)
    finally:
        conn.close()
    if issues:
        print("validation FAILED:")
        for i in issues:
            print(f"  - {i}")
        return 1
    print("validation OK: no consistency issues found")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Start the local HTTP API (FastAPI) on AIOPS_API_HOST:AIOPS_API_PORT."""
    try:
        import uvicorn  # noqa: PLC0415 — optional dependency
    except ImportError:
        print(
            "error: fastapi/uvicorn not installed — run: "
            "python3 -m pip install -r requirements-server.txt",
            file=sys.stderr,
        )
        return 1
    from server.main import app  # noqa: PLC0415

    host = config.AIOPS_API_HOST
    port = config.AIOPS_API_PORT
    print(f"AIOPS API listening on http://{host}:{port}  (Ctrl+C to stop)")
    print(f"ADK Web UI: {config.ADK_UI_URL}")
    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0


# ── Dispatch ────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            return cmd_init()
        if args.command == "status":
            return cmd_status()
        if args.command == "morning":
            return cmd_morning(args)
        if args.command == "evening":
            return cmd_evening(args)
        if args.command == "backtest":
            return cmd_backtest(args)
        if args.command == "fundamentals":
            return cmd_fundamentals(args)
        if args.command == "data":
            return cmd_data(args)
        if args.command == "lessons":
            return cmd_lessons(args)
        if args.command == "validate":
            return cmd_validate()
        if args.command == "serve":
            return cmd_serve(args)
        parser.error(f"unknown command: {args.command}")
        return 1
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())