"""Command-line interface for the deterministic analyzer.

    python -m analysis_app freeze   [--universe-file F | --from-reports DIR | --nse]
    python -m analysis_app analyze  [--snapshot DIR] [--as-of DATE] [--out DIR]
    python -m analysis_app verify   --run DIR
    python -m analysis_app report   --run DIR

``freeze`` is the only command that may touch the network.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

from .analyzer import AnalyzeConfig, analyze_universe
from .datasource import (PinnedDataSource, build_snapshot, csv_dir_ohlcv,
                         reports_fundamentals, yfinance_ohlcv)
from .determinism import Clock
from .report import verify_run, write_run

_APP_DIR = Path(__file__).resolve().parent
DEFAULT_SNAPSHOT = _APP_DIR / "snapshot"
DEFAULT_RUNS = _APP_DIR / "runs"


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ──────────────────────────────────────────────────────────────
# freeze
# ──────────────────────────────────────────────────────────────
def _load_universe(args) -> List[str]:
    if args.universe_file:
        text = Path(args.universe_file).read_text()
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                data = data.get("tickers", [])
            return [str(t).strip() for t in data if str(t).strip()]
        except json.JSONDecodeError:
            return [ln.strip() for ln in text.splitlines() if ln.strip()]
    if args.from_reports:
        base = Path(args.from_reports)
        out = []
        for p in sorted(base.glob("*_data.json")):
            stem = p.name[: -len("_data.json")]
            if stem.endswith("_NS"):
                out.append(stem[:-3] + ".NS")
            elif stem.endswith("_BO"):
                out.append(stem[:-3] + ".BO")
            else:
                out.append(stem)
        return out
    if args.nse:
        import requests
        url = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
        r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        lines = r.text.splitlines()
        header = [h.strip() for h in lines[0].split(",")]
        sym_idx = header.index("SYMBOL") if "SYMBOL" in header else 0
        return [ln.split(",")[sym_idx].strip() + ".NS"
                for ln in lines[1:] if ln.strip()]
    raise SystemExit("freeze: provide --universe-file, --from-reports, or --nse")


def cmd_freeze(args) -> int:
    universe = _load_universe(args)
    if args.limit:
        universe = universe[: args.limit]
    if not universe:
        raise SystemExit("freeze: empty universe")

    if args.ohlcv_source == "csv-dir":
        if not args.csv_dir:
            raise SystemExit("freeze: --csv-dir required for csv-dir source")
        ohlcv = csv_dir_ohlcv(args.csv_dir)
        created_from = f"csv-dir:{args.csv_dir}"
    else:
        ohlcv = yfinance_ohlcv(period=args.period, as_of=args.snapshot_date)
        created_from = "yfinance"

    fund = reports_fundamentals(args.reports_dir) if args.reports_dir else (lambda t: None)

    _log(f"freeze: {len(universe)} tickers -> {args.out}")
    manifest = build_snapshot(
        universe, ohlcv, fund, args.out,
        snapshot_date=args.snapshot_date, created_from=created_from, log=_log)
    _log(f"freeze: done — {manifest['ohlcv_rows']} rows, "
         f"{manifest['fundamentals_count']} fundamentals, "
         f"snapshot_sha={manifest['snapshot_sha'][:12]}")
    return 0


# ──────────────────────────────────────────────────────────────
# analyze
# ──────────────────────────────────────────────────────────────
def cmd_analyze(args) -> int:
    ds = PinnedDataSource(args.snapshot)
    as_of = args.as_of or ds.meta().get("snapshot_date") or "1970-01-01"
    clock = Clock.at(as_of)
    config = AnalyzeConfig(period=args.period, include_timeline=args.timeline)

    _log(f"analyze: snapshot={args.snapshot} as_of={as_of}")
    run = analyze_universe(ds, clock, config, limit=args.limit, log=_log)

    out = Path(args.out) if args.out else (DEFAULT_RUNS / run["run_id"])
    manifest = write_run(out, run)
    _log(f"analyze: run_id={run['run_id']} -> {out}")
    _log(f"analyze: {manifest['analyzed']}/{manifest['tickers']} ok, "
         f"{manifest['errors']} errors, run_sha256={manifest['run_sha256'][:12]}")
    print(json.dumps({"run_id": run["run_id"], "out": str(out),
                      "run_sha256": manifest["run_sha256"]}))
    return 0


# ──────────────────────────────────────────────────────────────
# verify / report
# ──────────────────────────────────────────────────────────────
def cmd_verify(args) -> int:
    res = verify_run(args.run)
    if res["ok"]:
        print(f"OK  {args.run}  ({res['actual'][:12]})")
        return 0
    print(f"FAIL {args.run}: stored={res.get('stored','')[:12]} "
          f"actual={res.get('actual','')[:12]} ({res.get('reason','')})")
    return 1


def cmd_report(args) -> int:
    run_dir = Path(args.run)
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"report: {manifest_path} not found")
    manifest = json.loads(manifest_path.read_text())
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


# ──────────────────────────────────────────────────────────────
# parser
# ──────────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analysis_app", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("freeze", help="build/refresh the pinned snapshot")
    f.add_argument("--universe-file")
    f.add_argument("--from-reports")
    f.add_argument("--nse", action="store_true")
    f.add_argument("--ohlcv-source", choices=["yfinance", "csv-dir"],
                   default="yfinance")
    f.add_argument("--csv-dir")
    f.add_argument("--reports-dir")
    f.add_argument("--period", default="3y")
    f.add_argument("--snapshot-date", required=True)
    f.add_argument("--limit", type=int)
    f.add_argument("--out", default=str(DEFAULT_SNAPSHOT))
    f.set_defaults(func=cmd_freeze)

    a = sub.add_parser("analyze", help="run deterministic analysis")
    a.add_argument("--snapshot", default=str(DEFAULT_SNAPSHOT))
    a.add_argument("--as-of")
    a.add_argument("--out")
    a.add_argument("--period", default="3y")
    a.add_argument("--limit", type=int)
    a.add_argument("--timeline", action="store_true")
    a.set_defaults(func=cmd_analyze)

    v = sub.add_parser("verify", help="verify a run's reproducibility hash")
    v.add_argument("--run", required=True)
    v.set_defaults(func=cmd_verify)

    r = sub.add_parser("report", help="print a run manifest")
    r.add_argument("--run", required=True)
    r.set_defaults(func=cmd_report)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
