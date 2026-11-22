"""
Opt-in brute-force probe against /api/auth/verify-invite.

Deliberately fires 25 rapid wrong-code attempts from the same IP. Two assertions:
  1. The endpoint must NEVER 5xx under abuse (only 401 / 429 allowed).
  2. The per-IP rate limiter MUST trip at least once (that is the security win).

Warning: tripping it locks the caller's IP out of verify-invite for a few
minutes (Vercel rate limit). This is why the test is excluded from the default
run. Execute explicitly with:

    python3 -m pytest testcase/test_rate_limit.py -v
"""

import pytest
import requests

pytestmark = pytest.mark.rate_limit


def test_verify_invite_brute_force_never_5xx(base_url: str):
    statuses = []
    for i in range(25):
        r = requests.post(
            f"{base_url}/api/auth/verify-invite",
            json={"code": f"brute-{i}"},
            timeout=30,
        )
        statuses.append(r.status_code)

    assert all(s in (401, 429) for s in statuses), (
        f"unexpected statuses during brute-force probe: {set(statuses)}"
    )
    tripped = statuses.count(429)
    assert tripped > 0, "rate limiter never tripped on 25 rapid attempts"
    print(f"\n  Rate limiter tripped: {tripped}/25 requests -> 429")
