#!/usr/bin/env python3
"""
Merge all 5 volumes into one comprehensive book.
Simple concatenation with book-level title header.
No content filtering — preserves every word from all volumes.
"""

import os
import re

BASE = "/Users/vijaykumar/projecs /opencode/share/document/ultimate-guide"

VOLUMES = [
    "01-foundations-and-chart-patterns.md",
    "02-candlestick-patterns.md",
    "03-indicators-and-tools.md",
    "04-integration-and-trading-systems.md",
    "05-fundamental-analysis.md",
]

HEADER = """# The Complete Guide to Trading & Investing
## (Technical Analysis • Candlestick Patterns • Indicators • Trading Systems • Fundamental Analysis)

> A comprehensive reference covering everything from market foundations to advanced quantitative analysis.

---

**Author: Vijay kumar**

*A complete reference work combining all five volumes of the Technical & Fundamental Analysis series.*

---

*Dedicated to every trader and investor who understands that the market is not just about numbers — it's about people, psychology, and discipline.*

---

"""

PART_MARKERS = {
    "01-foundations-and-chart-patterns.md": "# PART 1: FOUNDATIONS OF TECHNICAL ANALYSIS & CHART PATTERNS\n## (Dow Theory, Market Structure, Support/Resistance, Chart Patterns, Harmonic Patterns, Volume Analysis)\n\n",
    "02-candlestick-patterns.md": "# PART 2: CANDLESTICK PATTERNS\n## (Single Candle, Two-Candle, Three-Candle Patterns, Narrative Reading, Real Body vs Shadow Analysis)\n\n",
    "03-indicators-and-tools.md": "# PART 3: TECHNICAL INDICATORS & TOOLS\n## (Moving Averages, RSI, MACD, ADX, Bollinger Bands, Fibonacci, Volume Indicators, Trading Channels)\n\n",
    "04-integration-and-trading-systems.md": "# PART 4: INTEGRATION & COMPLETE TRADING SYSTEMS\n## (3-Layer Analysis, Market Regime Detection, Multi-Timeframe Analysis, Risk Management, Position Sizing, Trading Psychology)\n\n",
    "05-fundamental-analysis.md": "# PART 5: FUNDAMENTAL ANALYSIS\n## (Business Analysis, Financial Statements, Ratios, Valuation Models, Quality Checks, Complete Stock Analysis Checklist)\n\n",
}

def main():
    print("Merging 5 volumes into one comprehensive book...")
    
    total_words = 0
    all_content = HEADER
    
    for vol_file in VOLUMES:
        filepath = os.path.join(BASE, vol_file)
        if not os.path.exists(filepath):
            print(f"  Warning: {filepath} not found")
            continue
        
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        
        vol_words = len(content.split())
        total_words += vol_words
        print(f"  Added: {vol_file} ({vol_words:,} words)")
        
        # Add a part separator
        all_content += "\n\n---\n\n"
        
        # Add PART marker for this volume
        marker = PART_MARKERS.get(vol_file, "")
        all_content += marker
        
        # Skip only the title H1 and Table of Contents from each volume
        lines = content.split("\n")
        cleaned_lines = []
        first_h1_skipped = False
        in_toc = False
        for line in lines:
            stripped = line.strip()
            
            # Skip the first H1 heading (redundant with our PART marker)
            if not first_h1_skipped and stripped.startswith("# ") and not stripped.startswith("## "):
                first_h1_skipped = True
                continue
            
            # Skip TABLE OF CONTENTS sections entirely
            if stripped.startswith("# TABLE OF CONTENTS") or stripped.startswith("## Table of Contents"):
                in_toc = True
                continue
            if in_toc:
                # End of TOC: next H1 or empty line after TOC content
                if stripped.startswith("# ") or (not stripped and in_toc):
                    in_toc = False
                    continue
                if stripped.startswith(("---", "|")):
                    continue
                # Check if line is a TOC entry (numbered like "1.2.3" or has ......)
                if re.match(r'^[\d\.]+\s', stripped) or '...' in stripped:
                    continue
                # If line has substantial content, it's probably not TOC
                if len(stripped) > 30 and not re.match(r'^[\d\.\s]', stripped):
                    in_toc = False
                    cleaned_lines.append(line)
                    continue
            
            cleaned_lines.append(line)
        
        all_content += "\n".join(cleaned_lines)
    
    # Ensure no trailing ---
    all_content = all_content.strip()
    
    output_path = os.path.join(BASE, "complete-en.md")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(all_content)
    
    words = len(all_content.split())
    lines = all_content.count("\n")
    print(f"\n✅ Created: complete-en.md")
    print(f"   Lines: {lines:,}")
    print(f"   Words: {words:,}")
    print(f"   Author: Vijay kumar")
    print(f"   Source volumes: {sum(1 for _ in VOLUMES)}")
    print(f"   Total source words: {total_words:,}")
    print(f"   Coverage: {words/total_words*100:.1f}% of source content")


if __name__ == "__main__":
    main()
