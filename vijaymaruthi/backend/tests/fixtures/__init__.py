"""Deterministic offline fixtures for the rule-engine golden-master harness.

Nothing here touches the network: OHLCV is produced by a seeded walking
generator and fundamentals are hand-built section dicts. The same inputs
produce byte-identical DataFrames/dicts on every run so the golden snapshot
can be compared with exact equality.
"""
