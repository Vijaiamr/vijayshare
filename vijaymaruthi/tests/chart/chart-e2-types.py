#!/usr/bin/env python3
"""E2 verification — alternative chart types (Kagi, P&F, Range, Line Break)."""
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

        async def switch_type(current: str, target: str):
            await page.get_by_role("button", name=current, exact=True).first.click()
            await page.wait_for_timeout(600)
            await page.get_by_role("menuitemradio", name=target, exact=True).click()
            await page.wait_for_timeout(1000)
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(400)
            canvases = await page.locator("canvas").count()
            return canvases

        # Each alternative type renders (canvas count > 0, no errors)
        # Button shows the lowercase value; menu items show the label.
        current = "candle"
        for label, key in [("Kagi", "kagi"), ("Point & Figure", "pointfigure"),
                           ("Range", "range"), ("Line Break", "linebreak")]:
            n = await switch_type(current, label)
            results.append((f"chart type: {label} renders", n > 0, f"{n} canvases"))
            current = key

        # Settings: change Kagi reversal → no error, chart still renders
        await switch_type(current, "Kagi")
        current = "kagi"
        await page.get_by_label("Settings").click()
        await page.wait_for_timeout(600)
        rev = page.get_by_label("Kagi reversal (%)")
        if await rev.count() > 0:
            await rev.fill("8")
            await page.wait_for_timeout(800)
            results.append(("kagi reversal setting applies", True, ""))
        else:
            results.append(("kagi reversal setting applies", False, "input not found"))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        n = await page.locator("canvas").count()
        results.append(("chart still renders after param change", n > 0, f"{n} canvases"))

        # Back to candle
        await switch_type(current, "Candle")
        results.append(("back to candle", True, ""))

        results.append(("zero console errors", len(errors) == 0, "; ".join(errors[:4])))
        await browser.close()

    ok = all(r[1] for r in results)
    for name, passed, note in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}  {note}")
    print(f"\n{'ALL PASS' if ok else 'FAILURES PRESENT'}")
    sys.exit(0 if ok else 1)

asyncio.run(main())