"""Deterministic artifact writer + verifier.

A run directory contains::

    manifest.json          # run identity + input/output hashes
    stocks/<ticker>.json   # canonical per-stock analysis
    ranking.csv            # aggregate ranking (deterministic sort)
    states.csv             # composite state per stock
    report.html            # static, deterministic HTML report
    run.sha256             # hash over every other artifact

``verify_run`` recomputes ``run.sha256`` and compares, so any drift is caught.
"""
from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any, Dict, List

from .determinism import canonical_json, sha256_file, sha256_text

# Files that participate in the run hash (run.sha256 itself excluded).
_HASHED_SUFFIXES = (".json", ".csv", ".html")


def _ranking_rows(results: List[Any]) -> List[Dict[str, Any]]:
    rows = []
    for r in results:
        qm = r.quantamental or {}
        rows.append({
            "ticker": r.ticker,
            "signal": r.signal,
            "confidence": r.confidence,
            "blended_score": qm.get("blended_score", ""),
            "blended_rating": qm.get("blended_rating", ""),
            "regime": r.state.get("regime", ""),
            "setup": r.state.get("setup", ""),
            "position": r.state.get("position", ""),
            "pattern_type": r.state.get("pattern_type", ""),
            "price": r.price if r.price is not None else "",
            "error": r.error,
        })
    # Deterministic sort: blended score desc (missing last), then ticker.
    def _key(row):
        bs = row["blended_score"]
        return (-(bs if isinstance(bs, (int, float)) else -1), row["ticker"])
    rows.sort(key=_key)
    return rows


def _csv(rows: List[Dict[str, Any]], columns: List[str]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, lineterminator="\n")
    w.writeheader()
    for row in rows:
        w.writerow({c: row.get(c, "") for c in columns})
    return buf.getvalue()


def _html(manifest: Dict[str, Any], rows: List[Dict[str, Any]]) -> str:
    head = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Deterministic Analysis</title>"
        "<style>body{font-family:system-ui,sans-serif;margin:2rem;}"
        "table{border-collapse:collapse;width:100%;}"
        "th,td{border:1px solid #ddd;padding:4px 8px;font-size:13px;text-align:left;}"
        "th{background:#f4f4f4;}tr:nth-child(even){background:#fafafa;}"
        ".up{color:#0a7d2c;}.down{color:#b00020;}</style></head><body>"
    )
    meta = (
        f"<h1>Deterministic Analysis</h1>"
        f"<p>run_id <code>{manifest.get('run_id')}</code> &middot; "
        f"as_of <code>{manifest.get('as_of')}</code> &middot; "
        f"snapshot <code>{str(manifest.get('snapshot_sha'))[:12]}</code> &middot; "
        f"{manifest.get('analyzed')}/{manifest.get('tickers')} analyzed, "
        f"{manifest.get('errors')} errors</p>"
    )
    cols = ["ticker", "signal", "confidence", "blended_score", "regime",
            "setup", "position", "pattern_type", "price"]
    th = "".join(f"<th>{c}</th>" for c in cols)
    body = []
    for row in rows:
        tds = []
        for c in cols:
            v = row.get(c, "")
            cls = ""
            if c == "regime":
                cls = "up" if v == "trend_up" else ("down" if v == "trend_down" else "")
            tds.append(f"<td class='{cls}'>{v}</td>")
        body.append("<tr>" + "".join(tds) + "</tr>")
    return head + meta + f"<table><thead><tr>{th}</tr></thead><tbody>" + \
        "".join(body) + "</tbody></table></body></html>"


def write_run(out_dir: str | Path, run: Dict[str, Any]) -> Dict[str, Any]:
    """Write all artifacts for a run. Returns the manifest (with run.sha256)."""
    out = Path(out_dir)
    (out / "stocks").mkdir(parents=True, exist_ok=True)
    manifest = dict(run["manifest"])
    results = run["results"]

    (out / "manifest.json").write_text(canonical_json(manifest))
    for r in results:
        (out / "stocks" / f"{r.ticker}.json").write_text(canonical_json(r.as_dict()))

    rows = _ranking_rows(results)
    (out / "ranking.csv").write_text(_csv(rows, [
        "ticker", "signal", "confidence", "blended_score", "blended_rating",
        "regime", "setup", "position", "pattern_type", "price", "error"]))
    (out / "states.csv").write_text(_csv(
        [{"ticker": r.ticker, "regime": r.state.get("regime", ""),
          "setup": r.state.get("setup", ""), "position": r.state.get("position", ""),
          "reason": r.state.get("reason", "")} for r in results],
        ["ticker", "regime", "setup", "position", "reason"]))
    (out / "report.html").write_text(_html(manifest, rows))

    run_sha = _hash_dir(out)
    (out / "run.sha256").write_text(run_sha + "\n")
    manifest["run_sha256"] = run_sha
    # Rewrite manifest.json with the hash. It is excluded from the hash set, so
    # this does not change run_sha.
    (out / "manifest.json").write_text(canonical_json(manifest))
    return manifest


def _hash_dir(out: Path) -> str:
    parts = []
    for p in sorted(out.rglob("*")):
        if not p.is_file():
            continue
        if p.name in ("run.sha256", "manifest.json"):
            continue
        if p.suffix in _HASHED_SUFFIXES:
            parts.append(f"{p.relative_to(out)}:{sha256_file(p)}")
    return sha256_text("\n".join(parts))


def verify_run(run_dir: str | Path) -> Dict[str, Any]:
    """Recompute the run hash and compare to the stored run.sha256."""
    out = Path(run_dir)
    stored_path = out / "run.sha256"
    if not stored_path.exists():
        return {"ok": False, "reason": "run.sha256 missing"}
    stored = stored_path.read_text().strip()
    actual = _hash_dir(out)
    return {"ok": stored == actual, "stored": stored, "actual": actual}
