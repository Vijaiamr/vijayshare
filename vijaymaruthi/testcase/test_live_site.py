"""
Live integration tests against the deployed platform.

Target: https://frontend-lake-seven-29.vercel.app (configure via VERCEL_BASE_URL)

Covers:
  1. Route protection (unauthenticated redirects, public pages)
  2. Invite-code verification API (valid / invalid / missing / rate-limit)
  3. Dashboard API authorization (no session, bad token, APP_TOKEN path)
  4. Dashboard data contract + integrity (counts, sorting, allowed ratings)
  5. Admin API gates
  6. Session-user path (skipped until auth_schema_v2.sql is applied)
  7. Security headers
  8. Supabase RLS probes (anon must never read snapshot rows)

Run:  python3 -m pytest testcase/test_live_site.py -v
"""

from __future__ import annotations

from urllib.parse import unquote, urlparse

import requests
import pytest

pytestmark = pytest.mark.integration

# ── 1. Route protection ──

PROTECTED_PATHS = ["/", "/portfolio", "/admin/users", "/settings", "/backtest", "/ledger"]
PUBLIC_PATHS = ["/login", "/signup"]


def _parse_redirect(location: str) -> tuple[str, str | None]:
    """Normalise a Location header (relative/absolute, encoded/unencoded)
    into (path, next_param)."""
    parsed = urlparse(location if "://" in location else f"http://x{location}")
    from urllib.parse import parse_qs
    qs = parse_qs(parsed.query)
    nxt = qs.get("next", [None])[0]
    return parsed.path, (unquote(nxt) if nxt else None)


@pytest.mark.parametrize("path", PROTECTED_PATHS)
def test_protected_pages_redirect_to_login(base_url: str, path: str):
    r = requests.get(f"{base_url}{path}", timeout=30, allow_redirects=False)
    assert r.status_code == 307, f"{path}: expected 307, got {r.status_code}"
    loc = r.headers.get("location", "")
    target, next_param = _parse_redirect(loc)
    # Vercel may emit relative/absolute and encoded/unencoded — compare semantics
    assert target == "/login", f"{path}: redirected to {target}, expected /login"
    assert next_param == path, f"{path}: next param lost — got {next_param!r}"


@pytest.mark.parametrize("path", PUBLIC_PATHS)
def test_public_pages_serve(base_url: str, path: str):
    r = requests.get(f"{base_url}{path}", timeout=30)
    assert r.status_code == 200, f"{path}: expected 200, got {r.status_code}"
    assert len(r.text) > 500, f"{path}: suspiciously empty page"


def test_login_redirect_preserves_next_param(base_url: str):
    r = requests.get(f"{base_url}/portfolio", timeout=30, allow_redirects=False)
    target, next_param = _parse_redirect(r.headers.get("location", ""))
    assert target == "/login"
    assert next_param == "/portfolio", f"next param lost: {next_param!r}"


# ── 2. Invite-code verification API ──
# NOTE: Vercel rate-limits this endpoint per IP. If the opt-in brute-force probe
# (test_rate_limit.py) was run recently, our IP is briefly locked and every call
# returns 429. That is a PASSING security signal — these tests accept it.

def test_verify_invite_wrong_code(base_url: str):
    r = requests.post(
        f"{base_url}/api/auth/verify-invite",
        json={"code": "definitely-wrong"},
        timeout=30,
    )
    assert r.status_code in (401, 429), f"expected 401/429, got {r.status_code}"
    if r.status_code == 429:
        pytest.skip("rate-limited (cooldown active) — retry the suite in a few minutes")
    assert r.json().get("error") == "Invalid invite code"


def test_verify_invite_correct_code(base_url: str, cfg: dict):
    code = cfg.get("INVITE_CODE", "")
    if not code:
        pytest.skip("INVITE_CODE not configured")
    r = requests.post(
        f"{base_url}/api/auth/verify-invite",
        json={"code": code},
        timeout=30,
    )
    assert r.status_code in (200, 429), f"expected 200/429, got {r.status_code}"
    if r.status_code == 429:
        pytest.skip("rate-limited (cooldown active) — retry the suite in a few minutes")
    assert r.json() == {"ok": True}


def test_verify_invite_missing_code(base_url: str):
    r = requests.post(f"{base_url}/api/auth/verify-invite", json={}, timeout=30)
    assert r.status_code in (401, 429), f"expected 401/429, got {r.status_code}"
    if r.status_code == 429:
        pytest.skip("rate-limited (cooldown active) — retry the suite in a few minutes")


# ── 3. Dashboard API authorization ──

def test_dashboard_no_session_unauthorized(base_url: str):
    r = requests.get(f"{base_url}/api/dashboard?force=1", timeout=30)
    assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:120]}"


def test_dashboard_wrong_token_unauthorized(base_url: str):
    r = requests.get(f"{base_url}/api/dashboard?token=not-the-token", timeout=30)
    assert r.status_code == 401


def test_dashboard_app_token_authorized(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/dashboard?token={app_token}", timeout=60)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"


# ── 4. Dashboard data contract ──

RATINGS = {"Strong Buy", "Buy", "Hold", "Sell", "Strong Sell", "N/A"}
SIGNALS = {"STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"}


def test_dashboard_data_shape(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/dashboard?token={app_token}", timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data and isinstance(data["rows"], list)
    assert "summary" in data and isinstance(data["summary"], dict)
    assert "db_entries" in data
    assert len(data["rows"]) > 0, "expected at least one stock row"
    assert data["db_entries"] == len(data["rows"]), "db_entries must equal row count"
    row = data["rows"][0]
    for field in ("ticker", "qm_rating", "qm_score", "tech_signal", "tech_score",
                  "fund_score", "price", "rank"):
        assert field in row, f"row missing field {field}"


def test_dashboard_summary_counts_add_up(base_url: str, app_token: str):
    data = requests.get(f"{base_url}/api/dashboard?token={app_token}", timeout=60).json()
    summary = data["summary"]
    assert summary["total"] == len(data["rows"])
    assert summary["buy"] + summary["hold"] + summary["sell"] == summary["total"], (
        f"buy+hold+sell ({summary['buy']}+{summary['hold']}+{summary['sell']}) "
        f"!= total ({summary['total']})"
    )


def test_dashboard_rows_sorted_by_score_desc(base_url: str, app_token: str):
    data = requests.get(f"{base_url}/api/dashboard?token={app_token}", timeout=60).json()
    scores = [r["qm_score"] for r in data["rows"]]
    assert all(scores[i] >= scores[i + 1] for i in range(len(scores) - 1)), (
        "rows not sorted by qm_score descending"
    )


def test_dashboard_ratings_and_signals_valid(base_url: str, app_token: str):
    data = requests.get(f"{base_url}/api/dashboard?token={app_token}", timeout=60).json()
    for row in data["rows"]:
        assert row["qm_rating"] in RATINGS, f"bad rating {row['qm_rating']}"
        assert row["tech_signal"] in SIGNALS, f"bad signal {row['tech_signal']}"
        assert isinstance(row["price"], (int, float)) and row["price"] >= 0
        assert row["rank"] >= 1


def test_dashboard_force_refresh_still_serves(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/dashboard?force=1&token={app_token}", timeout=60)
    assert r.status_code == 200


# ── 4b. Stock detail API (supabase-mode same-origin proxy) ──

def test_stock_detail_requires_auth(base_url: str):
    r = requests.get(f"{base_url}/api/stock/TBZ.NS", timeout=30)
    assert r.status_code == 401, f"expected 401, got {r.status_code}"


def test_stock_detail_serves_real_snapshot_data(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/stock/TBZ.NS?token={app_token}", timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    d = r.json()
    assert d["ticker"] == "TBZ.NS"
    assert isinstance(d["price"], (int, float)) and d["price"] > 0
    assert d["signal"] in SIGNALS
    qm = d["quantamental"]
    assert qm["blended_rating"] in RATINGS
    assert 0 <= qm["blended_score"] <= 100
    assert 0 <= qm["technical_score"] <= 100


def test_stock_detail_unknown_ticker_404(base_url: str, app_token: str):
    r = requests.get(
        f"{base_url}/api/stock/DEFINITELY-NOT-A-TICKER.NS?token={app_token}", timeout=30,
    )
    assert r.status_code == 404, f"expected 404, got {r.status_code}"
    assert "not found" in r.json().get("error", "").lower()


def test_stock_detail_special_char_ticker(base_url: str, app_token: str):
    """Ticker with an ampersand (M&M.NS) must round-trip through the proxy."""
    r = requests.get(f"{base_url}/api/stock/M%26M.NS?token={app_token}", timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    assert r.json()["ticker"] == "M&M.NS"


@pytest.mark.schema
def test_stock_detail_with_session(base_url: str, session_cookie: str):
    r = requests.get(f"{base_url}/api/stock/TBZ.NS", headers={"Cookie": session_cookie}, timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    assert r.json()["ticker"] == "TBZ.NS"


# ── 4c. Chart & fundamentals API (supabase-mode same-origin proxies) ──

def test_ohlcv_requires_auth(base_url: str):
    r = requests.get(f"{base_url}/api/ohlcv/TBZ.NS?period=1y", timeout=30)
    assert r.status_code == 401, f"expected 401, got {r.status_code}"


def test_ohlcv_serves_real_candles(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/ohlcv/TBZ.NS?period=1y&token={app_token}", timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    d = r.json()
    assert d["ticker"] == "TBZ.NS"
    assert d["period"] == "1y"
    candles = d["candles"]
    assert isinstance(candles, list) and len(candles) > 200, f"expected ~252 candles, got {len(candles)}"
    last = candles[-1]
    for k in ("time", "open", "high", "low", "close", "volume"):
        assert k in last, f"candle missing key {k}"
    assert last["close"] > 0


def test_ohlcv_period_slicing(base_url: str, app_token: str):
    counts: dict[str, int] = {}
    for period in ("1mo", "6mo", "1y", "5y"):
        r = requests.get(f"{base_url}/api/ohlcv/TBZ.NS?period={period}&token={app_token}", timeout=30)
        assert r.status_code == 200, f"period {period}: {r.text[:200]}"
        counts[period] = len(r.json()["candles"])
    # 1mo < 6mo < 1y <= 5y, and 5y is capped at 500 (backend parity)
    assert counts["1mo"] < counts["6mo"] < counts["1y"] <= counts["5y"] <= 500


def test_ohlcv_unknown_ticker_404(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/ohlcv/NOTREAL123.NS?period=1y&token={app_token}", timeout=30)
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"


def test_fundamentals_requires_auth(base_url: str):
    r = requests.get(f"{base_url}/api/fundamentals/360ONE", timeout=30)
    assert r.status_code == 401, f"expected 401, got {r.status_code}"


def test_fundamentals_serves_normalized_data(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/fundamentals/360ONE?token={app_token}", timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    d = r.json()
    assert d["ticker"] == "360ONE.NS"
    assert isinstance(d["name"], str) and d["name"]
    assert 0 <= d["fundamental_score"] <= 100
    for k in ("market_cap", "current_price", "pe_trailing", "roe",
              "debt_to_equity", "sector", "industry"):
        assert k in d, f"missing key {k}"
    assert d["current_price"] > 0


def test_fundamentals_bare_and_suffixed_resolution(base_url: str, app_token: str):
    """Callers passing '360ONE' or '360ONE.NS' must get the same row."""
    bare = requests.get(f"{base_url}/api/fundamentals/360ONE?token={app_token}", timeout=30)
    suffixed = requests.get(f"{base_url}/api/fundamentals/360ONE.NS?token={app_token}", timeout=30)
    assert bare.status_code == 200 and suffixed.status_code == 200
    assert bare.json()["ticker"] == suffixed.json()["ticker"] == "360ONE.NS"


def test_fundamentals_unknown_ticker_404(base_url: str, app_token: str):
    r = requests.get(f"{base_url}/api/fundamentals/NOTREAL123?token={app_token}", timeout=30)
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"


@pytest.mark.schema
def test_ohlcv_with_session(base_url: str, session_cookie: str):
    r = requests.get(f"{base_url}/api/ohlcv/TBZ.NS?period=1y",
                     headers={"Cookie": session_cookie}, timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    assert len(r.json()["candles"]) > 0


@pytest.mark.schema
def test_fundamentals_with_session(base_url: str, session_cookie: str):
    r = requests.get(f"{base_url}/api/fundamentals/360ONE",
                     headers={"Cookie": session_cookie}, timeout=30)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    assert r.json()["ticker"] == "360ONE.NS"


# ── 5. Admin API gates ──

def test_admin_users_get_requires_auth(base_url: str):
    r = requests.get(f"{base_url}/api/admin/users", timeout=30)
    assert r.status_code == 401


@pytest.mark.parametrize(
    "payload",
    [
        {"action": "create", "email": "x@y.com", "password": "12345678"},
        {"action": "update", "userId": "abc", "approved": True},
        {"action": "delete", "userId": "abc"},
        {"action": "nonsense"},
    ],
)
def test_admin_users_post_requires_auth(base_url: str, payload: dict):
    r = requests.post(f"{base_url}/api/admin/users", json=payload, timeout=30)
    assert r.status_code == 401, f"{payload['action']}: expected 401, got {r.status_code}"


# ── 6. Session-user path (requires auth_schema_v2.sql applied) ──

@pytest.mark.schema
def test_session_user_dashboard_serves_data(base_url: str, session_cookie: str):
    """An approved, logged-in user must be served the dashboard data."""
    r = requests.get(
        f"{base_url}/api/dashboard?force=1",
        headers={"Cookie": session_cookie},
        timeout=60,
    )
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    data = r.json()
    assert "rows" in data and len(data["rows"]) > 0


@pytest.mark.schema
def test_admin_api_allows_admin(base_url: str, session_cookie: str):
    """An admin session may list users; the response must be valid JSON."""
    r = requests.get(
        f"{base_url}/api/admin/users",
        headers={"Cookie": session_cookie},
        timeout=30,
    )
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    assert isinstance(body, (list, dict)), f"unexpected shape: {type(body).__name__}"


# ── 7. Security headers ──

def test_security_headers_present(base_url: str):
    r = requests.get(f"{base_url}/login", timeout=30)
    headers = r.headers
    assert headers.get("x-frame-options") == "DENY", "missing X-Frame-Options"
    assert headers.get("x-content-type-options") == "nosniff", "missing nosniff"
    assert headers.get("referrer-policy"), "missing Referrer-Policy"
    assert headers.get("permissions-policy"), "missing Permissions-Policy"


# ── 8. Supabase RLS probes ──

def test_anon_cannot_read_snapshot(supabase_url: str, anon_headers: dict | None):
    if not anon_headers:
        pytest.skip("SUPABASE_ANON_KEY not configured")
    r = requests.get(
        f"{supabase_url}/rest/v1/portfolio_snapshot?select=ticker&limit=3",
        headers=anon_headers,
        timeout=20,
    )
    if r.status_code == 200:
        assert r.json() == [], "anon must not see any snapshot rows (RLS)"
    else:
        assert r.status_code in (401, 403), f"unexpected anon status {r.status_code}"


def test_service_key_can_read_snapshot(supabase_url: str, service_headers: dict | None):
    if not service_headers:
        pytest.skip("SUPABASE_SERVICE_ROLE_KEY not configured")
    r = requests.get(
        f"{supabase_url}/rest/v1/portfolio_snapshot?select=ticker&limit=3",
        headers=service_headers,
        timeout=20,
    )
    assert r.status_code == 200
    assert len(r.json()) == 3, "service key should read rows (Mac cron + proxy)"
