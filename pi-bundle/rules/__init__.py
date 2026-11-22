"""Rule engine for market analysis.

Domain rule modules (pure, code-defined, individually-addressable):

* ``core``          — MarketFeatures, Rule, RuleSet, RuleOutcome, DecisionTrace
* ``technical``     — classify_signal, technical_convolution
* ``fundamental``   — fundamental_convolution (7-factor + AND-floor cap)
* ``gates``         — apply_quality_gates (liquidity/leverage/valuation filters)
* ``quantamental``  — compute_quantamental (+ cap_weight, fallback_fund_score)
* ``pattern_gates`` — pattern_votes (calibrated weights + acceptance filters)
"""
from .core import DecisionTrace, MarketFeatures, Rule, RuleOutcome, RuleSet  # noqa: F401
from . import fundamental, gates, pattern_gates, quantamental, technical  # noqa: F401
