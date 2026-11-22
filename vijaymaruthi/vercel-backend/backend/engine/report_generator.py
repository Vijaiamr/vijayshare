"""
Executive Report Generator — VijayMaruthi Wealth Management.

Produces a self-contained, print-friendly HTML executive report
with inline CSS (no external dependencies). Suitable for PDF export
via browser print-to-PDF.
"""

import math
from datetime import datetime
from typing import Any


# ── Helpers ──

_TIER_COLORS = {
    "Strong": "#2e7d32",
    "Moderate": "#e65100",
    "Weak": "#c62828",
}

_SIGNAL_COLORS: dict[str, dict[str, str]] = {
    "Strong Buy":  {"bg": "#1b5e20", "text": "#ffffff"},
    "Buy":         {"bg": "#2e7d32", "text": "#ffffff"},
    "Hold":        {"bg": "#f57f17", "text": "#ffffff"},
    "Sell":        {"bg": "#c62828", "text": "#ffffff"},
    "Strong Sell": {"bg": "#b71c1c", "text": "#ffffff"},
}

_TREND_ICONS = {
    "improving":     "▲",
    "deteriorating": "▼",
    "stable":        "—",
}


def _tier(score: float) -> str:
    return "Strong" if score >= 75 else "Moderate" if score >= 55 else "Weak"


def _tier_color(score: float) -> str:
    return _TIER_COLORS.get(_tier(score), "#757575")


def _fmt_price(price: float | None) -> str:
    if price is None or price == 0:
        return "—"
    return f"₹{price:,.2f}"


def _donut_svg(buy: int, hold: int, sell: int, total: int) -> str:
    """Return an inline SVG donut chart for the rating distribution."""
    if total == 0:
        return ""
    bp = buy / total * 100
    hp = hold / total * 100
    sp = sell / total * 100
    # Compute arc segments — simplified stroke-dasharray approach
    r = 40
    circ = 2 * math.pi * r
    b_len = bp / 100 * circ
    h_len = hp / 100 * circ
    s_len = sp / 100 * circ
    b_off = 0
    h_off = -(b_len)
    s_off = -(b_len + h_len)

    def arc_seg(length: float, offset: float, color: str, label: str, pct: float) -> str:
        if length <= 0:
            return ""
        return f"""<circle cx="50" cy="50" r="{r}" fill="none" stroke="{color}"
          stroke-width="18" stroke-dasharray="{length:.1f} {circ - length:.1f}"
          stroke-dashoffset="{offset:.1f}" transform="rotate(-90 50 50)" />
        <text x="50" y="112" font-size="10" fill="{color}" text-anchor="middle"
          font-family="Inter, sans-serif" font-weight="600">{label} {pct:.1f}%</text>"""

    segs = ""
    if b_len > 0:
        segs += arc_seg(b_len, b_off, _TIER_COLORS["Strong"], "Buy", bp)
    if h_len > 0:
        segs += arc_seg(h_len, h_off, _TIER_COLORS["Moderate"], "Hold", hp)
    if s_len > 0:
        segs += arc_seg(s_len, s_off, _TIER_COLORS["Weak"], "Sell", sp)

    return f"""<svg width="200" height="130" viewBox="0 0 100 130"
      xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;">
      {segs}
      <text x="50" y="55" font-size="22" fill="#e0e0e0" text-anchor="middle"
        font-family="Inter, sans-serif" font-weight="700">{total}</text>
    </svg>"""


def _trend_svg(improving: int, deteriorating: int, stable: int, total: int) -> str:
    """Horizontal stacked bar for trend distribution."""
    if total == 0:
        return ""
    ip = improving / total * 100
    dp = deteriorating / total * 100
    sp = stable / total * 100

    bars = ""
    if ip > 0:
        bars += f"""<rect x="0" y="0" width="{ip}%" height="20" fill="#2e7d32" rx="4" />"""
    if dp > 0:
        bars += f"""<rect x="{ip}%" y="0" width="{dp}%" height="20" fill="#c62828" rx="4" />"""
    if sp > 0:
        bars += f"""<rect x="{ip + dp}%" y="0" width="{sp}%" height="20" fill="#757575" rx="4" />"""

    return f"""<svg width="100%" height="20" viewBox="0 0 100 20"
      xmlns="http://www.w3.org/2000/svg" style="display:block;border-radius:4px;">
      {bars}
    </svg>"""


def generate_report(rows: list[dict[str, Any]]) -> str:
    """Generate a professional executive report HTML string.

    Parameters
    ----------
    rows : list[dict]
        Dashboard rows with keys: ticker, qm_rating, qm_score, trend,
        score_change, tech_signal, fund_rating, price, history_runs, etc.
    """
    now = datetime.now().strftime("%B %d, %Y at %H:%M")
    total = len(rows)

    if total == 0:
        return _empty_report(now)

    # Compute aggregates
    buy = sum(1 for r in rows if r.get("qm_rating") in ("Strong Buy", "Buy"))
    hold = sum(1 for r in rows if r.get("qm_rating") == "Hold")
    sell = sum(1 for r in rows if r.get("qm_rating") in ("Sell", "Strong Sell"))

    improving = sum(1 for r in rows if r.get("trend") == "improving")
    deteriorating = sum(1 for r in rows if r.get("trend") == "deteriorating")
    stable = sum(1 for r in rows if r.get("trend") == "stable")

    strong = sum(1 for r in rows if r.get("qm_score", 0) >= 75)
    moderate = sum(1 for r in rows if 55 <= r.get("qm_score", 0) < 75)
    weak = sum(1 for r in rows if r.get("qm_score", 0) < 55)

    avg_score = sum(r.get("qm_score", 0) or 0 for r in rows) / total if total else 0

    # Top 20 buys (descending score)
    top_picks = sorted(
        [r for r in rows if r.get("qm_rating") in ("Strong Buy", "Buy")],
        key=lambda r: r.get("qm_score", 0) or 0, reverse=True,
    )[:20]

    # Build HTML
    rows_html = ""
    for i, r in enumerate(rows, 1):
        ticker = r.get("ticker", "")
        display = ticker.replace(".NS", "").replace(".BO", "")
        score = r.get("qm_score", 0) or 0
        rating = r.get("qm_rating", "N/A")
        trend = r.get("trend", "stable")
        tech = r.get("tech_signal", "HOLD")
        fund = r.get("fund_rating", "N/A")
        price = r.get("price")
        history = r.get("history_runs", 0)

        sig = _SIGNAL_COLORS.get(rating, {"bg": "#757575", "text": "#fff"})
        tc = _TREND_ICONS.get(trend, "—")
        sc = r.get("score_change", 0) or 0
        change_str = f"{tc} {sc:+.1f}" if sc != 0 else tc

        rows_html += f"""<tr>
          <td style="text-align:center;font-size:12px;color:#888;">{i}</td>
          <td style="font-weight:600;">{display}</td>
          <td style="text-align:center;"><span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:600;background:{sig['bg']};color:{sig['text']};">{rating}</span></td>
          <td style="text-align:center;font-weight:600;color:{_tier_color(score)};">{score:.0f}</td>
          <td style="text-align:center;font-size:12px;">{change_str}</td>
          <td style="text-align:center;font-size:12px;font-weight:500;color:{'#2e7d32' if tech=='BUY' else '#c62828' if tech=='SELL' else '#f57f17'};">{tech}</td>
          <td style="text-align:center;font-size:12px;">{fund[:12]}</td>
          <td style="text-align:right;font-family:monospace;font-size:12px;">{_fmt_price(price)}</td>
        </tr>"""

    # Top picks rows
    picks_html = ""
    for r in top_picks:
        ticker = r.get("ticker", "")
        display = ticker.replace(".NS", "").replace(".BO", "")
        score = r.get("qm_score", 0) or 0
        trend = r.get("trend", "stable")
        tech = r.get("tech_signal", "HOLD")
        price = r.get("price")
        sc = r.get("score_change", 0) or 0
        tc = _TREND_ICONS.get(trend, "—")

        picks_html += f"""<tr>
          <td style="font-weight:600;">{display}</td>
          <td style="text-align:center;font-weight:600;color:{_tier_color(score)};">{score:.0f}</td>
          <td style="text-align:center;"><span style="display:inline-block;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:600;color:{_TIER_COLORS.get(_tier(score), '#757575')};border:1px solid {_TIER_COLORS.get(_tier(score), '#757575')};">{_tier(score)}</span></td>
          <td style="text-align:center;font-size:12px;">{tc} {sc:+.1f}</td>
          <td style="text-align:center;font-size:12px;font-weight:500;color:{'#2e7d32' if tech=='BUY' else '#c62828' if tech=='SELL' else '#f57f17'};">{tech}</td>
          <td style="text-align:right;font-family:monospace;">{_fmt_price(price)}</td>
        </tr>"""

    donut = _donut_svg(buy, hold, sell, total)
    trend_bar = _trend_svg(improving, deteriorating, stable, total)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NSE Equity Research Report — VijayMaruthi Wealth Management</title>
<style>
  *, *::before, *::after {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #111; color: #e0e0e0; line-height: 1.5; padding: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  .page {{ max-width: 1100px; margin: 0 auto; padding: 40px 48px; }}
  @media print {{
    body {{ background: #fff; color: #222; }}
    .page {{ padding: 20px 32px; }}
    .no-print {{ display: none !important; }}
    @page {{ margin: 15mm 12mm; }}
  }}

  /* Header */
  .header {{ border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 28px; }}
  .header h1 {{ font-size: 26px; font-weight: 700; letter-spacing: -0.3px; color: #f0f0f0; }}
  .header .sub {{ font-size: 13px; color: #999; margin-top: 4px; }}
  @media print {{ .header h1 {{ color: #111; }} }}

  /* Summary cards */
  .cards {{ display: flex; gap: 16px; margin-bottom: 28px; }}
  .card {{ flex:1; border:1px solid #333; border-radius:8px; padding:18px 20px; background:#1a1a1a; }}
  @media print {{ .card {{ background:#f5f5f5; border-color:#ccc; }} }}
  .card .label {{ font-size:10px; text-transform:uppercase; letter-spacing:0.8px; color:#888; font-weight:600; }}
  .card .value {{ font-size:30px; font-weight:700; margin-top:2px; line-height:1.1; }}
  .card .sub {{ font-size:11px; color:#666; margin-top:4px; }}

  /* Section headers */
  .section {{ font-size:16px; font-weight:700; margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid #333; color:#e0e0e0; text-transform:uppercase; letter-spacing:0.5px; }}
  @media print {{ .section {{ color:#333; }} }}

  /* Tables */
  table {{ width:100%; border-collapse:collapse; font-size:13px; margin-bottom:24px; }}
  thead th {{
    text-align:left; padding:8px 10px; font-size:10px; font-weight:600;
    text-transform:uppercase; letter-spacing:0.5px; color:#888;
    border-bottom:2px solid #333; background:#1a1a1a;
  }}
  @media print {{ thead th {{ background:#e8e8e8 !important; color:#444; border-color:#bbb; }} }}
  tbody td {{ padding:7px 10px; border-bottom:1px solid #2a2a2a; vertical-align:middle; }}
  @media print {{ tbody td {{ border-color:#ddd; }} }}
  tbody tr:hover {{ background:#222; }}
  @media print {{ tbody tr:hover {{ background:transparent; }} }}

  .metric-row {{ display:flex; gap:24px; margin-bottom:24px; flex-wrap:wrap; }}
  .metric {{ flex:1; min-width:160px; }}
  .metric .num {{ font-size:22px; font-weight:700; }}
  .metric .lbl {{ font-size:11px; color:#888; }}

  /* Donut + legend side by side */
  .chart-row {{ display:flex; gap:32px; align-items:center; margin-bottom:24px; }}
  .chart-box {{ flex:0 0 auto; text-align:center; }}
  .legend {{ flex:1; }}
  .legend-item {{ display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12px; }}
  .legend-dot {{ width:12px; height:12px; border-radius:50%; flex-shrink:0; }}

  .footer {{ margin-top:32px; padding-top:16px; border-top:1px solid #333; font-size:10px; color:#666; line-height:1.6; }}
  @media print {{ .footer {{ border-color:#ccc; }} }}

  .print-btn {{
    display:inline-block; padding:10px 24px; background:#2e7d32; color:#fff;
    border:none; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer;
    text-decoration:none; margin-bottom:20px;
  }}
  .print-btn:hover {{ background:#1b5e20; }}

  .top-picks {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(300px,1fr)); gap:12px; margin-bottom:24px; }}
  .pick-card {{ border:1px solid #333; border-radius:8px; padding:14px 16px; background:#1a1a1a; }}
  @media print {{ .pick-card {{ background:#fafafa; border-color:#ccc; }} }}
  .pick-card .sym {{ font-size:16px; font-weight:700; }}
  .pick-card .meta {{ font-size:11px; color:#888; margin-top:2px; }}
  .pick-card .row {{ display:flex; justify-content:space-between; margin-top:6px; font-size:12px; }}
</style>
</head>
<body>
<div class="page">

  <!-- ═══ HEADER ═══ -->
  <div class="header">
    <h1>VijayMaruthi Wealth Management</h1>
    <div class="sub">NSE Equity Research Report &mdash; {now}</div>
    <div class="sub" style="margin-top:2px;">Comprehensive quantitative + fundamental analysis of NSE-listed equities</div>
  </div>

  <!-- ═══ EXECUTIVE SUMMARY ═══ -->
  <div class="section">Executive Summary</div>
  <p style="font-size:13px;color:#bbb;margin-bottom:20px;line-height:1.7;">
    This report presents a systematic evaluation of <strong style="color:#f0f0f0;">{total}</strong> NSE-listed equities
    using a blended framework that fuses technical indicators, price action, fundamental metrics,
    and trend momentum. The overall market breadth leans
    <strong style="color:{'#2e7d32' if buy > sell else '#c62828'};">{'constructive' if buy > sell else 'cautious'}</strong>,
    with <strong style="color:#2e7d32;">{buy} Buy</strong>,
    <strong style="color:#f57f17;">{hold} Hold</strong>, and
    <strong style="color:#c62828;">{sell} Sell</strong> ratings.
    The mean composite score across all analyzed stocks is <strong>{avg_score:.1f}</strong>,
    indicating {_tier(avg_score).lower()} overall quality.
    {improving} stocks are showing improving momentum while {deteriorating} are deteriorating.
  </p>

  <!-- ═══ KEY METRICS ═══ -->
  <div class="cards">
    <div class="card">
      <div class="label">Can Buy</div>
      <div class="value" style="color:{_TIER_COLORS['Strong']};">{buy}</div>
      <div class="sub">{strong} Strong, {moderate} Moderate</div>
    </div>
    <div class="card">
      <div class="label">Hold</div>
      <div class="value" style="color:{_TIER_COLORS['Moderate']};">{hold}</div>
      <div class="sub">Neutral / watchlist</div>
    </div>
    <div class="card">
      <div class="label">Avoid / Sell</div>
      <div class="value" style="color:{_TIER_COLORS['Weak']};">{sell}</div>
      <div class="sub">Sell + Strong Sell</div>
    </div>
    <div class="card">
      <div class="label">Total Analysed</div>
      <div class="value" style="color:#e0e0e0;">{total}</div>
      <div class="sub">Mean score: {avg_score:.1f}</div>
    </div>
  </div>

  <!-- ═══ DISTRIBUTION ═══ -->
  <div class="section">Portfolio Distribution</div>
  <div class="chart-row">
    <div class="chart-box">
      {donut}
    </div>
    <div class="legend">
      <div class="legend-item"><span class="legend-dot" style="background:{_TIER_COLORS['Strong']};"></span> Buy &mdash; {buy} stocks ({buy/total*100:.1f}%)</div>
      <div class="legend-item"><span class="legend-dot" style="background:{_TIER_COLORS['Moderate']};"></span> Hold &mdash; {hold} stocks ({hold/total*100:.1f}%)</div>
      <div class="legend-item"><span class="legend-dot" style="background:{_TIER_COLORS['Weak']};"></span> Sell &mdash; {sell} stocks ({sell/total*100:.1f}%)</div>
    </div>
  </div>

  <!-- ═══ TRENDS ═══ -->
  <div class="section">Trend Momentum</div>
  {trend_bar}
  <div class="metric-row">
    <div class="metric"><div class="num" style="color:#2e7d32;">{improving}</div><div class="lbl">Improving ▲</div></div>
    <div class="metric"><div class="num" style="color:#757575;">{stable}</div><div class="lbl">Stable —</div></div>
    <div class="metric"><div class="num" style="color:#c62828;">{deteriorating}</div><div class="lbl">Deteriorating ▼</div></div>
  </div>
  <p style="font-size:12px;color:#666;margin-bottom:24px;">
    Score change quantifies the difference between the current blended score and the trailing average.
    Positive changes indicate improving technical+fundamental conditions relative to recent history.
  </p>

  <!-- ═══ TOP PICKS ═══ -->
  <div class="section">Top Picks — Highest Conviction Buys</div>
  <p style="font-size:12px;color:#888;margin-bottom:10px;">
    The top <strong>{len(top_picks)}</strong> Buy-rated stocks ranked by composite score.
    These represent the highest-conviction opportunities across the NSE universe.
  </p>
  <table>
    <thead>
      <tr>
        <th>Stock</th>
        <th style="text-align:center;">Score</th>
        <th style="text-align:center;">Tier</th>
        <th style="text-align:center;">Trend</th>
        <th style="text-align:center;">Tech</th>
        <th style="text-align:right;">Price</th>
      </tr>
    </thead>
    <tbody>
      {picks_html or '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px;">No Buy-rated stocks at this time.</td></tr>'}
    </tbody>
  </table>

  <!-- ═══ FULL HOLDINGS ═══ -->
  <div class="section">Complete Holdings — All Analysed Stocks</div>
  <p style="font-size:12px;color:#888;margin-bottom:10px;">
    Full inventory of all {total} analysed NSE stocks sorted by rating (Buy → Hold → Sell)
    and descending score within each tier.
  </p>
  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:32px;">#</th>
        <th>Stock</th>
        <th style="text-align:center;">Rating</th>
        <th style="text-align:center;">Score</th>
        <th style="text-align:center;">Trend</th>
        <th style="text-align:center;">Tech</th>
        <th style="text-align:center;">Fund</th>
        <th style="text-align:right;">Price</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}
    </tbody>
  </table>

  <!-- ═══ FOOTER ═══ -->
  <div class="footer">
    <strong>Methodology:</strong> This report uses a blended framework combining technical analysis
    (price action, indicators, market structure, candlestick patterns), fundamental analysis
    (22-section comprehensive review including ratios, margins, growth, and valuation),
    and trend momentum scoring. Scores range from 0–100. &bull;
    <strong>Tier thresholds:</strong> Strong ≥75, Moderate 55–74, Weak &lt;55. &bull;
    <strong>Trend</strong> is calculated as the difference between current and trailing-average score.<br><br>
    <em>Disclaimer:</em> This report is for informational purposes only and does not constitute investment advice.
    Past performance is not indicative of future results. Always conduct your own research and consult a
    SEBI-registered investment advisor before making investment decisions. Data sourced from Yahoo Finance
    (yfinance) and NSE (nsetools). All prices are in Indian Rupees (₹).<br><br>
    Generated by VijayMaruthi Wealth Management v4.0 &mdash; {now}
  </div>

  <!-- ═══ PRINT BUTTON ═══ -->
  <div class="no-print" style="text-align:center;margin-top:24px;">
    <button class="print-btn" onclick="window.print()">🖨️ Download PDF / Print Report</button>
    <p style="font-size:11px;color:#666;margin-top:6px;">
      Click the button above or press <kbd style="background:#333;padding:2px 6px;border-radius:3px;">Ctrl+P</kbd>
      (<kbd style="background:#333;padding:2px 6px;border-radius:3px;">⌘P</kbd> on Mac) and select "Save as PDF".
    </p>
  </div>

</div>
</body>
</html>"""


def _empty_report(now: str) -> str:
    """Return minimal report when no data exists."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<title>NSE Equity Research Report — VijayMaruthi Wealth Management</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #111; color: #e0e0e0;
    display:flex; align-items:center; justify-content:center; min-height:100vh; }}
  .box {{ text-align:center; }}
  h1 {{ font-size:24px; }}
  p {{ color:#888; }}
</style>
</head>
<body><div class="box">
  <h1>VijayMaruthi Wealth Management</h1>
  <p>No stocks have been analysed yet. Run a scan first, then export the report.</p>
  <p style="font-size:12px;color:#666;">{now}</p>
</div></body>
</html>"""
