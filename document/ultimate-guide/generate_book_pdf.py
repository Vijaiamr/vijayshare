#!/usr/bin/env python3
"""
Financial Handbook → Beautiful Book PDF Generator
Converts markdown handbooks into professionally formatted PDFs.

Pipeline:
  1. Python:  Read markdown → Parse structure → Generate HTML + CSS
  2. Node.js: Load HTML in Puppeteer → Print to PDF

Usage:
    python3 generate_book_pdf.py 00-financial-handbook-complete.md  --lang en
    python3 generate_book_pdf.py 00-tamil-financial-handbook.md   --lang ta
"""

import re
import sys
import os
import subprocess
import argparse
from pathlib import Path


# ──────────────────────────────────────────────
# LANGUAGE CONFIG
# ──────────────────────────────────────────────
BOOK_CONFIG = {
    "en": {
        "lang": "en",
        "body_font": "'Georgia', 'Times New Roman', serif",
        "heading_font": "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
        "title_font": "'Baskerville', 'Georgia', serif",
        "font_size_body": "10.5pt",
        "font_size_small": "9pt",
        "line_height": "1.55",
        "accent_color": "#9B6B3C",     # warm gold-brown
        "heading_color": "#1B2A4A",     # deep navy
        "body_color": "#2D2D2D",
        "bg_color": "#FAFAF7",          # warm cream
        "paper_size": "152mm 229mm",    # 6"×9" US Trade
        "book_title": "The Complete Financial Handbook",
        "part_label": "PART",
        "author": "Vijay Kumar",
    },
    "ta": {
        "lang": "ta",
        "body_font": "'Tiro Tamil', 'Georgia', serif",
        "heading_font": "'Tiro Tamil', 'Helvetica Neue', sans-serif",
        "title_font": "'Tiro Tamil', serif",
        "font_size_body": "11.5pt",
        "font_size_small": "10pt",
        "line_height": "1.65",
        "accent_color": "#9B6B3C",
        "heading_color": "#1B2A4A",
        "body_color": "#2D2D2D",
        "bg_color": "#FAFAF7",
        "paper_size": "152mm 229mm",
        "book_title": "முழு நிதி கையேடு — Complete Financial Handbook in Tamil",
        "part_label": "பாகம்",
        "author": "Vijay Kumar Chockanathan",
    },
}


# ──────────────────────────────────────────────
# MARKDOWN PARSER
# ──────────────────────────────────────────────
H1_PART_RE = re.compile(r'^#\s+(PART\s+\d+)\s*[:\-–—]?\s*(.*)', re.IGNORECASE)
H1_TITLE_RE = re.compile(r'^#\s+(?!PART\b)(.+)$', re.IGNORECASE)
H2_SUBTITLE_RE = re.compile(r'^##\s+\((.+)\)\s*$')
H2_CHAPTER_RE = re.compile(r'^##\s+(Chapter\s+\d+)\s*[:\-–—]?\s*(.*)', re.IGNORECASE)
H2_QUICK_SUMMARY_RE = re.compile(r'^##\s+(Quick Summary .*)$', re.IGNORECASE)
H2_GENERIC_RE = re.compile(r'^##\s+(.+)$')
H3_RE = re.compile(r'^###\s+(.+)$')
HR_RE = re.compile(r'^---+\s*$')
BLOCKQUOTE_RE = re.compile(r'^>\s*(.*)')


def parse_markdown(text):
    """
    Parse markdown into structured dict:
    {
      "title": "...",
      "subtitle": "...",
      "description": "...",
      "preface": "...",
      "parts": [
        {
          "number": 1,
          "title": "HOW THE STOCK MARKET WORKS",
          "subtitle": "And Why We Behave...",
          "intro_md": "...",
          "quick_summary_raw": "...",
          "chapters": [
            { "number": 1, "title": "What Is a Stock?", "body_md": "..." },
            ...
          ]
        },
        ...
      ]
    }
    """
    lines = text.split('\n')
    result = {
        "title": "",
        "subtitle": "",
        "description": "",
        "preface": "",
        "parts": []
    }

    current_part = None
    current_chapter = None
    current_section_md = []
    current_part_intro_md = []
    state = "title"
    pre_part_lines = []

    for line in lines:
        m_part = H1_PART_RE.match(line)
        if m_part:
            _flush_chapter(current_part, current_chapter, current_section_md)
            current_chapter = None
            current_section_md = []

            if current_part is not None:
                current_part["intro_md"] = "\n".join(current_part_intro_md).strip()
                result["parts"].append(current_part)

            num = int(re.search(r'\d+', m_part.group(1)).group())
            current_part = {
                "number": num,
                "title": m_part.group(2).strip(),
                "subtitle": "",
                "intro_md": "",
                "quick_summary_raw": "",
                "chapters": []
            }
            current_part_intro_md = []
            state = "part"
            continue

        m_ch = H2_CHAPTER_RE.match(line)
        if m_ch and current_part is not None:
            _flush_chapter(current_part, current_chapter, current_section_md)
            num = int(re.search(r'\d+', m_ch.group(1)).group())
            current_chapter = {
                "number": num,
                "title": m_ch.group(2).strip(),
                "body_md": ""
            }
            current_section_md = []
            state = "chapter"
            continue

        m_qs = H2_QUICK_SUMMARY_RE.match(line)
        if m_qs and current_part is not None:
            _flush_chapter(current_part, current_chapter, current_section_md)
            current_chapter = None
            current_section_md = []
            current_part["quick_summary_raw"] = line
            state = "quick_summary"
            continue

        m_ps = H2_SUBTITLE_RE.match(line)
        if m_ps and state == "part":
            current_part["subtitle"] = m_ps.group(1)
            continue

        if current_part is None:
            pre_part_lines.append(line)
            continue

        if state == "part":
            current_part_intro_md.append(line)
        elif state in ("chapter", "quick_summary"):
            current_section_md.append(line)

    # Flush last chapter and part
    _flush_chapter(current_part, current_chapter, current_section_md)
    if current_part is not None:
        current_part["intro_md"] = "\n".join(current_part_intro_md).strip()
        result["parts"].append(current_part)

    # Parse title section
    _parse_title_section(result, pre_part_lines)

    # Parse quick summary bodies
    _extract_quick_summary_bodies(result, text)

    return result


def _flush_chapter(part, chapter, lines):
    if part is not None and chapter is not None:
        chapter["body_md"] = "\n".join(lines).strip()
        part["chapters"].append(chapter)


def _parse_title_section(result, lines):
    title_found = False
    desc_lines = []
    preface_lines = []
    in_preface = False

    for line in lines:
        m_t = H1_TITLE_RE.match(line)
        if m_t and not title_found:
            result["title"] = m_t.group(1).strip()
            title_found = True
            continue

        m_sub = H2_SUBTITLE_RE.match(line)
        if m_sub and not result["subtitle"]:
            result["subtitle"] = m_sub.group(1)
            continue

        m_bq = BLOCKQUOTE_RE.match(line)
        if m_bq and not in_preface and not line.strip().startswith(">"):
            continue
        if m_bq and not in_preface:
            desc_lines.append(m_bq.group(1))
            continue

        if HR_RE.match(line):
            in_preface = True
            continue

        if in_preface:
            preface_lines.append(line)

    result["description"] = " ".join(desc_lines).strip()
    result["preface"] = "\n".join(preface_lines).strip()


def _extract_quick_summary_bodies(book, raw_md):
    """Extract the content after each Quick Summary heading."""
    # Split the raw text into part sections
    parts_raw = re.split(r'^# PART \d+:', raw_md, flags=re.MULTILINE)
    for i, part_raw in enumerate(parts_raw[1:], 1):
        if i > len(book["parts"]):
            break
        part = book["parts"][i - 1]
        # Find Quick Summary and grab everything after it until next PART or end
        match = re.search(
            r'^## Quick Summary of Part \d+\s*\n([\s\S]*?)(?=^# PART|\Z)',
            part_raw,
            flags=re.MULTILINE
        )
        if match:
            qs_content = match.group(1).strip()
            if qs_content:
                part["quick_summary_raw"] = "## Quick Summary\n\n" + qs_content


# ──────────────────────────────────────────────
# HTML GENERATOR
# ──────────────────────────────────────────────
def build_html(book, cfg):
    """Build complete HTML document with embedded CSS."""
    lang = cfg["lang"]
    title = _escape(book["title"])
    subtitle = _escape(book["subtitle"])

    parts_html = ""
    for part in book["parts"]:
        part_num_roman = _to_roman(part["number"])
        part_title = _escape(part["title"])
        part_subtitle = _escape(part["subtitle"]) if part["subtitle"] else ""

        # Part opening page
        part_opening = f'''
        <div class="part-opening">
          <div class="part-opening-content">
            <div class="part-label">{cfg['part_label']} {part_num_roman}</div>
            <h1 class="part-title-main">{part_title}</h1>
            {f'<p class="part-subtitle-main">{part_subtitle}</p>' if part_subtitle else ''}
            <div class="part-deco">&#9734; &#9734; &#9734;</div>
          </div>
        </div>'''

        # Part intro
        part_intro_html = ""
        if part["intro_md"]:
            part_intro_html = _md_to_html(part["intro_md"])

        # Chapters
        chapters_html = ""
        for ch in part["chapters"]:
            ch_title = _escape(ch["title"])
            body_html = _md_to_html(ch["body_md"])
            chapters_html += f'''
            <div class="chapter" data-chapter="{ch['number']}">
              <h2 class="chapter-title">Chapter {ch['number']}{f': {ch_title}' if ch_title else ''}</h2>
              <div class="chapter-body">
                {body_html}
              </div>
            </div>'''

        # Quick summary
        qs_html = ""
        if part["quick_summary_raw"]:
            qs_body = _md_to_html(part["quick_summary_raw"])
            qs_html = f'''
            <div class="quick-summary">
              {qs_body}
            </div>'''

        parts_html += f'''
      <div class="part" data-part="{part['number']}">
        {part_opening}
        {f'<div class="part-intro">{part_intro_html}</div>' if part_intro_html else ''}
        {chapters_html}
        {qs_html}
      </div>'''

    # Preface
    preface_html = ""
    if book["preface"]:
        pref_body = _md_to_html(book["preface"])
        preface_html = f'''
      <div class="preface">
        <div class="preface-content">
          {pref_body}
        </div>
      </div>'''

    # Description for title page
    desc_html = f'<p class="book-description">{_escape(book["description"])}</p>' if book["description"] else ""

    # Book title overrides
    book_title_display = cfg["book_title"]

    # ── Complete HTML ──
    html = f'''<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
{_get_css(cfg)}
</style>
</head>
<body>
  <div class="book">
    <!-- ═══ TITLE PAGE ═══ -->
    <div class="title-page">
      <div class="title-page-content">
        <div class="title-deco-line">&#9670; &#9670; &#9670;</div>
        <h1 class="book-title">{book_title_display}</h1>
        {f'<p class="book-subtitle">{subtitle}</p>' if subtitle else ''}
        <p class="book-author">{cfg["author"]}</p>
        <div class="title-divider">&#9733;</div>
        {desc_html}
      </div>
    </div>

    <!-- ═══ PREFACE ═══ -->
    {preface_html}

    <!-- ═══ PARTS ═══ -->
    {parts_html}

    <!-- ═══ COLOPHON ═══ -->
    <div class="colophon">
      <div class="colophon-content">
        <p class="colophon-title">{title}</p>
        <p class="colophon-subtitle">{subtitle}</p>
        <p class="colophon-author">{cfg["author"]}</p>
        <div class="colophon-divider">&#9733;</div>
        <p class="colophon-text">For education purpose only.</p>
        <p class="colophon-date">July 2026</p>
      </div>
    </div>
  </div>


</body>
</html>'''
    return html


def _md_to_html(md_text):
    """Convert markdown snippet to HTML using the markdown library."""
    import markdown as md_lib
    if not md_text or not md_text.strip():
        return ""
    try:
        return md_lib.markdown(
            md_text,
            extensions=["extra", "smarty", "codehilite", "tables", "sane_lists"],
            output_format="html5"
        )
    except Exception:
        return f"<p>{_escape(md_text[:200])}</p>"


def _escape(text):
    if not text:
        return ""
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    text = text.replace('"', "&quot;")
    return text


def _to_roman(n):
    vals = [(50, "L"), (40, "XL"), (10, "X"), (9, "IX"),
            (5, "V"), (4, "IV"), (1, "I")]
    result = ""
    for val, sym in vals:
        while n >= val:
            result += sym
            n -= val
    return result


# ──────────────────────────────────────────────
# CSS — Puppeteer / Chrome Print Optimized
# ──────────────────────────────────────────────
def _get_css(cfg):
    """Return CSS string. Optimized for Chrome/Blink print rendering."""
    return f'''
/* ════════════════════════════════════════
   FINANCIAL HANDBOOK — Book Styles
   Optimized for Chrome Print / Puppeteer
   ════════════════════════════════════════ */

@page {{
  size: {cfg["paper_size"]};
  margin: 22mm 22mm 28mm 24mm;
}}

@page:first {{
  @bottom-center {{ content: none; }}
  margin-bottom: 22mm;
}}

/* ── Reset ── */
*, *::before, *::after {{
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}}

html {{
  font-size: 100%;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}}

body {{
  font-family: {cfg["body_font"]};
  font-size: {cfg["font_size_body"]};
  line-height: {cfg["line_height"]};
  color: {cfg["body_color"]};
  background: {cfg["bg_color"]};
  text-align: left;
  hyphens: none;
  -webkit-hyphens: none;
  word-break: normal;
  overflow-wrap: normal;
  orphans: 3;
  widows: 3;
}}

/* ── Page numbers handled by Puppeteer footer template ── */

/* ── Book Container ── */
.book {{
  max-width: 100%;
}}

/* ── TITLE PAGE ── */
.title-page {{
  page-break-after: always;
  break-after: page;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
  padding: 0 15mm;
}}

.title-page-content {{
  width: 100%;
  max-width: 120mm;
  margin: 0 auto;
}}

.title-deco-line {{
  font-size: 14pt;
  color: {cfg["accent_color"]};
  letter-spacing: 8pt;
  margin-bottom: 20mm;
}}

.book-title {{
  font-family: {cfg["title_font"]};
  font-size: 24pt;
  font-weight: 700;
  color: {cfg["heading_color"]};
  letter-spacing: 1.2pt;
  line-height: 1.25;
  margin-bottom: 8mm;
  text-transform: uppercase;
}}

.book-subtitle {{
  font-family: {cfg["heading_font"]};
  font-size: 12pt;
  font-weight: 400;
  color: #777;
  font-style: italic;
  line-height: 1.4;
  margin-bottom: 6mm;
}}

.book-author {{
  font-family: {cfg["heading_font"]};
  font-size: 11pt;
  font-weight: 400;
  color: {cfg["accent_color"]};
  letter-spacing: 2pt;
  text-transform: uppercase;
  margin-bottom: 12mm;
}}

.title-divider {{
  font-size: 16pt;
  color: {cfg["accent_color"]};
  margin: 8mm 0;
}}

.book-description {{
  font-family: {cfg["body_font"]};
  font-size: 10pt;
  color: #888;
  font-style: italic;
  line-height: 1.5;
  max-width: 80%;
  margin: 0 auto;
}}

/* ── PREFACE ── */
.preface {{
  page-break-before: always;
  break-before: page;
  padding: 20mm 5mm 10mm 5mm;
}}

.preface-content {{
  max-width: 85%;
  margin: 0 auto;
}}

.preface-content p {{
  margin-bottom: 1.2em;
  font-size: 10pt;
  color: #555;
}}

.preface-content strong {{
  color: {cfg["heading_color"]};
}}

.preface-content hr {{
  border: none;
  border-top: 1px solid #ddd;
  margin: 1.5em 0;
}}

/* ── PART OPENING ── */
.part-opening {{
  page-break-before: always;
  break-before: page;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 90vh;
  text-align: center;
  padding: 0 15mm;
}}

.part-opening-content {{
  width: 100%;
  max-width: 120mm;
}}

.part-label {{
  font-family: {cfg["heading_font"]};
  font-size: 16pt;
  font-weight: 700;
  color: {cfg["accent_color"]};
  letter-spacing: 8pt;
  margin-bottom: 12mm;
}}

.part-title-main {{
  font-family: {cfg["title_font"]};
  font-size: 22pt;
  font-weight: 700;
  color: {cfg["heading_color"]};
  line-height: 1.3;
  margin-bottom: 6mm;
}}

.part-subtitle-main {{
  font-family: {cfg["heading_font"]};
  font-size: 13pt;
  color: #888;
  font-style: italic;
  line-height: 1.4;
  margin: 0 auto;
  max-width: 80%;
}}

.part-deco {{
  font-size: 14pt;
  color: {cfg["accent_color"]};
  letter-spacing: 8pt;
  margin-top: 15mm;
}}

/* ── PART INTRO ── */
.part-intro {{
  padding: 5mm 0 8mm 0;
}}

.part-intro h2 {{
  font-family: {cfg["heading_font"]};
  font-size: 13pt;
  font-weight: 600;
  color: {cfg["heading_color"]};
  margin: 1.5em 0 0.6em 0;
}}

.part-intro p {{
  margin-bottom: 0.8em;
  text-indent: 1.5em;
}}

.part-intro ul,
.part-intro ol {{
  margin: 0.5em 0 0.8em 1.8em;
}}

.part-intro li {{
  margin-bottom: 0.3em;
}}

/* ── CHAPTER ── */
.chapter {{
  page-break-before: always;
  break-before: page;
  padding-top: 8mm;
}}

.chapter-title {{
  font-family: {cfg["heading_font"]};
  font-size: 17pt;
  font-weight: 700;
  color: {cfg["heading_color"]};
  margin-bottom: 0.8em;
  line-height: 1.25;
  border-bottom: 2px solid {cfg["accent_color"]};
  padding-bottom: 4mm;
  page-break-after: avoid;
}}

/* ── CHAPTER BODY ── */
.chapter-body {{
  text-align: left;
}}

.chapter-body h3 {{
  font-family: {cfg["heading_font"]};
  font-size: 12.5pt;
  font-weight: 600;
  color: {cfg["heading_color"]};
  margin: 1.5em 0 0.5em 0;
  line-height: 1.3;
}}

.chapter-body h4 {{
  font-family: {cfg["heading_font"]};
  font-size: 11pt;
  font-weight: 600;
  color: #555;
  margin: 1.2em 0 0.4em 0;
}}

.chapter-body p {{
  margin-bottom: 0.6em;
  text-indent: 1.5em;
}}

.chapter-body p:first-of-type {{
  text-indent: 0;
}}

/* Drop cap on first chapter only */
.part:first-of-type .chapter:first-of-type .chapter-body > p:first-of-type::first-letter {{
  float: left;
  font-size: 3.2em;
  line-height: 0.85;
  padding-right: 0.1em;
  padding-top: 0.05em;
  padding-bottom: 0.05em;
  color: {cfg["accent_color"]};
  font-family: {cfg["title_font"]};
  font-weight: 700;
}}

/* ── LISTS ── */
.chapter-body ul,
.chapter-body ol {{
  margin: 0.4em 0 0.6em 1.8em;
}}

.chapter-body li {{
  margin-bottom: 0.25em;
}}

.chapter-body li > ul,
.chapter-body li > ol {{
  margin-top: 0.15em;
  margin-bottom: 0.15em;
}}

/* ── BLOCKQUOTES ── */
.chapter-body blockquote {{
  margin: 0.8em 0 0.8em 1em;
  padding: 0.4em 1em;
  border-left: 3px solid {cfg["accent_color"]};
  font-style: italic;
  color: #666;
  background: rgba(155, 107, 60, 0.06);
}}

.chapter-body blockquote p {{
  margin-bottom: 0.3em;
  text-indent: 0;
}}

.chapter-body blockquote p:last-child {{
  margin-bottom: 0;
}}

/* ── TABLES ── */
.chapter-body table {{
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 9pt;
  page-break-inside: avoid;
}}

.chapter-body th {{
  background: {cfg["heading_color"]};
  color: #fff;
  padding: 5pt 8pt;
  text-align: left;
  font-family: {cfg["heading_font"]};
  font-weight: 600;
}}

.chapter-body td {{
  padding: 4pt 8pt;
  border-bottom: 1px solid #ddd;
}}

.chapter-body tr:nth-child(even) td {{
  background: rgba(0, 0, 0, 0.02);
}}

/* ── HORIZONTAL RULES ── */
.chapter-body hr {{
  border: none;
  border-top: 1px solid #ddd;
  margin: 1.2em 0;
  text-align: center;
}}

/* ── CODE ── */
.chapter-body code {{
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 8.5pt;
  background: #f0f0ec;
  padding: 1pt 4pt;
  border-radius: 2pt;
}}

.chapter-body pre {{
  margin: 0.8em 0;
  padding: 0.6em 1em;
  background: #f0f0ec;
  border-left: 3px solid #ccc;
  font-size: 8.5pt;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}}

.chapter-body pre code {{
  background: none;
  padding: 0;
}}

/* ── QUICK SUMMARY ── */
.quick-summary {{
  page-break-before: always;
  break-before: page;
  padding: 5mm 0;
}}

.quick-summary h2 {{
  font-family: {cfg["heading_font"]};
  font-size: 16pt;
  font-weight: 700;
  color: {cfg["heading_color"]};
  margin-bottom: 0.8em;
  text-align: center;
  border-top: 2px solid {cfg["accent_color"]};
  border-bottom: 2px solid {cfg["accent_color"]};
  padding: 4mm 0;
}}

.quick-summary h3 {{
  font-family: {cfg["heading_font"]};
  font-size: 12pt;
  font-weight: 600;
  color: {cfg["heading_color"]};
  margin: 1em 0 0.4em 0;
}}

.quick-summary p {{
  margin-bottom: 0.6em;
  text-indent: 1em;
}}

.quick-summary ul,
.quick-summary ol {{
  margin: 0.3em 0 0.5em 1.8em;
}}

.quick-summary blockquote {{
  margin: 0.5em 0 0.5em 1em;
  padding: 0.3em 1em;
  border-left: 3px solid {cfg["accent_color"]};
  font-style: italic;
  color: #666;
}}

/* ── COLOPHON ── */
.colophon {{
  page-break-before: always;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  text-align: center;
  padding: 0 15mm;
}}

.colophon-content {{
  max-width: 100mm;
}}

.colophon-title {{
  font-family: {cfg["title_font"]};
  font-size: 14pt;
  font-weight: 700;
  color: {cfg["heading_color"]};
  margin-bottom: 5mm;
}}

.colophon-subtitle {{
  font-family: {cfg["heading_font"]};
  font-size: 10pt;
  color: #888;
  font-style: italic;
  margin-bottom: 4mm;
}}

.colophon-author {{
  font-family: {cfg["heading_font"]};
  font-size: 10pt;
  color: {cfg["accent_color"]};
  letter-spacing: 1.5pt;
  text-transform: uppercase;
  margin-bottom: 8mm;
}}

.colophon-divider {{
  font-size: 14pt;
  color: {cfg["accent_color"]};
  margin: 6mm 0;
}}

.colophon-text {{
  font-size: 9pt;
  color: #999;
  margin-bottom: 2mm;
}}

.colophon-date {{
  font-size: 9pt;
  color: #aaa;
}}

/* ── IMAGES ── */
.chapter-body img {{
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0.8em auto;
}}

/* ── LINKS ── */
.chapter-body a {{
  color: {cfg["accent_color"]};
  text-decoration: none;
  border-bottom: 1px solid rgba(155, 107, 60, 0.3);
}}

/* ── PAGE BREAK CONTROLS ── */
h2, h3, h4 {{
  page-break-after: avoid;
}}

blockquote, table, pre {{
  page-break-inside: avoid;
}}

/* ── TAMIL-SPECIFIC TWEAKS ── */
html[lang="ta"] .book-title {{
  font-size: 20pt;
  text-transform: none;
}}

html[lang="ta"] .title-deco-line {{
  margin-bottom: 12mm;
}}

html[lang="ta"] .book-subtitle {{
  font-size: 11pt;
}}

html[lang="ta"] .part-title-main {{
  font-size: 19pt;
}}

html[lang="ta"] .chapter-title {{
  font-size: 15pt;
}}

html[lang="ta"] .chapter-body p {{
  text-indent: 1em;
}}

html[lang="ta"] .chapter-body h3 {{
  font-size: 12pt;
}}

/* ── PRINT-SPECIFIC ── */
@media print {{
  body {{
    background: white;
  }}
  .page-footer {{
    color: #888;
  }}
}}
'''


# ──────────────────────────────────────────────
# PDF GENERATION
# ──────────────────────────────────────────────
def generate_pdf(md_path, lang="en", output_path=None):
    """Generate a beautiful book PDF from a markdown file."""

    cfg = BOOK_CONFIG[lang]

    print(f"📖 Reading: {md_path}")
    with open(md_path, "r", encoding="utf-8") as f:
        raw_text = f.read()

    print(f"📐 Parsing structure...")
    book = parse_markdown(raw_text)

    print(f"   Title: {book['title']}")
    print(f"   Parts: {len(book['parts'])}")
    for p in book["parts"]:
        qs = " ✓" if p.get("quick_summary_raw") else ""
        print(f"     Part {p['number']}: {p['title']} ({len(p['chapters'])} chapters){qs}")

    print(f"🎨 Building HTML with {lang.upper()} styling...")
    html = build_html(book, cfg)

    # Determine output paths
    if output_path is None:
        output_path = md_path.replace(".md", ".pdf")

    html_path = output_path.replace(".pdf", ".html")

    # Save HTML
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"   HTML saved: {html_path}")

    # Call Node.js Puppeteer script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    node_script = os.path.join(script_dir, "tools", "html2pdf.js")

    node_script_path = None
    for candidate in [node_script]:
        if os.path.exists(candidate):
            node_script_path = candidate
            break

    if not node_script_path:
        print(f"⚠️  Node.js script not found at {node_script}")
        print(f"   Ensure tools/html2pdf.js exists with puppeteer installed")
        return False

    paper_size = cfg["paper_size"].replace(" ", "x")

    print(f"🖨️  Generating PDF via Puppeteer...")
    cmd = ["node", node_script_path, html_path, output_path, paper_size]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        print(result.stdout)
        if result.returncode != 0:
            print(f"❌ Node.js error: {result.stderr}")
            return False
        if result.stderr:
            # Filter out warnings we don't care about
            for line in result.stderr.split('\n'):
                if 'Error' in line or 'error' in line:
                    print(f"   ⚠️  {line}")
    except subprocess.TimeoutExpired:
        print("❌ PDF generation timed out after 180 seconds")
        return False
    except FileNotFoundError:
        print(f"❌ Node.js not found. Is it installed?")
        return False

    # Check output
    if os.path.exists(output_path):
        size = os.path.getsize(output_path)
        size_str = f"{size / 1024 / 1024:.1f} MB" if size > 1024 * 1024 else f"{size / 1024:.0f} KB"
        print(f"✅ PDF generated successfully!")
        print(f"   File: {output_path}")
        print(f"   Size: {size_str}")

        # Get page count
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(output_path)
            print(f"   Pages: {len(reader.pages)}")
        except Exception:
            pass

        return True
    else:
        print(f"❌ Output file not created: {output_path}")
        return False


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Generate beautiful book PDF from financial handbook markdown."
    )
    parser.add_argument("input", help="Path to input markdown file")
    parser.add_argument("--lang", "-l", choices=["en", "ta"], default="en",
                        help="Language (en=English, ta=Tamil)")
    parser.add_argument("--output", "-o", default=None,
                        help="Output PDF path (default: same as input with .pdf)")

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ File not found: {args.input}")
        sys.exit(1)

    success = generate_pdf(args.input, args.lang, args.output)
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
