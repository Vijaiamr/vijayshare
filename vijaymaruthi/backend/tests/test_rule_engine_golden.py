"""Golden-master equality gate for the rule-engine refactor.

Regenerates the offline snapshot for every fixture case and asserts it matches
the committed ``backend/tests/golden/<case>.json`` byte-for-byte (as parsed
JSON). Any behavioural change in signal, confidence, convolution, quantamental
fusion, quality gates, or pattern detection will fail here.

Regenerate the golden files after an *intended* behaviour change with:
    python3 backend/scripts/snapshot_golden.py

Run:
    cd vijaymaruthi/backend && python -m pytest tests/test_rule_engine_golden.py -v
"""
import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from fixtures.golden_cases import CASES  # noqa: E402
from fixtures.snapshot import golden_path, run_case, snapshot_all  # noqa: E402

_CASE_NAMES = [c["name"] for c in CASES]


@pytest.mark.parametrize("name", _CASE_NAMES)
def test_golden_case_matches(name):
    """Each fixture case reproduces its committed golden snapshot exactly."""
    case = next(c for c in CASES if c["name"] == name)
    path = golden_path(name)
    assert path.exists(), (
        f"missing golden file {path}; run: python3 backend/scripts/snapshot_golden.py"
    )
    expected = json.loads(path.read_text())
    actual = run_case(case)
    assert actual == expected, _diff(expected, actual)


def test_snapshot_is_deterministic():
    """Two runs over the same fixtures must be identical (no hidden state)."""
    assert snapshot_all() == snapshot_all()


def _diff(expected: dict, actual: dict) -> str:
    """Human-readable first-difference summary for assertion messages."""
    lines = [f"case={expected.get('case')}"]
    for key in sorted(set(expected) | set(actual)):
        e, a = expected.get(key), actual.get(key)
        if e != a:
            lines.append(f"  {key}: expected={e!r} actual={a!r}")
    return "\n".join(lines)
