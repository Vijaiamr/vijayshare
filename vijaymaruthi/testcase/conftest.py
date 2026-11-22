"""
Shared fixtures for the VijayMaruthi test suite.

Loads config from testcase/.env (chmod 600, gitignored). Provides:
  - cfg:            all config keys
  - base_url:       VERCEL_BASE_URL (deployed site)
  - supabase:       Supabase REST helpers (service + anon probes)
  - schema_applied: whether auth_schema_v2.sql has been run (probed live)
  - session_cookie: an authenticated sb-* cookie for the test user (skips
                    if login credentials are unavailable)
"""

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path

import pytest
import requests

ENV_FILE = Path(__file__).parent / ".env"


def _load_env() -> dict:
    cfg: dict = {}
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            cfg[k.strip()] = v.strip()
    # Environment overrides file
    cfg.update({k: v for k, v in os.environ.items() if k in cfg or k.startswith(("VERCEL_", "SUPABASE_", "TEST_", "APP_TOKEN", "INVITE_CODE"))})
    return cfg


@pytest.fixture(scope="session")
def cfg() -> dict:
    return _load_env()


@pytest.fixture(scope="session")
def base_url(cfg: dict) -> str:
    url = cfg.get("VERCEL_BASE_URL", "").rstrip("/")
    if not url:
        pytest.skip("VERCEL_BASE_URL not configured — set it in testcase/.env")
    return url


@pytest.fixture(scope="session")
def supabase_url(cfg: dict) -> str:
    return cfg.get("SUPABASE_URL", "").rstrip("/")


@pytest.fixture(scope="session")
def anon_headers(cfg: dict) -> dict | None:
    key = cfg.get("SUPABASE_ANON_KEY", "")
    if not key:
        return None
    return {"apikey": key, "Authorization": f"Bearer {key}"}


@pytest.fixture(scope="session")
def service_headers(cfg: dict) -> dict | None:
    key = cfg.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        return None
    return {"apikey": key, "Authorization": f"Bearer {key}"}


@pytest.fixture(scope="session")
def schema_applied(cfg: dict, supabase_url: str, service_headers: dict | None) -> bool:
    """Probe whether public.profiles exists (auth_schema_v2.sql applied)."""
    if not service_headers:
        return False
    try:
        r = requests.get(
            f"{supabase_url}/rest/v1/profiles?select=id&limit=1",
            headers=service_headers,
            timeout=15,
        )
        return r.status_code == 200
    except requests.RequestException:
        return False


@pytest.fixture(scope="session")
def session_cookie(cfg: dict, supabase_url: str, anon_headers: dict | None, schema_applied: bool):
    """
    Build the supabase-ssr session cookie(s) for TEST_EMAIL / TEST_PASSWORD.

    @supabase/ssr stores the session object (JSON) in a cookie named
    `sb-<ref>-auth-token` whose value is:
        "base64-" + base64url( JSON: {"access_token", "refresh_token",
        "expires_at", "expires_in", "token_type", "user"} )
    Values longer than MAX_CHUNK_SIZE (3180 chars) are split across cookies
    named `sb-<ref>-auth-token.<i>`.

    Verified against the exact bytes the deployed app writes (probe via
    createServerClient + signInWithPassword).

    Skipped when credentials are absent or the schema is not applied
    (schema-dependent tests get skipped by the fixture chain anyway).
    """
    email = cfg.get("TEST_EMAIL", "")
    password = cfg.get("TEST_PASSWORD", "")
    ref = cfg.get("SUPABASE_PROJECT_REF", "")
    if not (email and password and anon_headers and ref):
        pytest.skip("TEST_EMAIL / TEST_PASSWORD / SUPABASE_PROJECT_REF not configured")
    if not schema_applied:
        pytest.skip("auth_schema_v2.sql not applied — schema-dependent checks skipped")

    r = requests.post(
        f"{supabase_url}/auth/v1/token?grant_type=password",
        headers=anon_headers,
        json={"email": email, "password": password},
        timeout=20,
    )
    if r.status_code != 200:
        pytest.skip(f"Login as TEST_EMAIL failed ({r.status_code}) — session checks skipped")
    data = r.json()
    now = int(time.time())
    session = {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": data.get("expires_at") or now + int(data.get("expires_in", 3600)),
        "expires_in": int(data.get("expires_in", 3600)),
        "token_type": "bearer",
        "user": data.get("user"),
    }
    encoded = "base64-" + base64.urlsafe_b64encode(
        json.dumps(session).encode()
    ).decode().rstrip("=")
    if len(encoded) <= 3180:
        return f"sb-{ref}-auth-token={encoded}"
    # Chunked: sb-<ref>-auth-token.0, .1, ... (matches @supabase/ssr chunker)
    chunks = [encoded[i : i + 3180] for i in range(0, len(encoded), 3180)]
    return "; ".join(
        f"sb-{ref}-auth-token.{i}={chunk}" for i, chunk in enumerate(chunks)
    )


@pytest.fixture(scope="session")
def app_token(cfg: dict) -> str:
    token = cfg.get("APP_TOKEN", "")
    if not token:
        pytest.skip("APP_TOKEN not configured — set it from sync/.app_token")
    return token
