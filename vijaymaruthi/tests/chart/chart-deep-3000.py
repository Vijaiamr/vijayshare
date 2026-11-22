"""Deep chart interaction smoke test — updated for the Phase D toolbar."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    page.goto(os.environ.get("BASE_URL", "http://localhost:3000") + "/stock/RELIANCE.NS", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(3000)

    results = {}

    def try_step(name, fn):
        try:
            fn()
            results[name] = "ok"
        except Exception as e:
            results[name] = f"FAIL: {str(e)[:120]}"

    # 1. Toggle RSI (exact match — "rsi" also substring-matches "stochrsi")
    def step1():
        page.get_by_role("button", name="Indicators").click()
        page.wait_for_timeout(600)
        page.get_by_role("menuitemcheckbox", name="rsi", exact=True).click()
        page.wait_for_timeout(400)
        page.keyboard.press("Escape")
        page.wait_for_timeout(1200)
        results["rsi_pane"] = page.get_by_text("RSI", exact=True).count() > 0
        results["canvas_count_rsi"] = page.locator("canvas").count()
    try_step("step1_rsi", step1)

    # 2. Chart type → line
    def step2():
        page.wait_for_timeout(1500)  # let the RSI pane rebuild settle
        diag = []
        for attempt in range(3):
            page.get_by_role("button", name="candle").first.click()
            page.wait_for_timeout(800)
            n = page.get_by_role("menuitemradio", name="Line", exact=True).count()
            radios = page.get_by_role("menuitemradio").all_inner_texts()
            diag.append(f"attempt{attempt}: line_count={n}, menus={page.locator('[role=menu]').count()}, radios={radios[:4]}")
            if n > 0:
                break
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
        results["step2_diag"] = "; ".join(diag)
        page.get_by_role("menuitemradio", name="Line", exact=True).click(timeout=8000)
        page.wait_for_timeout(1200)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        results["chart_type_line"] = page.get_by_text("line", exact=True).count() > 0
    try_step("step2_charttype", step2)

    # 3. Interval → 1W
    def step3():
        page.get_by_role("button", name="1W", exact=True).click()
        page.wait_for_timeout(1500)
        results["interval_1w"] = True
    try_step("step3_interval", step3)

    # 4. Settings dialog (toolbar button has aria-label "Settings")
    def step4():
        page.get_by_label("Settings").click()
        page.wait_for_timeout(600)
        results["settings_dialog"] = page.get_by_text("Chart settings", exact=True).count() > 0
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    try_step("step4_settings", step4)

    # 5. Draw a trendline (aria-label "Trendline")
    def step5():
        page.get_by_label("Trendline").click()
        page.wait_for_timeout(300)
        box = page.locator("div.h-\\[380px\\]").bounding_box()
        if box:
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(cx - 150, cy - 60)
            page.mouse.down()
            page.mouse.move(cx + 150, cy + 60, steps=10)
            page.mouse.up()
            page.wait_for_timeout(600)
        results["drew_trendline"] = True
    try_step("step5_drawing", step5)

    # 6. Replay
    def step6():
        page.get_by_label("Replay").click()
        page.wait_for_timeout(800)
        results["replay_bar"] = page.get_by_text("Exit", exact=True).count() > 0
        page.get_by_text("Exit", exact=True).click()
        page.wait_for_timeout(400)
    try_step("step6_replay", step6)

    results["errors"] = errors[:10]
    print(results)
    page.screenshot(path="/tmp/vm_chart_deep.png")
    browser.close()