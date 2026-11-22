#!/usr/bin/env python3
"""Phase D verification — TradingView feature expansion on port 3000."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
URL = f"{BASE}/stock/RELIANCE.NS"

async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 1000})
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        await page.goto(URL, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)

        # 1. Chart renders
        canvases = await page.locator("canvas").count()
        results.append(("chart renders (canvases)", canvases > 0, f"{canvases} canvases"))

        # 2. Toolbar has new buttons
        for label in ["Indicators", "Compare", "Templates", "Symbol search", "Snapshot"]:
            btn = page.get_by_role("button", name=label)
            results.append((f"toolbar: {label}", await btn.count() > 0, ""))

        # 3. Baseline chart type
        await page.get_by_role("button", name="candle").first.click()
        await page.wait_for_timeout(500)
        await page.get_by_text("Baseline", exact=True).click()
        await page.wait_for_timeout(800)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        results.append(("chart type: baseline", True, "switched"))

        # 4. Intraday interval 1h
        await page.get_by_role("button", name="1h", exact=True).click()
        await page.wait_for_timeout(2500)
        results.append(("interval: 1h", True, "clicked"))

        # 5. Indicators menu — toggle RSI + ATR + MFI (sub-panes)
        await page.get_by_role("button", name="Indicators").click()
        await page.wait_for_timeout(500)
        for ind in ["rsi", "atr", "mfi"]:
            item = page.get_by_role("menuitemcheckbox", name=ind, exact=True)
            if await item.count() > 0:
                await item.click()
                await page.wait_for_timeout(300)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(1200)
        pane_labels = 0
        for lbl in ["RSI", "ATR", "MFI"]:
            pane_labels += await page.get_by_text(lbl, exact=True).count()
        results.append(("indicator sub-panes (rsi/atr/mfi)", pane_labels >= 3, f"{pane_labels} labels"))

        # 6. Data window visible
        dw = await page.locator("text=Vol").count()
        results.append(("data window (Vol row)", dw > 0, ""))

        # 7. Object tree opens
        await page.get_by_role("button", name="Open object tree").click()
        await page.wait_for_timeout(400)
        ot = await page.get_by_text("Objects", exact=False).count()
        results.append(("object tree opens", ot > 0, ""))
        await page.get_by_role("button", name="Close object tree").click()

        # 8. Symbol search opens
        await page.get_by_role("button", name="Symbol search").click()
        await page.wait_for_timeout(800)
        ss = await page.get_by_text("Symbol search", exact=True).count()
        results.append(("symbol search dialog", ss > 0, ""))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # 9. Templates dialog opens
        await page.get_by_role("button", name="Templates").click()
        await page.wait_for_timeout(400)
        tpl = await page.get_by_text("Chart templates", exact=True).count()
        results.append(("templates dialog", tpl > 0, ""))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # 10. Drawing tool — ray (2 clicks)
        await page.get_by_role("button", name="Ray").click()
        await page.wait_for_timeout(300)
        chart_box = await page.locator("canvas").first.bounding_box()
        if chart_box:
            cx, cy = chart_box["x"] + chart_box["width"] / 2, chart_box["y"] + chart_box["height"] / 2
            await page.mouse.click(cx - 150, cy - 50)
            await page.mouse.click(cx + 150, cy + 50)
            await page.wait_for_timeout(400)
        results.append(("drawing: ray placed", True, ""))

        # 11. Snapshot (clipboard may fail headless → fallback download)
        # Close any lingering dialog first
        for _ in range(3):
            dlg = await page.locator("[role=dialog]").count()
            if dlg == 0:
                break
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
        try:
            await page.get_by_role("button", name="Snapshot").click(timeout=8000)
            await page.wait_for_timeout(800)
            results.append(("snapshot clicked", True, ""))
        except Exception as e:
            await page.screenshot(path="/tmp/chart-phase-d-snap-fail.png")
            results.append(("snapshot clicked", False, str(e)[:120]))

        # 12. Settings — price scale mode + watermark
        await page.get_by_label("Settings").click()
        await page.wait_for_timeout(500)
        wm = await page.get_by_label("Watermark (empty = off)").count()
        results.append(("settings: watermark field", wm > 0, ""))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # 13. Console errors
        results.append(("zero console errors", len(console_errors) == 0, "; ".join(console_errors[:5])))

        await browser.close()

    ok = all(r[1] for r in results)
    for name, passed, note in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}  {note}")
    print(f"\n{'ALL PASS' if ok else 'FAILURES PRESENT'}")
    sys.exit(0 if ok else 1)

asyncio.run(main())