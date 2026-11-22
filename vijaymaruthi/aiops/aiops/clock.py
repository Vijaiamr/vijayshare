"""Temporal discipline — the single source of truth for timestamps.

Standard (IST):

    D-1 16:00  available historical state (bars through D-1 close)
        ↓
    D 09:00    prediction (as_of = D 09:00 IST)
        ↓
    D 16:00    validation (D close bar available)

Every feature row carries `available_at`; queries filter
`available_at <= as_of`. The backtester replays this exact boundary per day.
"""

from __future__ import annotations

import zoneinfo
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from . import config

IST = zoneinfo.ZoneInfo("Asia/Kolkata")


def _parse_time(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


PREDICT_AT: time = _parse_time(config.PREDICT_AT)          # D 09:00
MORNING_DATA_AS_OF: time = _parse_time(config.MORNING_DATA_AS_OF)  # D-1 16:00
VALIDATE_AT: time = _parse_time(config.VALIDATE_AT)        # D 16:00


def ist_now() -> datetime:
    """Real current time in IST."""
    return datetime.now(IST)


def predict_at(run_date: date) -> datetime:
    """Prediction timestamp on trading day D (D 09:00 IST)."""
    return datetime.combine(run_date, PREDICT_AT, IST)


def morning_data_as_of(run_date: date) -> datetime:
    """Latest feature availability for a D prediction (D-1 16:00 IST)."""
    return datetime.combine(run_date - timedelta(days=1), MORNING_DATA_AS_OF, IST)


def validate_at(run_date: date) -> datetime:
    """Validation timestamp on trading day D (D 16:00 IST)."""
    return datetime.combine(run_date, VALIDATE_AT, IST)


@dataclass
class SimulationClock:
    """Simulated clock for backtests. For live runs use `ist_now()`.

    The clock enforces the information boundary: `now()` is the only time
    the caller may treat as "current"; feature queries must filter
    `available_at <= now()`.
    """

    current: datetime = field(default_factory=ist_now)

    def now(self) -> datetime:
        return self.current

    def set(self, ts: datetime) -> None:
        self.current = ts.astimezone(IST)

    def advance(self, **kwargs) -> datetime:
        self.current = self.current + timedelta(**kwargs)
        return self.current

    def predict_at(self, run_date: date) -> datetime:
        return predict_at(run_date)

    def morning_data_as_of(self, run_date: date) -> datetime:
        return morning_data_as_of(run_date)

    def validate_at(self, run_date: date) -> datetime:
        return validate_at(run_date)