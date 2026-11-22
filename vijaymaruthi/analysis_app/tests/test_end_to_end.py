"""End-to-end: freeze -> analyze -> verify, with byte-level determinism."""
import json
from pathlib import Path

import pytest

from analysis_app.analyzer import AnalyzeConfig, analyze_universe
from analysis_app.datasource import (PinnedDataSource, build_snapshot,
                                     csv_dir_ohlcv, reports_fundamentals)
from analysis_app.determinism import Clock
from analysis_app.report import verify_run, write_run

_REPO = Path(__file__).resolve().parents[2]
_FIXTURES = _REPO / "backend" / "tests" / "fixtures" / "ohlcv"
_REPORTS = _REPO.parent / "reports"

UNIVERSE = ["AAPL", "MSFT", "RELIANCE.NS", "AXISBANK.NS", "NVDA", "TSLA"]


@pytest.fixture(scope="module")
def snapshot(tmp_path_factory):
    out = tmp_path_factory.mktemp("snap")
    build_snapshot(
        UNIVERSE,
        csv_dir_ohlcv(_FIXTURES),
        reports_fundamentals(_REPORTS) if _REPORTS.exists() else (lambda t: None),
        out, snapshot_date="2026-09-30", created_from="fixtures")
    return out


def test_snapshot_has_expected_shape(snapshot):
    ds = PinnedDataSource(snapshot)
    assert ds.universe() == UNIVERSE
    assert ds.ohlcv("AAPL") is not None
    assert len(ds.ohlcv("AAPL")) > 100
    assert ds.snapshot_sha()


def test_analysis_is_deterministic(snapshot):
    ds = PinnedDataSource(snapshot)
    clock = Clock.at("2026-09-30")
    cfg = AnalyzeConfig(period="3y", include_timeline=True)
    a = analyze_universe(ds, clock, cfg)
    b = analyze_universe(ds, clock, cfg)
    assert a["run_id"] == b["run_id"]
    assert a["manifest"]["outputs_sha"] == b["manifest"]["outputs_sha"]


def test_limit_changes_run_identity(snapshot):
    """A limited run must not collide with the full run's id."""
    ds = PinnedDataSource(snapshot)
    clock = Clock.at("2026-09-30")
    cfg = AnalyzeConfig(period="3y")
    full = analyze_universe(ds, clock, cfg)
    limited = analyze_universe(ds, clock, cfg, limit=3)
    assert full["run_id"] != limited["run_id"]
    assert full["manifest"]["tickers"] == len(UNIVERSE)
    assert limited["manifest"]["tickers"] == 3
    # full run's effective universe == snapshot universe
    assert (full["manifest"]["effective_universe_sha"]
            == full["manifest"]["universe_sha"])


def test_artifacts_are_byte_identical(snapshot, tmp_path):
    ds = PinnedDataSource(snapshot)
    clock = Clock.at("2026-09-30")
    cfg = AnalyzeConfig(period="3y", include_timeline=True)
    run = analyze_universe(ds, clock, cfg)

    d1, d2 = tmp_path / "r1", tmp_path / "r2"
    m1 = write_run(d1, run)
    m2 = write_run(d2, run)
    assert m1["run_sha256"] == m2["run_sha256"]
    assert (d1 / "run.sha256").read_text() == (d2 / "run.sha256").read_text()
    assert verify_run(d1)["ok"]
    assert verify_run(d2)["ok"]


def test_verify_detects_tampering(snapshot, tmp_path):
    ds = PinnedDataSource(snapshot)
    run = analyze_universe(ds, Clock.at("2026-09-30"),
                           AnalyzeConfig(period="3y"))
    out = tmp_path / "run"
    write_run(out, run)
    assert verify_run(out)["ok"]
    # tamper with an artifact
    (out / "ranking.csv").write_text("ticker,signal\nFAKE,BUY\n")
    assert not verify_run(out)["ok"]


def test_manifest_roundtrip(snapshot, tmp_path):
    ds = PinnedDataSource(snapshot)
    run = analyze_universe(ds, Clock.at("2026-09-30"),
                           AnalyzeConfig(period="3y"))
    out = tmp_path / "run"
    write_run(out, run)
    m = json.loads((out / "manifest.json").read_text())
    assert m["run_sha256"]
    assert m["tickers"] == len(UNIVERSE)
    assert m["errors"] == 0
