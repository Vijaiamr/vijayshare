"""Determinism kernel: canonical serialisation, hashing, and an injected clock.

Everything the analyzer emits flows through :func:`canonical_json` so that two
runs over identical inputs produce byte-identical artifacts. The only clock the
analysis path may read is :class:`Clock`, whose value is fixed per run.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BUILDER_VERSION = "1.0.0"


# ──────────────────────────────────────────────────────────────
# Canonical serialisation
# ──────────────────────────────────────────────────────────────
def _normalize(obj: Any) -> Any:
    """Recursively convert to JSON-safe, platform-stable primitives.

    * numpy scalars/arrays -> Python scalars/lists (numpy 2.x reprs differ)
    * tuples/sets -> lists (sets sorted for stability)
    * dataclasses -> dicts
    * datetime/date -> ISO strings
    * Mapping keys -> str
    """
    # Fast path for the common primitives.
    if obj is None or isinstance(obj, (bool, int, str)):
        return obj
    if isinstance(obj, float):
        # NaN/Inf are not valid JSON; normalise to None for stability.
        if obj != obj or obj in (float("inf"), float("-inf")):
            return None
        return obj

    # numpy (optional dependency).
    try:
        import numpy as np  # type: ignore

        if isinstance(obj, np.generic):
            return _normalize(obj.item())
        if isinstance(obj, np.ndarray):
            return [_normalize(x) for x in obj.tolist()]
    except Exception:
        pass

    # pandas Timestamp / Timedelta (optional).
    try:
        import pandas as pd  # type: ignore

        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
        if isinstance(obj, pd.Timedelta):
            return str(obj)
    except Exception:
        pass

    if isinstance(obj, (datetime,)):
        if obj.tzinfo is None:
            obj = obj.replace(tzinfo=timezone.utc)
        return obj.astimezone(timezone.utc).isoformat()
    if hasattr(obj, "isoformat") and obj.__class__.__name__ == "date":
        return obj.isoformat()

    if isinstance(obj, dict):
        return {str(k): _normalize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize(x) for x in obj]
    if isinstance(obj, (set, frozenset)):
        return [_normalize(x) for x in sorted(obj, key=repr)]

    # dataclasses
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _normalize(getattr(obj, k)) for k in obj.__dataclass_fields__}

    # Fallback: stringify (deterministic for our value types).
    return str(obj)


def canonical_json(obj: Any) -> str:
    """Deterministic JSON: sorted keys, compact separators, normalised values."""
    return json.dumps(_normalize(obj), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def canonical_bytes(obj: Any) -> bytes:
    return canonical_json(obj).encode("utf-8")


# ──────────────────────────────────────────────────────────────
# Hashing
# ──────────────────────────────────────────────────────────────
def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_obj(obj: Any) -> str:
    return sha256_bytes(canonical_bytes(obj))


# ──────────────────────────────────────────────────────────────
# Clock
# ──────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Clock:
    """A frozen clock. The analysis path reads time only from here."""

    as_of: datetime

    @classmethod
    def at(cls, value: str | datetime) -> "Clock":
        if isinstance(value, datetime):
            dt = value
        else:
            dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return cls(dt)

    def now(self) -> datetime:
        return self.as_of

    @property
    def date_str(self) -> str:
        return self.as_of.strftime("%Y-%m-%d")


# ──────────────────────────────────────────────────────────────
# Run identity
# ──────────────────────────────────────────────────────────────
def derive_run_id(universe_sha: str, snapshot_sha: str, config_sha: str,
                  as_of: str) -> str:
    """A run id that depends only on inputs + config + as-of date."""
    payload = "|".join([universe_sha, snapshot_sha, config_sha, as_of])
    return sha256_text(payload)[:16]
