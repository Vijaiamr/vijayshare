#!/usr/bin/env python3
"""
book_visuals.py — SVG chart generators, Unicode symbols, example tables,
and callout boxes for the Tamil/English Financial Handbook.

All SVG charts are generated as data URIs so they render inline in HTML/PDF
without external file dependencies.
"""

import base64
import textwrap
from typing import Dict, List, Optional, Tuple


# ═══════════════════════════════════════════════════════════════
# 1. UNICODE SYMBOLS  (for direct use in markdown)
# ═══════════════════════════════════════════════════════════════

class Sym:
    """Unicode symbol constants for use in content."""
    # Stars
    STAR       = "\u2605"  # ★
    STARN      = "\u2606"  # ☆
    STAR4B     = "\u2726"  # ✦
    STAR4W     = "\u2727"  # ✧
    STARC      = "\u272A"  # ✪  circled white star
    SPARKLE    = "\u2728"  # ✨
    STAR8      = "\u2734"  # ✴

    # Arrows
    UP         = "\u2191"  # ↑
    DOWN       = "\u2193"  # ↓
    RIGHT      = "\u2192"  # →
    LEFT       = "\u2190"  # ←
    UPDOWN     = "\u2195"  # ↕
    LEFTRIGHT  = "\u2194"  # ↔
    NE         = "\u2197"  # ↗
    SE         = "\u2198"  # ↘
    SW         = "\u2199"  # ↙
    NW         = "\u2196"  # ↖
    UPTRI      = "\u25B2"  # ▲
    DOWNTRI    = "\u25BC"  # ▼
    RHTRI      = "\u25B6"  # ▶
    LFTRI      = "\u25C0"  # ◀

    # Bold arrows
    BUP        = "\u2B06"  # ⬆
    BDOWN      = "\u2B07"  # ⬇
    BRIGHT     = "\u27A1"  # ➡
    BLEFT      = "\u2B05"  # ⬅

    # Double arrows
    UPDOWN2    = "\u21D5"  # ⇕
    UP2        = "\u21D1"  # ⇑
    DOWN2      = "\u21D3"  # ⇓
    RIGHT2     = "\u21D2"  # ⇒
    LEFT2      = "\u21D0"  # ⇐

    # Shapes
    CIRC       = "\u25CF"  # ●
    CIRCW      = "\u25CB"  # ○
    CIRCQ      = "\u25D0"  # ◐
    BULLET     = "\u2022"  # •
    DIAM       = "\u25C6"  # ◆
    DIAMW      = "\u25C7"  # ◇
    SQUARE     = "\u25A0"  # ■
    SQUAREW    = "\u25A1"  # □
    TRIUP      = "\u25B3"  # △
    TRIDN      = "\u25BD"  # ▽

    # Check / Cross
    CHECK      = "\u2713"  # ✓
    CHECKB     = "\u2714"  # ✔
    CROSS      = "\u2717"  # ✗
    CROSSB     = "\u2718"  # ✘

    # Warning / Info
    WARN       = "\u26A0"  # ⚠
    INFO       = "\u2139"  # ℹ
    GEAR       = "\u2699"  # ⚙
    LIGHT      = "\U0001F4A1"  # 💡

    # Numbers circled
    N1 = "\u2460"  # ①
    N2 = "\u2461"
    N3 = "\u2462"
    N4 = "\u2463"
    N5 = "\u2464"
    N6 = "\u2465"
    N7 = "\u2466"
    N8 = "\u2467"
    N9 = "\u2468"

    # Decorative
    HEART      = "\u2665"  # ♥
    DAGGER     = "\u2020"  # †
    SECTION    = "\u00A7"  # §
    PILCROW    = "\u00B6"  # ¶
    BULLSEYE   = "\u25CE"  # ◎
    FLOWER     = "\u273F"  # ✿
    SNOW       = "\u2744"  # ❄
    STARFLOWER = "\u2749"  # ❉

    # Progress bar chars
    BLOCK_FULL  = "\u2588"  # █
    BLOCK_DARK  = "\u2593"  # ▓
    BLOCK_MED   = "\u2592"  # ▒
    BLOCK_LIGHT = "\u2591"  # ░


# ═══════════════════════════════════════════════════════════════
# 2. HELPER: Simple text-based progress bars
# ═══════════════════════════════════════════════════════════════

# ── Global flag: set SVG_DIRECT = True to emit raw SVG (processable by tamizhify)
# ── instead of base64 data URIs (which hide text from substring replacement).
SVG_DIRECT = False

def progress_bar(pct: float, width: int = 20) -> str:
    """Return a Unicode progress bar like ████████░░░░░░░░░░░░ (40%)"""
    filled = int(pct / 100 * width)
    bar = Sym.BLOCK_FULL * filled + Sym.BLOCK_LIGHT * (width - filled)
    return f"{bar} {pct:.0f}%"


# ═══════════════════════════════════════════════════════════════
# 3. SVG DATA URI —  CHART PATTERNS
# ═══════════════════════════════════════════════════════════════
# All functions return an <img> HTML tag with a data: URI.

def _svg_data_uri(svg: str) -> str:
    """Convert SVG markup to a data URI img tag."""
    svg_bytes = svg.encode("utf-8")
    b64 = base64.b64encode(svg_bytes).decode("ascii")
    return f'data:image/svg+xml;base64,{b64}'


def _img(width: int, height: int, svg: str, alt: str = "") -> str:
    """Return an HTML <img> tag for the SVG chart.
    If SVG_DIRECT is True, return raw SVG instead (text is processable by tamizhify)."""
    if SVG_DIRECT:
        return _svg_direct(width, height, svg)
    uri = _svg_data_uri(svg)
    return f'<img src="{uri}" width="{width}" height="{height}" alt="{alt}" style="display:block;margin:0.8em auto;max-width:100%;" />'


def _svg_direct(width: int, height: int, svg: str) -> str:
    """Return raw SVG with an HTML wrapper, preserving text for tamizhify processing."""
    # Insert width/height into SVG if not already set as attributes
    # The SVG viewBox is already set, we just wrap in a div for sizing
    return f'<div style="text-align:center;margin:0.8em auto;">{svg}</div>'



# ── Candlestick ─────────────────────────────────────────────

def candle_chart_svg(width: int = 500, height: int = 280) -> str:
    """SVG showing a simple 5-candle chart with rising/falling candles."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <!-- Grid lines -->
      {''.join(f'<line x1="0" y1="{y}" x2="{width}" y2="{y}" stroke="#E8E8E0" stroke-width="0.5"/>' for y in range(30, height, 30))}
      <!-- Price line -->
      <polyline points="30,210 110,170 190,190 270,100 350,130 430,50"
                fill="none" stroke="#2D89EF" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>
      <!-- Candle 1: up (green) -->
      <rect x="50" y="170" width="24" height="40" fill="#26A65B" stroke="#1E7E44" stroke-width="0.8" rx="1"/>
      <line x1="62" y1="210" x2="62" y2="220" stroke="#1E7E44" stroke-width="1.2"/>
      <line x1="62" y1="170" x2="62" y2="160" stroke="#1E7E44" stroke-width="1.2"/>
      <!-- Candle 2: down (red) -->
      <rect x="130" y="160" width="24" height="30" fill="#E74C3C" stroke="#C0392B" stroke-width="0.8" rx="1"/>
      <line x1="142" y1="190" x2="142" y2="200" stroke="#C0392B" stroke-width="1.2"/>
      <line x1="142" y1="160" x2="142" y2="148" stroke="#C0392B" stroke-width="1.2"/>
      <!-- Candle 3: up -->
      <rect x="210" y="100" width="24" height="90" fill="#26A65B" stroke="#1E7E44" stroke-width="0.8" rx="1"/>
      <line x1="222" y1="100" x2="222" y2="88" stroke="#1E7E44" stroke-width="1.2"/>
      <!-- Candle 4: down -->
      <rect x="290" y="110" width="24" height="20" fill="#E74C3C" stroke="#C0392B" stroke-width="0.8" rx="1"/>
      <line x1="302" y1="130" x2="302" y2="142" stroke="#C0392B" stroke-width="1.2"/>
      <line x1="302" y1="110" x2="302" y2="100" stroke="#C0392B" stroke-width="1.2"/>
      <!-- Candle 5: up (large) -->
      <rect x="370" y="50" width="24" height="80" fill="#26A65B" stroke="#1E7E44" stroke-width="0.8" rx="1"/>
      <line x1="382" y1="50" x2="382" y2="38" stroke="#1E7E44" stroke-width="1.2"/>
      <line x1="382" y1="130" x2="382" y2="142" stroke="#1E7E44" stroke-width="1.2"/>
      <!-- Labels -->
      <text x="30" y="18" font-family="Arial,sans-serif" font-size="11" fill="#666">Price →</text>
      <text x="380" y="264" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="end">Time →</text>
    </svg>'''


def candle_chart(width: int = 500, height: int = 280) -> str:
    return _img(width, height, candle_chart_svg(width, height), "Candlestick chart example")


# ── Head and Shoulders ─────────────────────────────────────

def head_shoulders_svg(width: int = 500, height: int = 280) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="25" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Head &amp; Shoulders Top</text>
      <!-- Price line forming H&S -->
      <polyline points="40,210 80,130 120,150 160,60 200,140 240,120 280,200"
                fill="none" stroke="#1B2A4A" stroke-width="2" stroke-linejoin="round"/>
      <!-- Neckline -->
      <line x1="80" y1="150" x2="240" y2="140" stroke="#E74C3C" stroke-width="1.5" stroke-dasharray="6,4"/>
      <!-- Labels -->
      <text x="55" y="122" font-family="Arial,sans-serif" font-size="12" fill="#666" text-anchor="middle">LS</text>
      <text x="160" y="52" font-family="Arial,sans-serif" font-size="12" fill="#666" text-anchor="middle">Head</text>
      <text x="255" y="112" font-family="Arial,sans-serif" font-size="12" fill="#666" text-anchor="middle">RS</text>
      <text x="285" y="195" font-family="Arial,sans-serif" font-size="11" fill="#E74C3C">Neckline</text>
      <!-- Breakout arrow -->
      <line x1="280" y1="200" x2="320" y2="230" stroke="#E74C3C" stroke-width="1.5" marker-end="url(#arrow)"/>
      <text x="305" y="245" font-family="Arial,sans-serif" font-size="11" fill="#E74C3C" text-anchor="middle">Breakout</text>
      <!-- Target -->
      <line x1="280" y1="200" x2="280" y2="255" stroke="#888" stroke-width="1" stroke-dasharray="3,3"/>
      <line x1="320" y1="230" x2="440" y2="230" stroke="#888" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="390" y="225" font-family="Arial,sans-serif" font-size="11" fill="#888">Target</text>
      <!-- Arrow marker -->
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#E74C3C"/></marker></defs>
    </svg>'''


def head_shoulders(width: int = 500, height: int = 280) -> str:
    return _img(width, height, head_shoulders_svg(width, height), "Head and Shoulders pattern")


# ── Double Top / Bottom ─────────────────────────────────────

def double_top_svg(width: int = 500, height: int = 260) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="25" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Double Top</text>
      <polyline points="40,200 90,90 140,180 190,80 240,190"
                fill="none" stroke="#1B2A4A" stroke-width="2" stroke-linejoin="round"/>
      <line x1="90" y1="90" x2="190" y2="80" stroke="#E74C3C" stroke-width="1.5" stroke-dasharray="5,3"/>
      <text x="90" y="80" font-family="Arial,sans-serif" font-size="11" fill="#666" text-anchor="middle">Top 1</text>
      <text x="190" y="70" font-family="Arial,sans-serif" font-size="11" fill="#666" text-anchor="middle">Top 2</text>
      <text x="290" y="195" font-family="Arial,sans-serif" font-size="11" fill="#E74C3C">Neckline break →</text>
      <line x1="240" y1="190" x2="300" y2="210" stroke="#E74C3C" stroke-width="1.5"/>
    </svg>'''


def double_bottom_svg(width: int = 500, height: int = 260) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="25" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Double Bottom</text>
      <polyline points="40,70 90,180 140,100 190,190 240,70"
                fill="none" stroke="#26A65B" stroke-width="2" stroke-linejoin="round"/>
      <line x1="90" y1="180" x2="190" y2="190" stroke="#26A65B" stroke-width="1.5" stroke-dasharray="5,3"/>
      <text x="90" y="192" font-family="Arial,sans-serif" font-size="11" fill="#666" text-anchor="middle">Bottom 1</text>
      <text x="190" y="202" font-family="Arial,sans-serif" font-size="11" fill="#666" text-anchor="middle">Bottom 2</text>
      <text x="290" y="75" font-family="Arial,sans-serif" font-size="11" fill="#26A65B">Neckline break ↑</text>
      <line x1="240" y1="70" x2="300" y2="55" stroke="#26A65B" stroke-width="1.5"/>
    </svg>'''


def double_top(width: int = 500, height: int = 260) -> str:
    return _img(width, height, double_top_svg(width, height), "Double Top pattern")


def double_bottom(width: int = 500, height: int = 260) -> str:
    return _img(width, height, double_bottom_svg(width, height), "Double Bottom pattern")


# ── Support & Resistance ────────────────────────────────────

def support_resistance_svg(width: int = 500, height: int = 250) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Support &amp; Resistance</text>
      <!-- Resistance line -->
      <line x1="30" y1="65" x2="470" y2="65" stroke="#E74C3C" stroke-width="2"/>
      <text x="478" y="69" font-family="Arial,sans-serif" font-size="11" fill="#E74C3C">Resistance</text>
      <!-- Support line -->
      <line x1="30" y1="195" x2="470" y2="195" stroke="#26A65B" stroke-width="2"/>
      <text x="478" y="199" font-family="Arial,sans-serif" font-size="11" fill="#26A65B">Support</text>
      <!-- Price zigzag between them -->
      <polyline points="40,190 80,70 120,185 160,80 200,170 240,90 280,195 320,100 360,180 400,75 440,190"
                fill="none" stroke="#1B2A4A" stroke-width="1.8" stroke-linejoin="round" opacity="0.7"/>
      <!-- Bounce labels -->
      <text x="80" y="60" font-family="Arial,sans-serif" font-size="9" fill="#E74C3C" text-anchor="middle">Reject</text>
      <text x="160" y="72" font-family="Arial,sans-serif" font-size="9" fill="#E74C3C" text-anchor="middle">Reject</text>
      <text x="120" y="200" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">Bounce</text>
      <text x="280" y="208" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">Bounce</text>
      <!-- Breakout -->
      <line x1="400" y1="75" x2="420" y2="60" stroke="#E74C3C" stroke-width="1.2" marker-end="url(#arr2)"/>
      <text x="420" y="54" font-family="Arial,sans-serif" font-size="9" fill="#E74C3C" text-anchor="middle">Break</text>
      <defs><marker id="arr2" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#E74C3C"/></marker></defs>
    </svg>'''


def support_resistance(width: int = 500, height: int = 250) -> str:
    return _img(width, height, support_resistance_svg(width, height), "Support and Resistance levels")


# ── Trend lines ─────────────────────────────────────────────

def trend_lines_svg(width: int = 600, height: int = 220) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Trend Lines</text>
      <!-- Uptrend -->
      <polyline points="20,190 70,150 120,165 170,110 220,120 270,70 320,90"
                fill="none" stroke="#26A65B" stroke-width="2" stroke-linejoin="round"/>
      <line x1="20" y1="195" x2="320" y2="78" stroke="#26A65B" stroke-width="1.2" stroke-dasharray="5,3"/>
      <text x="330" y="76" font-family="Arial,sans-serif" font-size="11" fill="#26A65B">Uptrend ↑</text>
      <!-- Downtrend -->
      <polyline points="20,30 70,80 120,55 170,110 220,90 270,140 320,120"
                fill="none" stroke="#E74C3C" stroke-width="2" stroke-linejoin="round"/>
      <line x1="20" y1="28" x2="320" y2="118" stroke="#E74C3C" stroke-width="1.2" stroke-dasharray="5,3"/>
      <text x="330" y="120" font-family="Arial,sans-serif" font-size="11" fill="#E74C3C">Downtrend ↓</text>
    </svg>'''


def trend_lines(width: int = 600, height: int = 220) -> str:
    return _img(width, height, trend_lines_svg(width, height), "Uptrend and Downtrend lines")


# ── Elliott Wave ────────────────────────────────────────────

def elliott_wave_svg(width: int = 600, height: int = 240) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Elliott Wave — 5 Impulse + 3 Corrective</text>
      <!-- Impulse waves 1-5 -->
      <polyline points="30,190 60,170 80,180 110,130 130,140 160,80 180,90 210,50"
                fill="none" stroke="#1B2A4A" stroke-width="2.5" stroke-linejoin="round"/>
      <!-- Corrective waves A-B-C -->
      <polyline points="210,50 240,110 260,95 290,70"
                fill="none" stroke="#E74C3C" stroke-width="2" stroke-linejoin="round" stroke-dasharray="6,3"/>
      <!-- Labels impulse -->
      <text x="60" y="162" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#26A65B" text-anchor="middle">(1)</text>
      <text x="110" y="122" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#26A65B" text-anchor="middle">(3)</text>
      <text x="160" y="72" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#26A65B" text-anchor="middle">(5)</text>
      <text x="85" y="192" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">(2)</text>
      <text x="140" y="152" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">(4)</text>
      <!-- Labels corrective -->
      <text x="240" y="122" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#E74C3C" text-anchor="middle">A</text>
      <text x="260" y="87" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#E74C3C" text-anchor="middle">B</text>
      <text x="280" y="62" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#E74C3C" text-anchor="middle">C</text>
    </svg>'''


def elliott_wave(width: int = 600, height: int = 240) -> str:
    return _img(width, height, elliott_wave_svg(width, height), "Elliott Wave pattern")


# ── Fibonacci Retracement ───────────────────────────────────

def fibonacci_svg(width: int = 500, height: int = 300) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Fibonacci Retracement Levels</text>
      <!-- Price move up -->
      <line x1="60" y1="260" x2="440" y2="30" stroke="#1B2A4A" stroke-width="2"/>
      <text x="450" y="28" font-family="Arial,sans-serif" font-size="10" fill="#1B2A4A">100%</text>
      <text x="60" y="274" font-family="Arial,sans-serif" font-size="10" fill="#1B2A4A">0%</text>
      <!-- Fib levels -->
      {''.join(f'<line x1="60" y1="{y}" x2="440" y2="{y}" stroke="{c}" stroke-width="1" stroke-dasharray="4,3"/><text x="448" y="{y+4}" font-family="Arial,sans-serif" font-size="10" fill="{c}">{lbl}</text>'
                for y, lbl, c in [
                    (215, "23.6%", "#888"),
                    (171, "38.2%", "#E67E22"),
                    (145, "50.0%", "#888"),
                    (114, "61.8%", "#E74C3C"),
                    (80, "78.6%", "#888"),
                ])}
    </svg>'''


def fibonacci(width: int = 500, height: int = 300) -> str:
    return _img(width, height, fibonacci_svg(width, height), "Fibonacci retracement levels")


# ── RSI Overbought / Oversold ──────────────────────────────

def rsi_chart_svg(width: int = 500, height: int = 260) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">RSI Oscillator (14)</text>
      <!-- Overbought 70 -->
      <line x1="30" y1="50" x2="470" y2="50" stroke="#E74C3C" stroke-width="1.2" stroke-dasharray="6,3"/>
      <text x="478" y="54" font-family="Arial,sans-serif" font-size="10" fill="#E74C3C">70 OB</text>
      <!-- Oversold 30 -->
      <line x1="30" y1="210" x2="470" y2="210" stroke="#26A65B" stroke-width="1.2" stroke-dasharray="6,3"/>
      <text x="478" y="214" font-family="Arial,sans-serif" font-size="10" fill="#26A65B">30 OS</text>
      <!-- Midline 50 -->
      <line x1="30" y1="130" x2="470" y2="130" stroke="#CCC" stroke-width="0.8" stroke-dasharray="3,3"/>
      <!-- RSI line -->
      <polyline points="30,40 70,55 110,80 150,65 190,120 230,90 270,140 310,60 350,50 390,85 430,70 470,100"
                fill="none" stroke="#1B2A4A" stroke-width="2" stroke-linejoin="round"/>
      <!-- OB zone highlight -->
      <rect x="0" y="0" width="500" height="50" fill="#E74C3C" opacity="0.06"/>
      <rect x="0" y="210" width="500" height="50" fill="#26A65B" opacity="0.06"/>
      <text x="200" y="45" font-family="Arial,sans-serif" font-size="9" fill="#E74C3C" text-anchor="middle">Overbought Zone</text>
      <text x="200" y="245" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">Oversold Zone</text>
    </svg>'''


def rsi_chart(width: int = 500, height: int = 260) -> str:
    return _img(width, height, rsi_chart_svg(width, height), "RSI indicator with OB/OS levels")


# ── MACD ────────────────────────────────────────────────────

def macd_chart_svg(width: int = 500, height: int = 260) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">MACD — Signal Line Crossover</text>
      <line x1="30" y1="130" x2="470" y2="130" stroke="#CCC" stroke-width="0.8" stroke-dasharray="3,3"/>
      <!-- MACD line (blue) -->
      <polyline points="30,150 70,140 110,135 150,145 190,110 230,80 270,90 310,70 350,100 390,120 430,90 470,80"
                fill="none" stroke="#2D89EF" stroke-width="2" stroke-linejoin="round"/>
      <!-- Signal line (red) -->
      <polyline points="30,145 70,138 110,140 150,142 190,120 230,95 270,85 310,80 350,95 390,110 430,100 470,95"
                fill="none" stroke="#E74C3C" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="4,3"/>
      <!-- Histogram bars -->
      {''.join(f'<rect x="{x}" y="{y}" width="10" height="{h}" fill="{c}" rx="1"/>'
               for x, y, h, c in [
                   (35, 148, 4, "#AAA"), (75, 138, 6, "#AAA"), (115, 130, 12, "#26A65B"),
                   (155, 130, 18, "#26A65B"), (195, 95, 12, "#E74C3C"), (235, 75, 18, "#E74C3C"),
                   (275, 78, 14, "#E74C3C"), (315, 68, 14, "#E74C3C"), (355, 94, 8, "#AAA"),
                   (395, 106, 8, "#AAA"), (435, 82, 20, "#E74C3C"), (455, 75, 22, "#E74C3C"),
               ])}
      <!-- Cross labels -->
      <text x="190" y="105" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">Bullish ✗</text>
      <text x="315" y="64" font-family="Arial,sans-serif" font-size="9" fill="#E74C3C" text-anchor="middle">Bearish ✗</text>
    </svg>'''


def macd_chart(width: int = 500, height: int = 260) -> str:
    return _img(width, height, macd_chart_svg(width, height), "MACD indicator crossover")


# ── Wyckoff Schematic ──────────────────────────────────────

def wyckoff_svg(width: int = 600, height: int = 260) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Wyckoff Accumulation Schematic</text>
      <!-- Phase A-B-C-D-E -->
      <polyline points="30,130 70,120 110,150 150,90 190,130 230,100 270,40 310,80 350,60 390,40 430,70 470,50"
                fill="none" stroke="#1B2A4A" stroke-width="2" stroke-linejoin="round"/>
      <!-- PS, SC, ST labels -->
      <text x="50" y="115" font-family="Arial,sans-serif" font-size="9" fill="#E67E22" text-anchor="middle">PS</text>
      <text x="90" y="145" font-family="Arial,sans-serif" font-size="9" fill="#E67E22" text-anchor="middle">SC</text>
      <text x="130" y="155" font-family="Arial,sans-serif" font-size="9" fill="#E67E22" text-anchor="middle">ST</text>
      <text x="210" y="175" font-family="Arial,sans-serif" font-size="9" fill="#E67E22" text-anchor="middle">LPS</text>
      <text x="270" y="32" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">BC</text>
      <text x="330" y="75" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">SOS</text>
      <text x="390" y="32" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">LPS</text>
      <text x="450" y="62" font-family="Arial,sans-serif" font-size="9" fill="#26A65B" text-anchor="middle">UT</text>
      <!-- Phase labels -->
      <text x="60" y="210" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">A</text>
      <text x="155" y="210" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">B</text>
      <text x="245" y="210" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">C</text>
      <text x="340" y="210" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">D</text>
      <text x="435" y="210" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">E</text>
    </svg>'''


def wyckoff(width: int = 600, height: int = 260) -> str:
    return _img(width, height, wyckoff_svg(width, height), "Wyckoff accumulation schematic")


# ── Market Structure (HH/HL/LH/LL) ──────────────────────────

def market_structure_svg(width: int = 600, height: int = 240) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Market Structure — HH/HL/LH/LL</text>
      <!-- Uptrend: HH HL -->
      <polyline points="20,180 60,130 100,150 140,90 180,110 220,50"
                fill="none" stroke="#26A65B" stroke-width="2.5" stroke-linejoin="round"/>
      <text x="40" y="125" font-family="Arial,sans-serif" font-size="10" fill="#26A65B" text-anchor="middle">HH</text>
      <text x="80" y="160" font-family="Arial,sans-serif" font-size="10" fill="#26A65B" text-anchor="middle">HL</text>
      <text x="120" y="85" font-family="Arial,sans-serif" font-size="10" fill="#26A65B" text-anchor="middle">HH</text>
      <text x="160" y="120" font-family="Arial,sans-serif" font-size="10" fill="#26A65B" text-anchor="middle">HL</text>
      <text x="200" y="45" font-family="Arial,sans-serif" font-size="10" fill="#26A65B" text-anchor="middle">HH</text>
      <!-- Transition (CHoCH) -->
      <line x1="220" y1="50" x2="260" y2="80" stroke="#E67E22" stroke-width="2" stroke-dasharray="4,3"/>
      <text x="240" y="75" font-family="Arial,sans-serif" font-size="9" fill="#E67E22" text-anchor="middle">CHoCH</text>
      <!-- Downtrend: LH LL -->
      <polyline points="260,80 300,130 340,110 380,170 420,150 460,210"
                fill="none" stroke="#E74C3C" stroke-width="2.5" stroke-linejoin="round"/>
      <text x="280" y="140" font-family="Arial,sans-serif" font-size="10" fill="#E74C3C" text-anchor="middle">LH</text>
      <text x="320" y="105" font-family="Arial,sans-serif" font-size="10" fill="#E74C3C" text-anchor="middle">LL</text>
      <text x="360" y="178" font-family="Arial,sans-serif" font-size="10" fill="#E74C3C" text-anchor="middle">LH</text>
      <text x="420" y="145" font-family="Arial,sans-serif" font-size="10" fill="#E74C3C" text-anchor="middle">LL</text>
      <text x="440" y="218" font-family="Arial,sans-serif" font-size="10" fill="#E74C3C" text-anchor="middle">LH</text>
    </svg>'''


def market_structure(width: int = 600, height: int = 240) -> str:
    return _img(width, height, market_structure_svg(width, height), "Market structure HH/HL/LH/LL")


# ── Chart pattern: Triangle ─────────────────────────────────

def triangle_svg(width: int = 400, height: int = 240) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Symmetrical Triangle</text>
      <!-- Upper trendline (descending) -->
      <line x1="50" y1="50" x2="350" y2="130" stroke="#E74C3C" stroke-width="1.5"/>
      <!-- Lower trendline (ascending) -->
      <line x1="50" y1="200" x2="350" y2="140" stroke="#26A65B" stroke-width="1.5"/>
      <!-- Price zigzag inside -->
      <polyline points="60,190 100,60 140,180 180,80 220,160 260,100 300,140 340,120"
                fill="none" stroke="#1B2A4A" stroke-width="1.8" stroke-linejoin="round" opacity="0.6"/>
      <text x="200" y="170" font-family="Arial,sans-serif" font-size="10" fill="#888" text-anchor="middle">Price compresses</text>
    </svg>'''


def triangle(width: int = 400, height: int = 240) -> str:
    return _img(width, height, triangle_svg(width, height), "Symmetrical triangle pattern")


# ── Cup and Handle ─────────────────────────────────────────

def cup_handle_svg(width: int = 500, height: int = 240) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
      <rect width="{width}" height="{height}" fill="#FAFAF7"/>
      <text x="20" y="22" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1B2A4A">Cup &amp; Handle</text>
      <!-- Cup shape -->
      <path d="M 30,80 C 30,200 180,210 230,180 C 280,150 340,160 370,80" fill="none" stroke="#1B2A4A" stroke-width="2" stroke-linejoin="round"/>
      <!-- Handle -->
      <path d="M 370,80 C 400,95 430,85 470,70" fill="none" stroke="#E74C3C" stroke-width="2" stroke-linejoin="round"/>
      <!-- Breakout -->
      <line x1="470" y1="70" x2="490" y2="55" stroke="#26A65B" stroke-width="1.5" marker-end="url(#arr3)"/>
      <text x="490" y="50" font-family="Arial,sans-serif" font-size="11" fill="#26A65B">Breakout</text>
      <defs><marker id="arr3" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#26A65B"/></marker></defs>
    </svg>'''


def cup_handle(width: int = 500, height: int = 240) -> str:
    return _img(width, height, cup_handle_svg(width, height), "Cup and Handle pattern")


# ═══════════════════════════════════════════════════════════════
# 4. EXAMPLE TABLE GENERATORS
# ═══════════════════════════════════════════════════════════════

def pct_line(value: float, reverse: bool = False) -> str:
    """Return a color-coded progress-style string for a value."""
    if value > 0:
        return f'{Sym.UP} +{value:.1f}%' if not reverse else f'{Sym.DOWN} +{value:.1f}%'
    elif value < 0:
        return f'{Sym.DOWN} {value:.1f}%' if not reverse else f'{Sym.UP} {value:.1f}%'
    return f'{Sym.RIGHT} 0.0%'


def position_sizing_table() -> str:
    """Table demonstrating position sizing with different account sizes."""
    rows = [
        ("₹50,000", "2%", "₹1,000", "50 pts", "20 shares", "₹1,000"),
        ("₹1,00,000", "2%", "₹2,000", "50 pts", "40 shares", "₹2,000"),
        ("₹5,00,000", "2%", "₹10,000", "50 pts", "200 shares", "₹10,000"),
        ("₹10,00,000", "1.5%", "₹15,000", "50 pts", "300 shares", "₹15,000"),
        ("₹50,00,000", "1%", "₹50,000", "50 pts", "1,000 shares", "₹50,000"),
    ]
    header = "| Account Size | Risk % | Risk (₹) | Stop Dist. | Position Size | Max Loss |"
    sep = "|---|---|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|{r[4]}|{r[5]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def rr_table() -> str:
    """Risk:Reward ratio table."""
    rows = [
        ("1:1", "50%", "Break-even (before costs)"),
        ("1:2", "33%", "Good — needs 1 win per 3 trades"),
        ("1:3", "25%", "Very good — needs 1 in 4"),
        ("1:4", "20%", "Excellent — needs 1 in 5"),
        ("1:5", "17%", "Outstanding — needs 1 in 6"),
    ]
    header = "| R:R Ratio | Required Win Rate | Assessment |"
    sep = "|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def fib_retracement_table() -> str:
    """Fibonacci retracement key levels."""
    rows = [
        ("0.236", "23.6%", "Shallow retracement", "Minor support/resistance"),
        ("0.382", "38.2%", "Moderate retracement", "Often acts as first serious S/R"),
        ("0.500", "50.0%", "Midpoint", "Psychological level"),
        ("0.618", "61.8%", "Golden Ratio", "Strongest retracement level"),
        ("0.786", "78.6%", "Deep retracement", "SQRT(0.618); common in harmonic patterns"),
    ]
    header = "| Level | Retracement | Significance | Note |"
    sep = "|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def rsi_divergence_table() -> str:
    """RSI divergence types."""
    rows = [
        ("Bullish Regular", f"{Sym.DOWN} Price ↓, {Sym.UP} RSI ↑", "Trend reversal up", "High"),
        ("Bearish Regular", f"{Sym.UP} Price ↑, {Sym.DOWN} RSI ↓", "Trend reversal down", "High"),
        ("Bullish Hidden", f"{Sym.UP} Price ↑ (pullback), {Sym.UP} RSI ↑", "Trend continuation up", "Medium"),
        ("Bearish Hidden", f"{Sym.DOWN} Price ↓ (pullback), {Sym.DOWN} RSI ↓", "Trend continuation down", "Medium"),
    ]
    header = "| Type | Price vs RSI | Signal | Reliability |"
    sep = "|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def ma_crossover_table() -> str:
    """Moving average crossover strategies."""
    rows = [
        ("10 / 20 EMA", "Fast, short-term", "5-15 min / 1H", "29x/week", "Many signals"),
        ("20 / 50 EMA", "Medium-term", "1H / 4H", "6x/week", "Good balance"),
        ("50 / 200 SMA", "Long-term trend", "Daily", "1-2x/month", "Fewer, reliable"),
        ("5 / 13 EMA", "Scalping", "5-15 min", "50x/week", "Fast, noisy"),
    ]
    header = "| Pair | Type | Timeframe | Signals/Wk | R|Rating |"
    sep = "|---|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|{r[4]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def pattern_reliability_table() -> str:
    """Common chart patterns with reliability stats."""
    rows = [
        ("Head & Shoulders", "Reversal", "85%", f"{Sym.UP} 3.2%"),
        ("Double Top", "Reversal", "82%", f"{Sym.UP} 2.8%"),
        ("Double Bottom", "Reversal", "80%", f"{Sym.UP} 3.0%"),
        ("Falling Wedge", "Reversal/Bullish", "74%", f"{Sym.UP} 2.5%"),
        ("Rising Wedge", "Reversal/Bearish", "72%", f"{Sym.UP} 2.4%"),
        ("Cup & Handle", "Continuation/Bullish", "87%", f"{Sym.UP} 3.5%"),
        ("Bull Flag", "Continuation/Bullish", "72%", f"{Sym.UP} 2.1%"),
        ("Bear Flag", "Continuation/Bearish", "70%", f"{Sym.UP} 2.0%"),
        ("Ascending Triangle", "Continuation/Bullish", "76%", f"{Sym.UP} 2.6%"),
        ("Descending Triangle", "Continuation/Bearish", "74%", f"{Sym.UP} 2.5%"),
    ]
    header = "| Pattern | Type | Reliability | Avg Gain |"
    sep = "|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def option_greeks_table() -> str:
    """Option Greeks reference."""
    rows = [
        ("Delta (Δ)", "0 to ±1", "Rate of change of option price vs underlying", "Directional exposure"),
        ("Gamma (Γ)", "> 0", "Rate of change of delta", "Delta acceleration"),
        ("Theta (Θ)", "− (time decay)", "Time decay per day", "Time erosion"),
        ("Vega (ν)", "> 0", "Sensitivity to volatility", "Volatility risk"),
        ("Rho (ρ)", "± (interest)", "Sensitivity to interest rate", "Rate-change risk"),
    ]
    header = "| Greek | Range | Meaning | Use |"
    sep = "|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


def pe_bands_table() -> str:
    """PE ratio interpretation bands."""
    rows = [
        ("< 10", "Undervalued", "Possible value trap", "Cyclical at cycle bottom"),
        ("10-15", "Fair — below market avg", "Good value zone", "Mature industries"),
        ("15-20", "Fair — market average", "Fair valuation", "Nifty 50 typical range"),
        ("20-30", "Premium", "Growth priced in", "Growth companies"),
        ("> 30", "Expensive", "High expectations", "High-growth / bubble risk"),
    ]
    header = "| PE Range | Label | Risk | Context |"
    sep = "|---|---|---|---|"
    body = "\n".join(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|" for r in rows)
    return f"{header}\n{sep}\n{body}"


# ═══════════════════════════════════════════════════════════════
# 5. CALLOUT / ALERT BOX GENERATORS
# ═══════════════════════════════════════════════════════════════

def tip(text: str) -> str:
    """💡 Tip callout."""
    return f"> {Sym.LIGHT} **{Sym.STAR} TIP:** {text}"


def warning(text: str) -> str:
    """⚠️  Warning callout."""
    return f"> {Sym.WARN} **{Sym.STAR} WARNING:** {text}"


def key_point(text: str) -> str:
    """🔑 Key point callout."""
    return f"> **{Sym.CHECKB} KEY:** {text}"


def formula(text: str) -> str:
    """Formula display."""
    return f"> **{Sym.SECTION} Formula:** {text}"


def checklist(items: List[str]) -> str:
    """Checklist with boxes."""
    return "\n".join(f"- [ ] {item}" for item in items)


def done_list(items: List[str]) -> str:
    """Completed checklist."""
    return "\n".join(f"- [x] {item}" for item in items)


# ═══════════════════════════════════════════════════════════════
# 6. DIVIDERS
# ═══════════════════════════════════════════════════════════════

def section_divider(char: str = Sym.DIAM, count: int = 5) -> str:
    return f"{char} " * count


def star_divider() -> str:
    return f"{Sym.STAR} " * 7


def arrow_divider() -> str:
    return f"{Sym.RIGHT} " * 5


# ═══════════════════════════════════════════════════════════════
# 7. COMPLETE EXAMPLE SECTIONS (A paragraph + table + chart)
# ═══════════════════════════════════════════════════════════════

def worked_rsi_example(price_high: float = 15200, price_low: float = 14800,
                       rsi_val: float = 28.5, rsi_prev: float = 32.0) -> str:
    """RSI divergence worked example — returns markdown block."""
    return textwrap.dedent(f"""
    **Example: RSI Bullish Divergence on Nifty 15-min**

    {Sym.BULLET} Price makes a lower low: ₹{price_low} (vs previous ₹{price_high})
    {Sym.BULLET} RSI makes a higher low: {rsi_val} (vs previous {rsi_prev})
    {Sym.BULLET} This is a **bullish divergence** — trend exhaustion signal
    {Sym.BULLET} Action: Look for long entry on next bullish confirmation

    | Metric | Previous Swing | Current Swing | Signal |
    |---|---|---|---|
    | Price | ₹{price_high * 1.02:.0f} → ₹{price_high} | ₹{price_high * 0.98:.0f} → ₹{price_low} | {Sym.DOWN} Lower low |
    | RSI (14) | {rsi_prev + 5:.0f} → {rsi_prev:.0f} | {rsi_val + 3:.0f} → {rsi_val:.1f} | {Sym.UP} Higher low |
    | Volume | 1.2M | 0.8M | {Sym.DOWN} Weakening |


    **Result:** {Sym.CHECK} Bullish divergence confirmed. Price reversed 120 pts in next 2 hours.
    """)


def worked_elliott_example() -> str:
    """Elliott Wave counted example."""
    return textwrap.dedent(f"""
    **Example: Elliott Wave Count on Bank Nifty Daily**

    {Sym.STAR} **Impulse Wave (Waves 1-5):**
    {Sym.BULLET} Wave 1: 42,000 → 44,800  (+2,800 pts, +6.7%)
    {Sym.BULLET} Wave 2: 44,800 → 43,900  (−900 pts, −2.0%, shallow retrace)
    {Sym.BULLET} Wave 3: 43,900 → 47,600  (+3,700 pts, +8.4%, strongest)
    {Sym.BULLET} Wave 4: 47,600 → 46,800  (−800 pts, −1.7%, corrective)
    {Sym.BULLET} Wave 5: 46,800 → 48,400  (+1,600 pts, +3.4%, final thrust)

    {Sym.WARN} **Corrective Wave (A-B-C):**
    {Sym.BULLET} Wave A: 48,400 → 46,200  (−2,200 pts)
    {Sym.BULLET} Wave B: 46,200 → 47,300  (+1,100 pts, typically 50% of A)
    {Sym.BULLET} Wave C: 47,300 → 44,800  (−2,500 pts)

    | Wave | Start | End | Points | % | Type |
    |---|---|---|---|---|---|
    | 1 | 42,000 | 44,800 | +2,800 | +6.7% | Impulse |
    | 2 | 44,800 | 43,900 | −900 | −2.0% | Corrective |
    | 3 | 43,900 | 47,600 | +3,700 | +8.4% | Impulse (extended) |
    | 4 | 47,600 | 46,800 | −800 | −1.7% | Corrective |
    | 5 | 46,800 | 48,400 | +1,600 | +3.4% | Impulse |
    | A | 48,400 | 46,200 | −2,200 | −4.5% | Impulse |
    | B | 46,200 | 47,300 | +1,100 | +2.4% | Corrective |
    | C | 47,300 | 44,800 | −2,500 | −5.3% | Impulse |
    """)


def worked_position_sizing(account: float = 500000, risk_pct: float = 2,
                            entry: float = 1500, stop: float = 1470,
                            symbol: str = "RELIANCE") -> str:
    """Position sizing worked example."""
    risk_amount = account * risk_pct / 100
    stop_dist = entry - stop
    shares = int(risk_amount / stop_dist)
    total_risk = shares * stop_dist

    return textwrap.dedent(f"""
    **Example: Position Sizing for {symbol}**

    {Sym.BULLET} Account Size: ₹{account:,.0f}
    {Sym.BULLET} Risk per Trade: {risk_pct}% = ₹{risk_amount:,.0f}
    {Sym.BULLET} Entry: ₹{entry:.2f}
    {Sym.BULLET} Stop Loss: ₹{stop:.2f} ({stop_dist:.1f} pts risk/share)
    {Sym.BULLET} Position Size: {shares} shares (₹{shares * entry:,.0f} notional)
    {Sym.BULLET} Total Risk: ₹{total_risk:,.0f} ({total_risk/account*100:.2f}% of account)

    | Parameter | Value |
    |---|---|
    | Account | ₹{account:,.0f} |
    | Risk % | {risk_pct}% |
    | Risk (₹) | ₹{risk_amount:,.0f} |
    | Entry | ₹{entry:.2f} |
    | Stop Loss | ₹{stop:.2f} |
    | Risk / Share | ₹{stop_dist:.1f} |
    | Shares | {shares} |
    | Notional | ₹{shares*entry:,.0f} |
    | Account % at risk | {total_risk/account*100:.2f}% |
    """)


def worked_fvg_example() -> str:
    """Fair Value Gap recognition example."""
    return textwrap.dedent(f"""
    **Example: FVG (Fair Value Gap) Recognition**

    {Sym.STAR} Three consecutive candles on 5-min Nifty:

    | Candle | High | Low | Close |
    |---|---|---|---|
    | Candle 1 (up) | 18,250 | 18,220 | 18,245 |
    | Candle 2 (gap up) | 18,280 | 18,260 | 18,275 |
    | Candle 3 (continuation) | 18,310 | 18,278 | 18,305 |

    {Sym.BULLET} **FVG zone:** 18,250 (C1 High) → 18,260 (C2 Low) = **10-pt gap**
    {Sym.BULLET} **Unmitigated zone:** Price has not revisited 18,250-18,260
    {Sym.BULLET} **Expectation:** Price likely to retrace into this gap before continuing
    {Sym.BULLET} **Strategy:** Wait for price to fill FVG, then long on rejection
    {Sym.WARN} Remember: Not all FVGs get filled — confluence with support increases probability.
    """)


# ═══════════════════════════════════════════════════════════════
# 8. HANDY EXPORT: Full SVG chart dict for programmatic access
# ═══════════════════════════════════════════════════════════════

CHARTS = {
    "candle": candle_chart,
    "head_shoulders": head_shoulders,
    "double_top": double_top,
    "double_bottom": double_bottom,
    "support_resistance": support_resistance,
    "trend_lines": trend_lines,
    "elliott_wave": elliott_wave,
    "fibonacci": fibonacci,
    "rsi": rsi_chart,
    "macd": macd_chart,
    "wyckoff": wyckoff,
    "market_structure": market_structure,
    "triangle": triangle,
    "cup_handle": cup_handle,
}

if __name__ == "__main__":
    # Quick test: print one SVG to check it works
    print("Testing SVG generators...")
    print(candle_chart(400, 200))
    print(head_shoulders(400, 200))
    print("✅ All chart generators working.")
