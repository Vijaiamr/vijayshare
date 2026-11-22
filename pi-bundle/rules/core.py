"""Rule engine for market analysis — core primitives.

The market-analysis decision logic (signal classification, technical &
fundamental convolution, quality gates, quantamental fusion, pattern gating)
was historically spread across large instance methods in
``technical_analysis_report.py``. This package centralises that logic as
code-defined, individually-addressable rules so it can be extended, traced and
tested domain by domain.

Design
------
* ``MarketFeatures`` — an immutable, domain-neutral snapshot of everything the
  rules read (the analysis dict, price, pattern votes, yf info).
* ``Rule`` — a single named predicate/scorer: ``score_fn(features) -> float``
  (0.0 means "did not fire", non-zero is its signed contribution).
* ``RuleSet`` — an ordered collection of rules for one domain/component, with
  optional per-group clamping, producing a :class:`RuleOutcome` (the signed
  total + the list of fired rules for traceability).
* ``DecisionTrace`` — a serialisable record of every rule set's outcome.

Everything here is pure: no I/O, no globals, no market access. The caller
(the pipeline) supplies features. This keeps the rules unit-testable and lets
the golden-master harness pin exact behaviour.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence


# ──────────────────────────────────────────────────────────────
# Features
# ──────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class MarketFeatures:
    """Immutable snapshot consumed by every rule.

    Attributes
    ----------
    analysis:
        The pipeline ``analysis`` dict (keys: ma, rsi, macd, bb, adx, atr,
        obv_raw, volume, raw, structure, trendlines, fib_retracement,
        fib_extension, pivot_points, sr_levels, candlestick, divergence,
        wyckoff, fundamentals, ...).
    price:
        Last close price.
    pattern_votes:
        Output of :func:`rules.pattern_gates.pattern_votes` (bull/bear weight,
        pattern names, majority, veto, available, geometry).
    ticker:
        Symbol (used for India vs US threshold logic).
    yf_info:
        Raw yfinance ``info`` dict (marketCap, etc.).
    """

    analysis: Mapping[str, Any]
    price: float
    pattern_votes: Mapping[str, Any] = field(default_factory=dict)
    ticker: str = ""
    yf_info: Mapping[str, Any] = field(default_factory=dict)

    # ── convenience accessors (mirror the legacy `.get` chains) ──
    def sub(self, key: str) -> Mapping[str, Any]:
        v = self.analysis.get(key)
        return v if isinstance(v, Mapping) else {}

    @property
    def structure(self) -> str:
        return str(self.sub("structure").get("structure", ""))

    @property
    def ma(self) -> Mapping[str, Any]:
        return self.sub("ma")

    @property
    def rsi_value(self) -> float:
        return _as_float(self.sub("rsi").get("value", 50), 50.0)

    @property
    def macd(self) -> Mapping[str, Any]:
        return self.sub("macd")

    @property
    def adx(self) -> Mapping[str, Any]:
        return self.sub("adx")

    @property
    def atr_pct(self) -> Optional[float]:
        v = self.sub("atr").get("percent_of_price")
        return _as_float(v, None) if v is not None else None

    @property
    def wyckoff_phase(self) -> str:
        return str(self.sub("wyckoff").get("wyckoff_phase", {}).get("phase", ""))

    def is_india(self) -> bool:
        return self.ticker.endswith(".NS") or self.ticker.endswith(".BO")


# ──────────────────────────────────────────────────────────────
# Rule + RuleSet
# ──────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Rule:
    """A single, named, code-defined scoring rule.

    ``score_fn`` returns its signed contribution to the parent group's sum;
    ``0.0`` means the rule did not fire. Keeping the score in the callable
    (rather than a fixed weight) lets table-driven rules (e.g. value multiples)
    live next to declarative boolean rules.
    """

    id: str
    domain: str
    group: str
    description: str
    score_fn: Callable[[MarketFeatures], float]

    def score(self, f: MarketFeatures) -> float:
        return float(self.score_fn(f))

    def fired(self, f: MarketFeatures) -> bool:
        return self.score(f) != 0.0


@dataclass
class FiredRule:
    id: str
    group: str
    description: str
    score: float


@dataclass
class RuleOutcome:
    """Result of evaluating one :class:`RuleSet`."""

    domain: str
    name: str
    total: float
    groups: Dict[str, float]
    fired: List[FiredRule]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "domain": self.domain,
            "name": self.name,
            "total": round(self.total, 4),
            "groups": {k: round(v, 4) for k, v in self.groups.items()},
            "fired": [
                {"id": r.id, "group": r.group, "score": round(r.score, 4)}
                for r in self.fired
            ],
        }


class RuleSet:
    """An ordered collection of rules evaluated against one domain.

    Parameters
    ----------
    domain, name:
        Identity used in the decision trace.
    rules:
        The rule instances.
    group_clamp:
        ``{group: max_abs}`` — each group's per-group sum is clamped to
        ``[-max_abs, +max_abs]`` before the group totals are added. ``None``
        groups are not clamped.
    group_max:
        ``{group: max_abs}`` — groups that always contribute their ceiling to a
        fixed normaliser (used by ``classify`` whose denominator is 100). Every
        group listed here is counted in :attr:`RuleOutcome.max_total` whether or
        not it fired.
    """

    def __init__(
        self,
        domain: str,
        name: str,
        rules: Sequence[Rule],
        group_clamp: Optional[Mapping[str, float]] = None,
        group_max: Optional[Mapping[str, float]] = None,
    ) -> None:
        self.domain = domain
        self.name = name
        self.rules = list(rules)
        self.group_clamp = dict(group_clamp or {})
        self.group_max = dict(group_max or {})

    def evaluate(self, f: MarketFeatures) -> RuleOutcome:
        groups: Dict[str, float] = {}
        fired: List[FiredRule] = []
        # Seed known groups at 0 so order is deterministic.
        for g in self.group_max:
            groups.setdefault(g, 0.0)
        for rule in self.rules:
            s = rule.score(f)
            if s != 0.0:
                groups[rule.group] = groups.get(rule.group, 0.0) + s
                fired.append(FiredRule(rule.id, rule.group, rule.description, s))
        # Clamp per group.
        for g, cap in self.group_clamp.items():
            if g in groups:
                groups[g] = max(-cap, min(cap, groups[g]))
        total = sum(groups.values())
        return RuleOutcome(self.domain, self.name, total, groups, fired)

    @property
    def max_total(self) -> float:
        return sum(self.group_max.values())


# ──────────────────────────────────────────────────────────────
# Decision trace
# ──────────────────────────────────────────────────────────────
@dataclass
class DecisionTrace:
    """Serialisable record of every rule set evaluated in a pipeline run."""

    outcomes: Dict[str, RuleOutcome] = field(default_factory=dict)

    def record(self, outcome: RuleOutcome) -> None:
        self.outcomes[outcome.name] = outcome

    def as_dict(self) -> Dict[str, Any]:
        return {k: v.as_dict() for k, v in self.outcomes.items()}


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
def _as_float(val: Any, default: Optional[float]) -> Optional[float]:
    if val is None:
        return default
    if isinstance(val, bool):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        import re

        m = re.search(r"-?[\d.]+", val.replace(",", ""))
        return float(m.group()) if m else default
    return default
