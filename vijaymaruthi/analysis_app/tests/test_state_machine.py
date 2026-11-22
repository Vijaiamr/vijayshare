"""State machine: regime, setup, position, timeline."""
import numpy as np
import pandas as pd

from analysis_app import state_machine as sm


def _df(closes, spread=1.0):
    closes = np.asarray(closes, dtype=float)
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="D")
    return pd.DataFrame({
        "Open": closes,
        "High": closes + spread,
        "Low": closes - spread,
        "Close": closes,
        "Volume": np.full(len(closes), 1_000_000.0),
    }, index=idx)


def test_regime_uptrend():
    df = _df(np.linspace(100, 200, 120), spread=0.5)
    assert sm.RegimeEngine(df).at(-1) == sm.REGIME_TREND_UP


def test_regime_downtrend():
    df = _df(np.linspace(200, 100, 120), spread=0.5)
    assert sm.RegimeEngine(df).at(-1) == sm.REGIME_TREND_DOWN


def test_regime_range():
    # flat series: no slope, no directional movement -> range
    df = _df(np.full(120, 100.0), spread=0.3)
    assert sm.RegimeEngine(df).at(-1) == sm.REGIME_RANGE


def test_regime_high_volatility():
    # large daily ranges -> ATR% > 3
    df = _df(np.linspace(100, 110, 120), spread=5.0)
    assert sm.RegimeEngine(df).at(-1) == sm.REGIME_HIGH_VOL


def test_setup_mapping():
    for status, expected in [("forming", sm.SETUP_WATCH),
                             ("active", sm.SETUP_ARMED),
                             ("completed", sm.SETUP_TRIGGERED),
                             ("failed", sm.SETUP_INVALIDATED)]:
        votes = {"available": True, "geometry": [
            {"type": "cup_and_handle", "direction": "bullish",
             "confidence": 90, "status": status, "end_idx": 10}]}
        state, _, _ = sm.classify_setup(votes)
        assert state == expected, status


def test_setup_none_when_unavailable():
    assert sm.classify_setup({"available": False})[0] == sm.SETUP_NONE
    assert sm.classify_setup({"available": True, "geometry": []})[0] == sm.SETUP_NONE


def test_setup_veto_invalidates():
    votes = {"available": True, "veto": True, "geometry": [
        {"type": "x", "direction": "bullish", "confidence": 90,
         "status": "active", "end_idx": 5}]}
    assert sm.classify_setup(votes)[0] == sm.SETUP_INVALIDATED


def test_top_pattern_is_deterministic():
    votes = {"available": True, "geometry": [
        {"type": "b", "confidence": 80, "end_idx": 5},
        {"type": "a", "confidence": 80, "end_idx": 5},
        {"type": "c", "confidence": 95, "end_idx": 5}]}
    assert sm.top_pattern(votes)["type"] == "c"


def test_position_timeline_target_hit():
    # entry 100, stop 95, target 110; price rises through target
    closes = [100, 101, 105, 111, 112]
    df = _df(closes, spread=0.5)
    pat = {"entry": 100.0, "stop_loss": 95.0, "target": 110.0,
           "direction": "bullish", "end_idx": 0}
    tl = sm.position_timeline(df, pat)
    states = [t.position for t in tl]
    assert sm.POS_ENTERED in states
    assert states[-1] == sm.POS_TARGET_HIT


def test_position_timeline_stop_hit():
    closes = [100, 99, 94, 93]
    df = _df(closes, spread=0.5)
    pat = {"entry": 100.0, "stop_loss": 95.0, "target": 110.0,
           "direction": "bullish", "end_idx": 0}
    tl = sm.position_timeline(df, pat)
    assert tl[-1].position == sm.POS_STOPPED


def test_position_timeline_stop_wins_within_bar():
    # a single bar spans both stop and target -> stop must win (conservative)
    idx = pd.date_range("2024-01-01", periods=2, freq="D")
    df = pd.DataFrame({
        "Open": [100.0, 100.0], "High": [100.0, 120.0],
        "Low": [100.0, 90.0], "Close": [100.0, 100.0],
        "Volume": [1e6, 1e6]}, index=idx)
    pat = {"entry": 100.0, "stop_loss": 95.0, "target": 110.0,
           "direction": "bullish", "end_idx": 0}
    tl = sm.position_timeline(df, pat)
    assert tl[-1].position == sm.POS_STOPPED


def test_analyze_state_composite():
    df = _df(np.linspace(100, 200, 120), spread=0.5)
    votes = {"available": True, "geometry": [
        {"type": "cup_and_handle", "direction": "bullish", "confidence": 90,
         "status": "active", "end_idx": 100, "entry": 190.0,
         "stop_loss": 180.0, "target": 220.0, "risk_reward": 3.0}]}
    st = sm.analyze_state(df, votes, gates=["low liquidity"])
    assert st.regime == sm.REGIME_TREND_UP
    assert st.setup == sm.SETUP_ARMED
    assert st.pattern_type == "cup_and_handle"
    assert st.gates == ("low liquidity",)
    assert st.as_dict()["regime"] == sm.REGIME_TREND_UP
