"""Clock tests — temporal boundaries and SimulationClock."""

from __future__ import annotations

from datetime import date, datetime

from aiops.clock import IST, SimulationClock, morning_data_as_of, predict_at, validate_at


def test_boundaries():
    """D 09:00 prediction, D-1 16:00 data boundary, D 16:00 validation."""
    d = date(2026, 9, 15)
    assert predict_at(d) == datetime(2026, 9, 15, 9, 0, tzinfo=IST)
    assert morning_data_as_of(d) == datetime(2026, 9, 14, 16, 0, tzinfo=IST)
    assert validate_at(d) == datetime(2026, 9, 15, 16, 0, tzinfo=IST)


def test_boundary_iso_strings():
    """ISO strings compare correctly (same IST offset everywhere)."""
    d = date(2026, 9, 15)
    assert morning_data_as_of(d).isoformat() < predict_at(d).isoformat()
    assert predict_at(d).isoformat() < validate_at(d).isoformat()


def test_simulation_clock_advance():
    """SimulationClock set/advance behaves deterministically."""
    clock = SimulationClock()
    clock.set(datetime(2026, 9, 15, 9, 0, tzinfo=IST))
    assert clock.now() == datetime(2026, 9, 15, 9, 0, tzinfo=IST)
    clock.advance(hours=7)
    assert clock.now() == datetime(2026, 9, 15, 16, 0, tzinfo=IST)
    clock.advance(days=1)
    assert clock.now() == datetime(2026, 9, 16, 16, 0, tzinfo=IST)


def test_simulation_clock_predict_helpers():
    """SimulationClock exposes the same temporal helpers as the module."""
    clock = SimulationClock()
    d = date(2026, 9, 15)
    assert clock.predict_at(d) == predict_at(d)
    assert clock.morning_data_as_of(d) == morning_data_as_of(d)
    assert clock.validate_at(d) == validate_at(d)