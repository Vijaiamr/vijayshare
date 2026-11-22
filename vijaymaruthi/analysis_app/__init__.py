"""Deterministic State-Machine Analyzer.

A robust, byte-reproducible application that analyzes a *pinned* stock universe
by combining the code-defined rule engine (``engine/rules``) with a composite
state machine (regime x setup x position).

Determinism contract
--------------------
* All inputs come from a pinned snapshot (``analysis_app/snapshot/``); the
  analysis path never touches the network.
* The wall clock is injected (``determinism.Clock``); no ``datetime.now()``
  leaks into results.
* Every output is serialised canonically (sorted keys, normalised floats) and
  hashed. ``run_id`` is derived purely from input hashes + config + as-of date.
"""
from __future__ import annotations

__all__ = ["__version__"]

__version__ = "1.0.0"
