#!/usr/bin/env python3
"""Alerts + Layouts dialog verification (local mode, port 3000)."""
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get("BASE_URL", "http://localhost:3000") + "/stock/RELIANCE.NS"

async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)

        # ── Alerts ──
        await page.get_by_role("button", name="Alerts").click()
        await page.wait_for_timeout(600)
        dlg = page.get_by_role("dialog")
        results.append(("alerts dialog opens", await dlg.count() > 0, ""))
        title = await page.get_by_text("Price alerts", exact=False).count()
        results.append(("alerts dialog title", title > 0, ""))

        # Create an alert: above current price
        price_input = page.get_by_placeholder("Price")
        if await price_input.count() > 0:
            await price_input.fill("99999")
            await page.get_by_role("button", name="Add", exact=True).click()
            await page.wait_for_timeout(800)
            row = await page.get_by_text("99,999", exact=True).count()
            results.append(("alert created + listed", row > 0, ""))
            # Delete it
            del_btn = page.get_by_role("button", name="Delete alert").first
            if await del_btn.count() > 0:
                await del_btn.click()
                await page.wait_for_timeout(600)
                row2 = await page.get_by_text("99,999", exact=True).count()
                results.append(("alert deleted", row2 == 0, ""))
        else:
            results.append(("alert create input", False, "no price input found"))

        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)

        # ── Layouts ──
        await page.get_by_role("button", name="Layouts").click()
        await page.wait_for_timeout(600)
        dlg2 = page.get_by_role("dialog")
        results.append(("layouts dialog opens", await dlg2.count() > 0, ""))
        name_input = page.get_by_placeholder("Layout name")
        if await name_input.count() > 0:
            await name_input.fill("Test Layout")
            await page.get_by_role("button", name="Save", exact=True).click()
            await page.wait_for_timeout(800)
            row = await page.get_by_text("Test Layout", exact=True).count()
            results.append(("layout saved + listed", row > 0, ""))
            # Delete it
            del_btn = page.get_by_role("button", name="Delete layout").first
            if await del_btn.count() > 0:
                await del_btn.click()
                await page.wait_for_timeout(600)
                row2 = await page.get_by_text("Test Layout", exact=True).count()
                results.append(("layout deleted", row2 == 0, ""))
        else:
            results.append(("layout save input", False, "no name input found"))

        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)

        results.append(("zero console errors", len(errors) == 0, "; ".join(errors[:4])))
        await browser.close()

    ok = all(r[1] for r in results)
    for name, passed, note in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}  {note}")
    print(f"\n{'ALL PASS' if ok else 'FAILURES PRESENT'}")
    sys.exit(0 if ok else 1)

asyncio.run(main())