#!/usr/bin/env python3
"""analytics-admin-smoke.py — log in as admin and verify the analytics APIs.

Requires: python3 + playwright (pip install playwright && playwright install chromium)
Usage:    BASE_URL=http://localhost:3000 python3 analytics-admin-smoke.py
"""
import os
import sys
import json

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3000")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "analytics-test@vijaymaruthi.local")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "Test@12345")

API_ROUTES = [
    "/api/admin/analytics/overview?days=7",
    "/api/admin/analytics/realtime",
    "/api/admin/analytics/top-pages?days=7",
    "/api/admin/analytics/top-users?days=7",
    "/api/admin/analytics/funnels?days=7",
    "/api/admin/analytics/journeys?days=7",
    "/api/admin/analytics/campaigns?days=7",
    "/api/admin/analytics/attribution?days=7",
    "/api/admin/analytics/audiences?days=7",
    "/api/admin/analytics/ux?days=7",
    "/api/admin/analytics/revenue?days=7",
    "/api/admin/analytics/alerts",
]

PAGES = [
    "/admin/analytics/exec",
    "/admin/analytics",
    "/admin/analytics/realtime",
    "/admin/analytics/funnels",
    "/admin/analytics/journeys",
    "/admin/analytics/campaigns",
    "/admin/analytics/attribution",
    "/admin/analytics/audiences",
    "/admin/analytics/ux",
    "/admin/analytics/replay",
    "/admin/analytics/insights",
    "/admin/analytics/revenue",
    "/admin/analytics/alerts",
]


def main() -> int:
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()

        # ── Login ──
        page.goto(f"{BASE_URL}/login", wait_until="networkidle")
        page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"], input[name="password"]', ADMIN_PASS)
        page.click('button[type="submit"]')
        try:
            page.wait_for_url(lambda u: "/login" not in u, timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        url = page.url
        if "/login" in url:
            print("FAIL login — still on /login")
            browser.close()
            return 1
        print(f"OK   login → {url}")

        # ── Admin APIs ──
        for route in API_ROUTES:
            resp = page.request.get(f"{BASE_URL}{route}")
            ok = resp.status == 200
            body = ""
            try:
                body = resp.json()
            except Exception:
                body = resp.text()[:200]
            if ok:
                print(f"OK   {route} → {resp.status}")
            else:
                failures += 1
                print(f"FAIL {route} → {resp.status} {str(body)[:200]}")

        # ── Admin pages render (no crash) ──
        for path in PAGES:
            page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
            page.wait_for_timeout(800)
            title = page.title()
            body_text = page.inner_text("body")[:120].replace("\n", " ")
            if "Forbidden" in body_text:
                failures += 1
                print(f"FAIL {path} → Forbidden")
            else:
                print(f"OK   {path} → {title!r} | {body_text}")

        browser.close()

    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S)'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())