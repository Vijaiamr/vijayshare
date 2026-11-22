#!/usr/bin/env python3
"""analytics-filters-drilldown.py — verify global filters, drill-down pages,
role enforcement and audit logging for the analytics section.

Requires: python3 + playwright (pip install playwright && playwright install chromium)
Usage:    BASE_URL=http://localhost:3000 python3 analytics-filters-drilldown.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3000")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "analytics-test@vijaymaruthi.local")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "Test@12345")
USER_EMAIL = os.environ.get("USER_EMAIL", "analytics-user@vijaymaruthi.local")
USER_PASS = os.environ.get("USER_PASS", "Test@12345")

failures = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global failures
    if cond:
        print(f"OK   {label}")
    else:
        failures += 1
        print(f"FAIL {label} {detail}")


def login(page, email: str, password: str) -> bool:
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.fill('input[type="email"], input[name="email"]', email)
    page.fill('input[type="password"], input[name="password"]', password)
    page.click('button[type="submit"]')
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=20000)
    except Exception:
        pass
    page.wait_for_timeout(1200)
    return "/login" not in page.url


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()

        check("login (admin)", login(page, ADMIN_EMAIL, ADMIN_PASS))

        def get(path: str):
            resp = page.request.get(f"{BASE_URL}{path}")
            try:
                return resp.status, resp.json()
            except Exception:
                return resp.status, resp.text()[:200]

        # ── Global filters ──
        sc, j = get("/api/admin/analytics/overview")
        check("overview default 200", sc == 200, f"→ {sc}")
        check("overview has kpis", bool(j.get("kpis")), f"→ {j.get('kpis')}")
        check("overview has deltas", "deltas" in j, "→ missing deltas")
        check("overview has series", len(j.get("series", [])) > 0, "→ empty series")

        sc, j = get("/api/admin/analytics/overview?segment=converted")
        check("overview segment=converted 200", sc == 200, f"→ {sc}")
        conv = j.get("kpis", {}).get("conversions", 0)
        sess = j.get("kpis", {}).get("sessions", 0)
        check("segment=converted sessions==conversions", sess == conv, f"→ {sess} vs {conv}")

        sc, j = get("/api/admin/analytics/overview?compare=previous")
        check("overview compare=previous 200", sc == 200, f"→ {sc}")
        check("overview compare has comparison key", "comparison" in j, "→ missing comparison")

        sc, j = get("/api/admin/analytics/overview?range=custom&start=2026-08-01&end=2026-08-31")
        check("overview custom range 200", sc == 200, f"→ {sc}")
        check("custom range days==31", j.get("days") == 31, f"→ {j.get('days')}")

        sc, j = get("/api/admin/analytics/overview?device=mobile")
        check("overview device=mobile 200", sc == 200, f"→ {sc}")

        sc, j = get("/api/admin/analytics/top-pages?segment=converted")
        check("top-pages segment=converted 200", sc == 200, f"→ {sc}")

        sc, j = get("/api/admin/analytics/revenue?compare=previous")
        check("revenue compare=previous 200", sc == 200, f"→ {sc}")
        check("revenue total>0", j.get("totalRevenue", 0) > 0, f"→ {j.get('totalRevenue')}")

        # ── Drill-down APIs ──
        sc, j = get("/api/admin/analytics/events?limit=20")
        check("event explorer 200", sc == 200, f"→ {sc}")
        check("event explorer has breakdown", len(j.get("breakdown", [])) > 0, "→ empty breakdown")
        check("event explorer has events", len(j.get("events", [])) > 0, "→ empty events")

        sc, j = get("/api/admin/analytics/journeys?limit=3")
        session_id = j.get("journeys", [{}])[0].get("id") if j.get("journeys") else None
        check("journeys 200", sc == 200, f"→ {sc}")
        check("journeys has session id", bool(session_id), "→ no session id")

        sc, j = get("/api/admin/analytics/top-users?limit=5")
        anon = j.get("rows", [{}])[0].get("anonymous_id") if j.get("rows") else None
        check("top-users 200", sc == 200, f"→ {sc}")
        check("top-users has anon id", bool(anon), "→ no anonymous id")

        if anon:
            sc, j = get(f"/api/admin/analytics/users/{anon}")
            check("user profile (anon) 200", sc == 200, f"→ {sc}")
            check("user profile has summary", "summary" in j, "→ missing summary")

        if session_id:
            sc, j = get(f"/api/admin/analytics/sessions/{session_id}")
            check("session detail 200", sc == 200, f"→ {sc}")
            check("session detail has session", bool(j.get("session")), "→ missing session")
            check("session detail has path", "path" in j, "→ missing path")

        # ── Audit log (admin) ──
        sc, j = get("/api/admin/analytics/audit")
        check("audit log 200 (admin)", sc == 200, f"→ {sc}")

        # ── Role enforcement: regular user gets 403 ──
        ctx2 = browser.new_context()
        page2 = ctx2.new_page()
        check("login (user)", login(page2, USER_EMAIL, USER_PASS))
        resp = page2.request.get(f"{BASE_URL}/api/admin/analytics/overview")
        check("user overview → 403", resp.status == 403, f"→ {resp.status}")
        resp = page2.request.get(f"{BASE_URL}/api/admin/analytics/audit")
        check("user audit → 403", resp.status == 403, f"→ {resp.status}")
        page2.goto(f"{BASE_URL}/admin/analytics/exec", wait_until="domcontentloaded")
        try:
            page2.wait_for_function(
                "document.body && (document.body.innerText.includes('Forbidden') || document.body.innerText.includes('Executive'))",
                timeout=15000,
            )
            body = page2.inner_text("body")
            check("user exec page → Forbidden", "Forbidden" in body, "→ not forbidden")
        except Exception:
            check("user exec page → Forbidden", False, "→ timeout waiting for gate")
        ctx2.close()

        # ── Drill-down pages render ──
        def page_has_text(path: str, text: str, timeout_ms: int = 15000) -> bool:
            page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
            try:
                page.wait_for_function(
                    f"document.body && document.body.innerText.includes({text!r})",
                    timeout=timeout_ms,
                )
                return True
            except Exception:
                return False

        if anon:
            check("user profile page renders", page_has_text(f"/admin/analytics/users/{anon}", "User Profile"))
        if session_id:
            check("session detail page renders", page_has_text(f"/admin/analytics/sessions/{session_id}", "Session Detail"))
        check("event explorer page renders", page_has_text("/admin/analytics/events", "Event Explorer"))
        check("audit page renders", page_has_text("/admin/analytics/audit", "Audit Log"))

        browser.close()

    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S)'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())