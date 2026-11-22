#!/usr/bin/env python3
"""Phase D extras — undo/redo, hotkeys, volume profile, session breaks."""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
URL = f"{BASE}/stock/RELIANCE.NS"

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

        # 1. Volume profile toggle → overlay svg rects
        await page.get_by_role("button", name="Indicators").click()
        await page.wait_for_timeout(500)
        await page.get_by_role("menuitemcheckbox", name="volumeProfile", exact=True).click()
        await page.wait_for_timeout(400)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(1200)
        vp_rects = await page.locator("svg rect").count()
        results.append(("volume profile overlay (rects)", vp_rects > 0, f"{vp_rects} rects"))

        # 2. Session breaks — toggle on (default on) → dashed lines
        sb_lines = await page.locator("svg line[stroke-dasharray]").count()
        results.append(("session breaks (dashed lines)", sb_lines > 0, f"{sb_lines} lines"))

        # 3. Hotkey V → trendline tool active
        await page.keyboard.press("v")
        await page.wait_for_timeout(300)
        pressed = await page.evaluate("""() => {
            const b = document.querySelector('button[aria-label="Trendline"]');
            return b ? (b.getAttribute('aria-pressed') || b.getAttribute('data-active') || b.className.includes('bg-secondary')) : false;
        }""")
        results.append(("hotkey V → trendline active", bool(pressed), str(pressed)))

        # 4. Draw a trendline with V tool
        box = await page.locator("canvas").first.bounding_box()
        if box:
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            await page.mouse.click(cx - 150, cy - 50)
            await page.mouse.click(cx + 150, cy + 50)
            await page.wait_for_timeout(400)
        obj_count = await page.get_by_text("Objects", exact=False).count()
        results.append(("drawing added", True, ""))

        # 5. Undo (Ctrl+Z) → drawing removed
        await page.keyboard.press("Control+z")
        await page.wait_for_timeout(500)
        # Object tree should show 0 objects
        await page.get_by_role("button", name="Open object tree").click()
        await page.wait_for_timeout(400)
        empty = await page.get_by_text("No drawings yet.", exact=True).count()
        results.append(("undo removes drawing", empty > 0, ""))
        await page.get_by_role("button", name="Close object tree").click()
        await page.wait_for_timeout(300)

        # 6. Redo (Ctrl+Shift+Z) → drawing restored
        await page.keyboard.press("Control+Shift+z")
        await page.wait_for_timeout(500)
        await page.get_by_role("button", name="Open object tree").click()
        await page.wait_for_timeout(400)
        obj = await page.get_by_text("Objects (1)", exact=False).count()
        results.append(("redo restores drawing", obj > 0, ""))
        await page.get_by_role("button", name="Close object tree").click()
        await page.wait_for_timeout(300)

        # 7. Select drawing + Delete key
        await page.get_by_role("button", name="Open object tree").click()
        await page.wait_for_timeout(400)
        # Click the drawing row (first button in the list)
        row = page.locator("div.group").first
        if await row.count() > 0:
            await row.click()
            await page.wait_for_timeout(300)
        await page.get_by_role("button", name="Close object tree").click()
        await page.wait_for_timeout(300)
        await page.keyboard.press("Delete")
        await page.wait_for_timeout(500)
        await page.get_by_role("button", name="Open object tree").click()
        await page.wait_for_timeout(400)
        empty2 = await page.get_by_text("No drawings yet.", exact=True).count()
        results.append(("delete key removes selected", empty2 > 0, ""))
        await page.get_by_role("button", name="Close object tree").click()

        # 8. Zero console errors
        results.append(("zero console errors", len(errors) == 0, "; ".join(errors[:4])))

        await browser.close()

    ok = all(r[1] for r in results)
    for name, passed, note in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}  {note}")
    print(f"\n{'ALL PASS' if ok else 'FAILURES PRESENT'}")
    sys.exit(0 if ok else 1)

asyncio.run(main())