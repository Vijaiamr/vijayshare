#!/usr/bin/env python3
"""
build_english_book.py — Generate the English version of the Financial Handbook.
Uses the same structure, SVG visuals, and helpers as the Tamil builder (build_tamil_book.py)
but with English content throughout. No tamizhify() post-processing.
"""
import os, sys, subprocess
import book_visuals as V

BASE = "/Users/vijaykumar/projecs /opencode/share/document/ultimate-guide"
OUTPUT_DIR = BASE
GENERATOR_SCRIPT = os.path.join(BASE, "generate_book_pdf.py")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "complete-en.md")
PDF_OUTPUT = os.path.join(OUTPUT_DIR, "complete-en.pdf")
L = []
def P(t=""): L.append(t)
def H1(t): P(f"# {t}")
def H2(t): P(f"## {t}")
def H3(t): P(f"### {t}")
def HR(): P("---")
def BLK(t): P(f"> {t}")
def B(t): return f"**{t}**"
def IMG(fn, *args, **kw): P(fn(*args, **kw))
def TBL(fn, *args, **kw): P(fn(*args, **kw))
def DIV(ch="\u25C6", n=5): P(f"\u25C6 " * n)
def STAR(): P(V.star_divider())
SD = V.Sym

def build():
    # ══ TITLE ══
    P("# The Complete Guide to Financial Markets")
    H2("(Technical Analysis, Fundamental Analysis, Trading Systems, Risk Management)")
    P()
    P("Your comprehensive handbook for mastering stock markets, trading, and investing — from the foundations of technical analysis to professional-grade quantitative trading systems.")
    P()
    HR()
    P()

    # ══ TABLE OF CONTENTS ══
    H2("Table of Contents")
    P()
    P("**Part 1: Technical Analysis – Foundations** — Dow Theory, Market Structure, Chart Patterns, Harmonic Patterns, Elliott Wave Theory")
    P()
    P("**Part 2: Candlestick Patterns** — Single, Double, Triple Candle Patterns, Story Reading, Body & Shadow Analysis")
    P()
    P("**Part 3: Indicators & Tools** — RSI, MACD, Moving Averages, Bollinger Bands, Fibonacci, Volume Analysis, ADX, ATR, Ichimoku, FII/DII Analysis")
    P()
    P("**Part 4: Trading Systems** — SMC/ICT Concepts, Wyckoff Method, Supply & Demand, Risk Management, Trading Psychology, Setups")
    P()
    P("**Part 5: Fundamental Analysis** — PE/PB Ratios, ROE/ROCE, DCF, Piotroski F-Score, Altman Z-Score, Graham Number, Portfolio Construction")
    P()
    P("**Appendix: English–English Glossary of Financial Terms**")
    P()
    HR()
    P()

    # ══════════════════════════════════════
    # INTRODUCTION
    # ══════════════════════════════════════
    H1("Introduction")
    H2("How Markets Move and How to Study Them")
    P()
    P("Every trader who wants to succeed in the markets must first thoroughly understand the foundations of technical analysis. The price chart is the language of the market. Every price movement reflects the decisions of thousands of buyers and sellers. These decisions are all based on human emotions — fear, greed, hope, euphoria, and panic. The market is not just numbers; it is a mirror of human emotions. A trader must learn to control their emotions. Otherwise, the market will control them. This is the first and most important lesson of trading.")
    P()
    P("Technical analysis teaches us three important things. First: identifying the market trend. Second: finding key support and resistance levels. Third: understanding the energy behind price movements. These three skills are essential for any trader. Trading without a trend is difficult. But in a trending market, trading in the direction of the trend is highly profitable. The trend is a trader's best friend.")
    P()
    P("A trader must first learn to read the language of the market — the price chart. Then understand the indicators. Then, select good companies through fundamental analysis. Finally, achieve consistent profits through risk management and trading psychology. This book explains all of these steps to you. Read patiently, practice, and improve every day. Success is a journey, not a destination.")
    P()
    P("Three key elements are needed to succeed in market analysis. The first element is knowledge. You must acquire sufficient knowledge about the market. The second element is experience. You must practice in the live market. The third element is discipline. You must strictly follow your rules. Without these three elements, no trader can achieve long-term success. Many traders have knowledge but fail due to lack of discipline. Discipline is the key to success.")
    P()
    P("Every trader should choose a time frame that suits them. Some trade in minutes. Some trade in hours. Some trade in days and weeks. Choosing a time frame that matches your personality, time, and capital is very important. It may take several months to find which time frame suits you. Be patient, try different time frames.")
    P()
    P("Many traders make a big mistake when entering the market. They think they can make money quickly. But the market is not a place to make quick money. The market is a profession. It requires time, effort, and patience. Just as a doctor or engineer must study for years, a trader must also learn for months and years. Only when you understand this truth can you succeed in the market.")
    P()
    P("In your trading journey, you will encounter various market conditions. Sometimes the market will be in a strong uptrend. Buying is easy then. Sometimes the market will be in a downtrend. Selling is best then. Sometimes the market will be range-bound. You can buy at the bottom of the range and sell at the top. Each market condition has a suitable strategy. No single strategy works all the time. Learn to adapt your strategy to market conditions.")
    P()
    P("Remember: losses are natural in the market. No trader can have a 100% win rate. What matters is how you handle the loss. Do not let a small loss turn into a big loss. Strictly follow your stop loss. If you lose on a trade, do not try to recover it on the next trade. Revenge trading is very dangerous. Follow your plan. Be patient. Success will surely come.")
    P()
    P("Every day when the market opens, new opportunities arise. Some opportunities are good. Some are bad. Identifying good opportunities is an art. This art requires practice. Study the market every day. Examine the charts. Write your notes. By doing this, you will gradually understand the language of the market. Identifying a good opportunity will become natural to you. Only then can you become a mature trader.")
    P()
    STAR()
    P(V.key_point("A picture is worth a thousand words. The following illustrations explain key concepts visually."))
    P()

    # ══════════════════════════════════════
    # PART 1: TECHNICAL ANALYSIS – FOUNDATIONS
    # ══════════════════════════════════════
    H1("Part 1: Technical Analysis — Foundations")
    H2("(Dow Theory, Market Structure, Chart Patterns, Harmonic Patterns, Elliott Wave Theory)")
    P()
    HR()
    P()

    # ── Part 1 intro paragraphs ──
    P("Technical analysis is a method of analyzing price movements, trading volume, and time to forecast future price changes. While fundamental analysis tries to find the true value of a company, technical analysis works with patterns and trends visible on the price chart. A technical analyst does not need to know anything about a company's business model, revenue, or management. They can make trading decisions based solely on the patterns visible on the price chart.")
    P()
    P("The philosophy of technical analysis is built on three core assumptions. First assumption: the market discounts everything. All information — news, earnings, interest rates, investor sentiment — is already reflected in the current price. Second assumption: prices move in trends. Once a trend is established, it tends to continue. Third assumption: history tends to repeat itself. Market participants consistently react to similar situations in similar ways, creating recognizable patterns on the charts.")
    P()
    P("There are five major categories of technical analysis. Trend analysis uses moving averages, trendlines, and price action to determine direction. Chart pattern analysis identifies formations that signal continuation or reversal. Candlestick analysis examines individual price bars for psychological insights. Indicator analysis applies mathematical formulas to price and volume data for confirmation. Volume analysis measures the strength behind price movements. Each category has its strengths, and combining them increases reliability.")
    P()
    P("The greatest advantage of technical analysis is its applicability across any market and any time frame. Whether you trade stocks in NSE/BSE, forex, crypto, commodities, or futures and options, the same principles apply. This is because technical analysis is based on human psychology, and humans trade with the same emotions — fear, greed, hope, FOMO, capitulation, euphoria — in every market around the world.")
    P()

    # ── Part 1 Section 1.1 ──
    H2("1.1 Dow Theory — The Oldest and Most Important Theory")
    P()
    P("Charles Dow founded the Wall Street Journal in 1889 and created the Dow Jones Industrial Average. His theory, developed between 1900-1902, remains the foundation of modern technical analysis. Dow Theory has six key principles.")
    P()
    P("The first principle: the market discounts everything — all information is already reflected in prices. The second principle: there are three types of trends — primary (lasting months to years), secondary (weeks to months, retracing 33-66% of the primary move), and minor (days to weeks, noise). The third principle: primary trends have three phases — accumulation (smart money buys), public participation (the masses join in), and distribution (smart money sells to the public).")
    P()
    P("The fourth principle: the indices must confirm each other — in a bull market, both the Industrial and Transportation averages must make new highs together. The fifth principle: volume must confirm the trend — volume increases in the direction of the primary trend. The sixth principle: a trend remains in effect until a clear reversal signal occurs — do not assume a trend has changed until there is concrete evidence.")
    P()
    P("Technical analysis is built on three main principles. First principle: the market reflects all information in the current price. Second principle: prices move in trends. Third principle: history repeats itself. These three principles form the foundation of technical analysis. It works in any market — stocks, forex, crypto, commodities, futures, options alike. Because it is based on human psychology, and humans trade with the same emotions across all markets — fear, greed, hope, FOMO, capitulation, euphoria.")
    P()
    DIV()
    P(V.tip("Visualize how market trends develop and reverse with the chart below."))
    IMG(V.trend_lines, 500, 200)
    P()

    # ── Part 1 Section 1.2 ──
    H2("1.2 Types of Trends: Uptrend, Downtrend, Sideways / Range")
    P()
    P("An uptrend is defined by a series of higher highs (HH) and higher lows (HL). A downtrend is defined by a series of lower highs (LH) and lower lows (LL). A sideways or ranging market has no clear HH/HL or LH/LL pattern — price oscillates between a defined support and resistance. In an uptrend, each pullback is a buying opportunity. In a downtrend, each bounce is a selling opportunity. The trend is your friend — trade in the direction of the prevailing trend.")
    P()
    P("Trend strength can be measured by the angle of the trend. A 45-degree angle is ideal — sustainable and healthy. A steep angle (60-90 degrees) is unsustainable — often followed by sharp reversals. A shallow angle (0-30 degrees) indicates a weak trend with low momentum. Use multiple time frame analysis: the daily chart shows the primary trend, the 1-hour shows the secondary trend, and the 15-minute shows the minor trend. Trade in the direction of the higher time frame.")
    P()
    P("The ADX (Average Directional Index) indicator measures trend strength. ADX > 25 indicates a strong trend. ADX < 20 indicates a weak or ranging market. ADX between 20-25 is a developing trend. The Directional Movement Index (DMI) components, +DI and -DI, show the direction. +DI > -DI indicates bullish momentum. -DI > +DI indicates bearish momentum. When ADX is rising, the trend is strengthening. When ADX is falling, the trend is weakening.")
    P()

    # ── Part 1 Section 1.3 ──
    H2("1.3 Market Structure: HH, HL, LH, LL, BOS, CHOCH")
    P()
    P("Market Structure is one of the most important foundations of technical analysis. It helps understand the trend of a market. Higher High (HH) and Higher Low (HL) indicate an uptrend. Lower High (LH) and Lower Low (LL) indicate a downtrend. Change of Character (CHoCH) indicates a trend change. Break of Structure (BOS) indicates a key structure break. These concepts are very important in both Smart Money Concepts (SMC/ICT) and the Wyckoff method.")
    P()
    DIV()
    P(V.key_point("Market Structure: HH→HL = Uptrend, LH→LL = Downtrend, CHoCH = Trend Change"))
    IMG(V.market_structure, 550, 220)
    P()

    # ── Part 1 Section 1.4 ──
    H2("1.4 Support and Resistance — Complete Guide")
    P()
    P("Support is a level below price where buying pressure exceeds selling pressure, preventing price from falling further. Resistance is a level above price where selling pressure exceeds buying pressure, preventing price from rising further. Support and Resistance are the basic building blocks of technical analysis. When support is broken, it often becomes resistance. When resistance is broken, it often becomes support — this is called role reversal.")
    P()
    DIV()
    P(V.key_point("Support and Resistance visualization: how price moves between these levels."))
    IMG(V.support_resistance, 500, 230)
    P()

    H3("Types of S/R:")
    P()
    P("Horizontal S/R levels from previous highs and lows — most basic but most effective. Trendlines connecting higher lows (support) or lower highs (resistance) in a trending market. Moving averages — 50 EMA, 100 EMA, 200 EMA act as dynamic S/R. Psychological levels — round numbers: 100, 500, 1000, 5000. Fibonacci retracement levels — 38.2%, 50%, 61.8%, 78.6%.")
    P()

    H3("S/R Identification Techniques:")
    P()
    P("Swing highs and lows — the most basic and effective approach. Look for at least two touches to confirm a level. The more touches, the stronger the level. Round numbers — 100, 500, 1000, 5000. Psychological levels are strong S/R. Previous high/low of the day/week/month. Gap fills — previous gaps act as magnets. Volume profile — high volume nodes are strong S/R. Order flow — bid/ask imbalances.")
    P()

    H3("S/R Role Reversal:")
    P()
    P("After a support level is broken, it becomes resistance. After a resistance level is broken, it becomes support. This is one of the most important concepts in S/R analysis. Example: Nifty breaks above 18,500 resistance. Now 18,500 becomes support. When price retests 18,500, you should look for buying opportunities. Role reversal with volume confirmation is very reliable.")
    P()

    H3("Strong vs Weak S/R:")
    P()
    P("Strong S/R: multiple touches (3+), higher time frame (daily/weekly), round number confluence, zone (not a line) — 10-20 point range. Weak S/R: single touch, lower time frame, no confluence. Always trade at strong S/R levels with confluence. Strong S/R increases probability dramatically.")
    P()

    # ── Part 1 Section 1.5 ──
    H2("1.5 Trendlines and Channels")
    P()
    P("An uptrend line connects higher lows — at least 2-3 lows needed for validation. A downtrend line connects lower highs — at least 2-3 highs needed. A channel combines a trendline with a parallel line on the opposite side. Rising channel: higher highs and higher lows between two parallel lines. Falling channel: lower highs and lower lows between two parallel lines. Channels indicate the current trend — trade until the channel breaks.")
    P()
    P("Trendline breaks are important signals. A break of a steep trendline is often a sign that the trend is slowing down. A break of a gradual trendline (40-50 degree angle) is more significant. Volume should increase on the break. A false break (wicks through but close back inside) is common. Wait for a close beyond the trendline. Retest of the broken trendline is common (role reversal). Entry after the retest is safer.")
    P()

    # ── Part 1 Section 1.6 ──
    H2("1.6 Price Action: The Foundation of Technical Analysis")
    P()
    P("Price action is the study of raw price movement without indicators. It is the purest form of technical analysis. Support and Resistance: horizontal levels based on swing highs/lows. Trend analysis: HH/HL = uptrend, LH/LL = downtrend. Candlestick patterns: single, double, triple candle formations. Market structure: BOS, CHOCH, liquidity zones. Price action works on any time frame and any market. It is universal. It is objective. It is the language of the market.")
    P()
    P("Indicators are derived from price action. They are secondary. Price action is primary. Using price action first, indicators for confirmation is the recommended approach. Many professional traders trade with pure price action. The best indicator is the price itself. Learn to read price action before using any indicators. This will make you a better trader in the long run.")
    P()

    # ── Part 1 Section 1.7 ──
    H2("1.7 Reversal Chart Patterns")
    P()
    P("Reversal patterns signal the end of the current trend. They appear at the end of a trend and indicate that a trend change is coming. Volume confirmation is critical for reversal pattern reliability. Once the pattern is complete (breakout), volume must increase. Otherwise, a false signal is likely.")
    P()

    H3("Head and Shoulders Top")
    P()
    P("This is the most reliable reversal pattern. Three peaks: left shoulder (moderate height), head (highest peak), right shoulder (moderate height). Neckline — the line connecting the two troughs. The pattern completes when price closes below the neckline. Target = distance from neckline to head, measured downward from the neckline.")
    P()
    DIV()
    IMG(V.head_shoulders, 450, 250)
    P()
    P("Volume analysis: moderate volume on left shoulder. Volume typically declines on the head. Volume declines further on the right shoulder. Volume must increase on the neckline break — this is confirmation. Psychology: left shoulder — 'still bullish' sentiment. Head — 'this time is different' FOMO buying. Right shoulder — enthusiasm fades, smart money slowly sells. Neckline break — fear arrives, panic selling begins.")
    P()
    P("Inverse Head and Shoulders: appears at the bottom of a bear market. Left shoulder, head (lowest trough), right shoulder trough. Neckline (resistance) break is a buy signal. Target = distance from neckline to head, measured upward.")
    P()

    H3("Double Top")
    P()
    P("Price meets resistance at a level, falls, then rises again to the same level and faces resistance again. Neckline break is a sell signal. Volume is typically lower on the second peak. At least 3 weeks between peaks is required.")
    P()
    DIV()
    IMG(V.double_top, 450, 220)
    P()

    H3("Double Bottom")
    P()
    P("Price finds support at a level, bounces, then falls again to the same level and finds support again. Break above the neckline is a buy signal. Volume is typically lower on the second trough.")
    P()
    DIV()
    IMG(V.double_bottom, 450, 220)
    P()

    H3("Rounding Bottom / Saucer")
    P()
    P("A gradual, step-by-step bottom formation — weeks or months. 'U' shape. Precedes an uptrend. Volume gradually increases. Very reliable — shows smart money accumulating slowly.")
    P()

    # ── Part 1 Section 1.8 ──
    H2("1.8 Continuation Chart Patterns")
    P()
    P("Continuation patterns appear in the middle of a trend. The trend takes a brief pause and then continues. These are 'rest' patterns — the trend's energy is replenished. Continuation patterns are highly reliable.")
    P()

    H3("Flags and Pennants")
    P()
    P("Bull Flag: sharp nearly vertical move (flagpole), followed by a small rectangular consolidation (flag) tilted against the trend. Volume decreases in the flag, increases on the breakout. Target = flagpole height. Pennant: sharp move (pole), followed by a small symmetrical triangle (pennant). Same volume pattern.")
    P()

    H3("Triangles")
    P()
    P("Ascending Triangle: flat resistance + rising lows. Bullish. Breakout upward. Descending Triangle: flat support + declining highs. Bearish. Breakout downward. Symmetrical Triangle: declining highs + rising lows. Breakout direction uncertain. Enter on breakout with volume confirmation.")
    P()
    DIV()
    IMG(V.triangle, 380, 220)
    P()

    H3("Wedges")
    P()
    P("Rising Wedge: higher highs and higher lows but converging. Bearish. Volume declines. Common at the end of uptrends. Falling Wedge: lower highs and lower lows but converging. Bullish. Common at the end of downtrends.")
    P()

    H3("Cup and Handle")
    P()
    P("U-shaped bottom (cup) → small consolidation (handle). Multi-month pattern. The cup should be 'U' shaped (gradual accumulation). The handle should slope downward (shaking out weak holders). Buy on handle breakout. Very bullish pattern.")
    P()
    DIV()
    IMG(V.cup_handle, 400, 220)
    P()

    H3("Gap Patterns")
    P()
    P("Breakaway Gap: gap breakout from key S/R level. High volume. Start of a new trend. Usually not filled. Runaway Gap: middle of a trend. Strong momentum. Often the midpoint of the trend. Exhaustion Gap: end of a trend. Quickly filled. Signals trend exhaustion. Common Gap: low volume in a range. Always filled. Ignore.")
    P()

    # ── Part 1 Section 1.9 ──
    H2("1.9 Harmonic Patterns")
    P()
    P("Harmonic patterns use specific Fibonacci ratios to identify potential reversal zones (PRZ) at point D. Precise Fibonacci measurement is required. Even a small error can completely change the pattern. Different analysts may draw different patterns.")
    P()
    DIV()
    IMG(V.fibonacci, 480, 240)
    P()
    TBL(V.fib_retracement_table)
    P()
    P("ABCD Pattern (AB=CD): basic pattern. AB leg → BC retracement (0.382-0.886) → CD leg. AB = CD ideally. BC = 0.618 or 0.786 of AB. CD = 1.272 or 1.618 of BC. Point D = PRZ.")
    P()
    P("Gartley Pattern (222): XA leg → AB retracement (0.618) → BC extension → CD. PRZ at D = 0.786 retracement of XA. Discovered by H.M. Gartley.")
    P()
    P("Bat Pattern: D at 0.886 retracement of XA (deeper than Gartley). Discovered by Scott Carney.")
    P()
    P("Butterfly Pattern: D extends beyond X (full retracement). PRZ at D: 1.272-1.618 extension of XA. Discovered by Bryce Gilmore.")
    P()
    P("Crab Pattern: deep pattern — D at 1.618 extension of XA. CD = 2.618-3.618 extension of BC. Discovered by Scott Carney.")
    P()
    P("Cypher Pattern: uses X-C retracement (0.786) instead of X-A. Newer pattern. Reliable.")
    P()
    P("Important warning: Harmonic patterns are subjective. Different analysts may draw different points. Use in conjunction with other methods (S/R, candlestick patterns, volume). Do not trade based on harmonic patterns alone.")
    P()

    # ── Part 1 Section 1.10 ──
    H2("1.10 Elliott Wave Theory — Foundations")
    P()
    P("Ralph Nelson Elliott's Elliott Wave Theory states that market movements move in 5-wave impulsive and 3-wave corrective patterns. Waves are fractal — each wave contains smaller waves. Market sentiment moves cyclically from optimism to pessimism.")
    P()
    P("Impulse Waves (5 waves): Waves 1, 3, 5 — in trend direction. Wave 3 is the longest (never the shortest). Wave 1 is the start of a new trend. Wave 3 is the most powerful. Wave 5 is the final stage — energy declines.")
    P()
    P("Corrective Waves (3 waves): Waves 2 and 4 — against the trend. Wave 2 is typically sharp (V-shaped). Wave 4 is typically sideways consolidation. Alternation rule: Waves 2 and 4 alternate in form.")
    P()
    P("Fibonacci relationships: Wave 2 = 50-61.8% of Wave 1. Wave 3 = 1.618-2.618% of Wave 1. Wave 4 = 38.2-50% of Wave 3. Wave 5 = 0.618-1.618% of Wave 1. These are guidelines, not rules.")
    P()
    DIV()
    P(V.tip("5-wave Impulse + 3-wave Corrective: Complete Elliott Wave cycle diagram"))
    IMG(V.elliott_wave, 550, 220)
    P()

    # ── Pattern Reliability Table ──
    DIV()
    P(V.key_point("Chart Patterns Reliability: reliability and success rates of various patterns"))
    TBL(V.pattern_reliability_table)
    P()
    HR()
    P()

    # ── Part 2 intro ──
    P("Candlestick patterns are a powerful tool for understanding market sentiment. Each candle tells a story — the story of the battle between buyers and sellers. A long body candle shows one side winning. A small body candle shows indecision. A long shadow (wick) candle shows one side trying and failing.")
    P()
    P("Candlestick patterns can be divided into three categories: single candle patterns, double candle patterns, and triple candle patterns. Single candle patterns show market sentiment in one day. Double candle patterns show sentiment change over two days. Triple candle patterns confirm a complete sentiment change. Each pattern is only reliable in specific market conditions.")
    P()
    P("A trader should not trade based on candlestick patterns alone. Volume confirmation, support and resistance levels, and trend direction are very important for patterns. A bullish engulfing pattern at support is much more reliable than the same pattern in the middle of nowhere. Understanding context is the key to success.")
    P()

    # ══════════════════════════════════════
    # PART 2: CANDLESTICK PATTERNS
    # ══════════════════════════════════════
    H1("Part 2: Candlestick Patterns")
    H2("(Single Candle, Double Candle, Triple Candle Patterns, Story Reading, Body and Shadow Analysis)")
    P()
    HR()
    P()

    H2("2.1 History and Basics of Candlesticks")
    P()
    DIV()
    P(V.key_point("Candlestick chart: Open, High, Low, Close. Real Body + Shadows/Wicks."))
    IMG(V.candle_chart, 500, 240)
    P()
    P("The candlestick chart was created by Japanese rice trader Munehisa Homma in the 18th century. Homma traded rice futures and amassed a great fortune — he discovered that weather alone was not the cause of price movements, but human emotions were. His Sakata methods remain the foundation of candlestick analysis today. Candlestick charts provide more information than bar charts. A single candle shows all four data points — open, high, low, close — and their relationship clearly reveals market sentiment.")
    P()

    H3("Anatomy of a candle:")
    P()
    P("Real Body: the range between open and close. Long body = strong momentum. Short body = consolidation/indecision. Upper Shadow (Wick): high to close (bearish candle) or high to open (bullish candle). Long upper shadow = rejection of higher prices. Lower Shadow: low to open (bearish candle) or low to close (bullish candle). Long lower shadow = rejection of lower prices.")
    P()
    P("Marubozu: no shadow — open = high/low or close = high/low. Very strong momentum. Spinning Top: small body with long shadows. Indecision. Doji: open = close (or very close). Perfect indecision. Long-legged Doji: long upper and lower shadows. Very high volatility.")
    P()

    H3("Single candle patterns:")
    P()
    P("Hammer: small body at the top of the range, long lower shadow (2-3x body). Bullish at support. Appears in downtrends. Psychology: sellers pushed price down during the session, but buyers fought back and pushed it back up. The hammer indicates that the selling pressure was absorbed — buyers are stepping in.")
    P()
    P("Shooting Star: small body at the bottom of the range, long upper shadow (2-3x body). Bearish at resistance. Appears in uptrends. Psychology: buyers pushed price up during the session, but sellers fought back and pushed it back down. The shooting star indicates that the buying pressure was rejected — sellers are stepping in.")
    P()
    P("Bullish Marubozu: long body, no shadow. Very strong buying. Bearish Marubozu: long body, no shadow. Very strong selling.")
    P()

    H3("Double candle patterns:")
    P()
    P("Bullish Engulfing: second candle completely engulfs the first candle's body. Break of structure — first candle shows continuation, second candle shows rejection and reversal. Bearish Engulfing: opposite.")
    P()
    P("Piercing Line: first candle bearish, second candle opens lower but closes above the midpoint of the first candle. Bullish at support. Dark Cloud Cover: opposite — bearish at resistance.")
    P()

    H3("Triple candle patterns:")
    P()
    P("Morning Star: long bearish candle → small indecision candle (doji/spinning top) → long bullish candle. Strong bullish reversal. Evening Star: opposite — strong bearish reversal.")
    P()
    P("Three White Soldiers: three consecutive long bullish candles. Very strong bullish momentum. Three Black Crows: three consecutive long bearish candles. Very strong bearish momentum.")
    P()

    H3("Continuation patterns:")
    P()
    P("Rising Three Methods: long bullish → three small bearish (within range) → long bullish breaking above. Bullish continuation. Falling Three Methods: opposite. Bearish continuation.")
    P()

    H3("Story reading — combining candles:")
    P()
    P("Context is everything: support/resistance confluence, volume confirmation, trend alignment. Example: Hammer at support + high volume + RSI oversold + 50EMA support = high probability long setup. Never trade patterns in isolation. Always consider the context. Higher time frame pattern is more reliable. Price action + volume + candlestick pattern = high probability trade.")
    P()

    # ══════════════════════════════════════
    # PART 3: INDICATORS & TOOLS
    # ══════════════════════════════════════
    H1("Part 3: Indicators & Tools")
    H2("(RSI, MACD, Moving Averages, Bollinger Bands, Fibonacci, Volume, ADX, ATR, Ichimoku, FII/DII)")
    P()
    HR()
    P()

    # ── Part 3 intro ──
    P("Indicators are mathematical calculations based on price and volume. They are secondary to price action. Use them for confirmation, not as primary signals. When combined with proper context, indicators can significantly improve trade timing. However, cluttering your chart with too many indicators leads to analysis paralysis. Choose 2-3 indicators that complement your strategy and master them.")
    P()

    H2("3.1 Indicator Basics")
    P()
    P("Leading indicators: RSI, Stochastic, CCI — give early signals but more false signals. Lagging indicators: MACD, MA, Ichimoku — give late signals but more reliable. Use leading for entry timing, lagging for trend confirmation. The best combination: one leading (momentum), one lagging (trend), and volume. Triple confirmation increases probability significantly.")
    P()

    H2("3.2 RSI — Relative Strength Index")
    P()
    P("RSI was created by J. Welles Wilder in 1978. It compares recent gains and losses and calculates a value between 0-100. It is a momentum oscillator — measuring the speed of price movement. RSI averages gains over losses over a specific period (typically 14) and normalizes the result.")
    P()
    DIV()
    IMG(V.rsi_chart, 500, 260)
    P()
    TBL(V.rsi_divergence_table)
    P()

    H3("RSI basic uses:")
    P()
    P("Overbought (RSI > 70): price has risen too fast — pullback possible. In an uptrend, RSI can stay above 70 for weeks. Alone, this is not a sell signal.")
    P()
    P("Oversold (RSI < 30): price has fallen too fast — bounce possible. In a downtrend, RSI can stay below 30 for weeks.")
    P()
    P("50 Center Line (RSI = 50): RSI above 50 = bullish internal strength. RSI below 50 = bearish internal strength. RSI crossing 50 can indicate trend change.")
    P()

    H3("RSI Divergence — the most powerful signal:")
    P()
    P("Bullish Divergence: price makes a new low — RSI makes a higher low. Selling momentum is declining. 'Price lower but internal strength higher.' Divergence after 16-17 day retracement is most reliable.")
    P()
    P("Bearish Divergence: price makes a new high — RSI makes a lower high. Buying momentum is declining. 'Price higher but internal strength lower.'")
    P()

    H3("RSI trading strategies:")
    P()
    P("Strategy 1 (Simple): oversold + RSI crosses above 30 = buy. Overbought + RSI crosses below 70 = sell. Simple but needs trend filter. Only take longs when 50EMA is rising. Only take shorts when 50EMA is falling.")
    P()
    P("Strategy 2 (Divergence): find divergence → wait for confirmation (trendline break, candle pattern) → enter. Stop beyond the swing high/low. Target next S/R level. Higher time frame divergence is more powerful. Daily divergence = strong signal. 1-hour divergence = moderate.")
    P()

    H2("3.3 MACD — Moving Average Convergence Divergence")
    P()
    P("MACD was created by Gerald Appel in the 1970s. It has three components: MACD line (12-day EMA − 26-day EMA), Signal line (9-day EMA of MACD), and histogram (MACD − Signal). MACD is a trend-following momentum indicator — not an oscillator.")
    P()
    DIV()
    IMG(V.macd_chart, 500, 260)
    P()

    H3("MACD uses:")
    P()
    P("Signal line crossover: MACD line above signal line = bullish. MACD line below signal line = bearish. Histogram changes from negative to positive = momentum shift. Histogram changes from positive to negative = momentum decline.")
    P()
    P("Zero line crossover: MACD line above zero = momentum is bullish. MACD line below zero = momentum is bearish. Crossing above zero = uptrend confirmed. Crossing below zero = downtrend confirmed.")
    P()
    P("MACD Divergence: price makes higher high — MACD makes lower high = bearish divergence (weakening momentum). Price makes lower low — MACD makes higher low = bullish divergence (weakening momentum). MACD divergence is less common than RSI divergence but more reliable when it occurs.")
    P()

    H2("3.4 Moving Averages — SMA and EMA")
    P()
    P("Moving Averages are the simplest yet most useful tool. They smooth price and clarify the trend. SMA (Simple Moving Average) gives equal weight to all prices in the period. EMA (Exponential Moving Average) gives more weight to recent prices — more responsive but can generate more false signals.")
    P()
    DIV()
    TBL(V.ma_crossover_table)
    P()

    H3("SMA vs EMA — which to use?")
    P()
    P("SMA: long-term analysis (50, 100, 200-day). Slower but more reliable. Acts as key S/R levels. EMA: short-term trading (9, 12, 26-day). Faster but more false signals. For swing trading, use SMA for longer periods, EMA for shorter periods.")
    P()

    H3("Key moving averages and their uses:")
    P()
    P("9-day EMA: short-term trend. Used by intraday and short-term traders. Very respected on NSE/BSE.")
    P("20/21-day MA: one-month average. Baseline for swing trading. Center line of Bollinger Bands.")
    P("50-day MA: medium-term trend. Respected by institutional investors. Price > 50MA = medium-term uptrend.")
    P("100-day MA: medium-long term trend. Helps identify long-term pullbacks.")
    P("200-day MA: key boundary of long-term trend. 200MA is the most important S/R level. Price > 200MA = long-term uptrend. Death cross (50MA crossing below 200MA) = long-term downtrend.")
    P()

    H3("MA Crossover strategies:")
    P()
    P("Golden Cross: 50MA crosses above 200MA = long-term bullish signal. Death Cross: 50MA crosses below 200MA = long-term bearish signal. Pullback to MA: buy the first/second pullback to rising 50MA. Price tends to respect the 50MA in a strong trend. MA + Price Action: 50MA acts as key S/R — bounce or break. Combine MA with candlestick patterns for high probability entries.")
    P()

    H2("3.5 Bollinger Bands")
    P()
    P("Bollinger Bands were created by John Bollinger. Three lines: middle (20-day SMA), upper (middle + 2 standard deviations), lower (middle − 2 standard deviations). Standard deviation adjusts bands to volatility — wider in high volatility, narrower in low volatility. Bands contain about 95% of price action under normal conditions.")
    P()
    P("Squeeze: bands narrow (low volatility) → expansion follows (high volatility). Start of a new trend. Breakout direction is the new trend. Squeeze is a setup, not a signal. Wait for the breakout direction. Walk the bands: price walking along upper band = strong uptrend. Price walking along lower band = strong downtrend. Band touch: touching upper band in an uptrend = not a sell signal. Touching lower band in a downtrend = not a buy signal. W bottom / M top patterns with bands.")
    P()

    H2("3.6 Fibonacci Retracement and Extensions")
    P()
    P("Fibonacci levels are based on the mathematical sequence discovered by Leonardo Fibonacci. Key ratios: 0.382 (38.2%), 0.500 (50%), 0.618 (61.8%), 0.786 (78.6%), 1.272 (127.2%), 1.618 (161.8%). 61.8% is the 'golden ratio' — the most important level. It appears throughout nature, art and architecture. The market respects it.")
    P()
    P("Fibonacci retracement: in an uptrend, draw from swing low to swing high — levels show potential support. In a downtrend, draw from swing high to swing low — levels show potential resistance. 50% is psychological but not a true Fibonacci level. 61.8% is the most important — deep retracements often stop here. 78.6% is the deepest retracement before the trend is considered broken.")
    P()
    P("Fibonacci extension: in an uptrend, draw from swing low → swing high → retracement low → levels show potential targets. 127.2% and 161.8% are common targets. Fibonacci confluence: when multiple Fib levels from different swings align at the same price. Very strong S/R. Price tends to respect confluence zones.")
    P()

    H2("3.7 Volume-Based Indicators")
    P()
    P("Volume is the most honest indicator. It cannot be hidden. Price can be manipulated but volume tells the truth. Rising volume + rising price = healthy uptrend. Rising volume + falling price = healthy downtrend. Declining volume + rising price = weak uptrend (divergence). Declining volume + falling price = weak downtrend (divergence).")
    P()

    H3("OBV — On-Balance Volume:")
    P()
    P("Running total of volume: up day volume added, down day volume subtracted. OBV confirming price = healthy trend. OBV diverging from price = trend weakening. Bullish divergence: price makes lower low, OBV makes higher low. Bearish divergence: price makes higher high, OBV makes lower high. OBV leading price: often OBV turns before price.")
    P()

    H3("Volume Profile:")
    P()
    P("High Volume Node (HVN): most traded price zone. Acts as strong S/R. Low Volume Node (LVN): least traded zone. Price moves through quickly. Point of Control (POC): highest volume price. The most important level. Value Area: 70% of volume around POC. Value Area High/Low act as S/R.")
    P()

    H3("Volume Spread Analysis (VSA):")
    P()
    P("Upthrust: wide spread + high volume at resistance = distribution. Stopping Volume: wide spread + very high volume at a low = accumulation. No Demand: narrow spread + low volume at resistance = weak. No Supply: narrow spread + low volume at support = strong.")
    P()

    H2("3.8 ADX — Average Directional Index")
    P()
    P("ADX measures trend strength (not direction). 0-100 scale. Created by J. Welles Wilder. ADX > 25 = trending market (use trend-following strategies). ADX < 20 = ranging market (use mean-reversion strategies). ADX rising = trend strengthening. ADX falling = trend weakening. +DI > -DI = bullish bias. -DI > +DI = bearish bias. ADX crossing above 25 = trend start. This is the most important signal.")
    P()

    H2("3.9 ATR — Average True Range")
    P()
    P("ATR measures volatility. Created by J. Welles Wilder. True Range = max of: High − Low, |High − Previous Close|, |Low − Previous Close|. ATR = 14-period average of True Range. Higher ATR = higher volatility. Stop loss placement: 1.5-2 × ATR. Position sizing: use ATR to adjust size based on volatility. Breakout confirmation: breakout + ATR expansion = strong breakout. Pairs trading: compare ATR for position sizing across instruments.")
    P()

    H2("3.10 Momentum Indicators — Stochastic, CCI, ROC")
    P()
    P("Stochastic Oscillator: %K = (Close − Lowest Low) / (Highest High − Lowest Low) × 100. Fast. Overbought > 80, Oversold < 20. %D is SMA of %K. Bullish: %K crosses above %D in oversold. Bearish: %K crosses below %D in overbought.")
    P()
    P("CCI (Commodity Channel Index): measures deviation from statistical mean. Overbought > 100, Oversold < −100. CCI crossing above 100 = bullish breakout. CCI crossing below −100 = bearish breakdown.")
    P()
    P("ROC (Rate of Change): (Close / Close-n) × 100. Crossing above/below 100 = momentum change. Increasing slope = momentum increasing. Zero line crossing = direction change.")
    P()

    H2("3.11 Ichimoku Cloud")
    P()
    P("Ichimoku Kinko Hyo was developed by Goichi Hosoda in 1968. 'One glance equilibrium chart.' Five lines: Tenkan-sen (Conversion Line) = (9 high + 9 low)/2. Kijun-sen (Base Line) = (26 high + 26 low)/2. Senkou Span A (Leading Span A) = (Tenkan + Kijun)/2 plotted 26 periods ahead. Senkou Span B (Leading Span B) = (52 high + 52 low)/2 plotted 26 periods ahead. Chikou Span (Lagging Span) = current close plotted 26 periods behind.")
    P()
    P("Price above cloud = uptrend. Price below cloud = downtrend. Price inside cloud = ranging. Cloud color: green/blue cloud = bullish (Span A > Span B). Red cloud = bearish (Span A < Span B). Tenkan crossing above Kijun = bullish signal. Chikou above price = bullish confirmation. The cloud provides future S/R levels.")
    P()

    H2("3.12 Parabolic SAR (Stop and Reverse)")
    P()
    P("Parabolic SAR was created by J. Welles Wilder. It shows potential reversals. Dots below price = uptrend. Dots above price = downtrend. Acceleration Factor (AF) starts at 0.02, increases by 0.02 with each new high/low, max 0.20. Best used in strong trends. In ranging markets, it gives many false signals. Use as a trailing stop.")
    P()

    H2("3.13 FII/DII and Market Breadth Analysis")
    P()
    P("FII (Foreign Institutional Investors) and DII (Domestic Institutional Investors) data is crucial for the Indian market. FII buying = bullish market sentiment. DII buying = support from domestic institutions. FII index futures data shows short-term market direction. FII/DII cash market data shows long-term trend.")
    P()
    P("Market Breadth: Advance-Decline ratio (A/D ratio) — number of advancing stocks vs declining stocks. A/D ratio > 1.5 = broad market strength. A/D ratio < 0.5 = broad market weakness. Difference between Nifty and A/D ratio = divergence.")
    P()

    # ══════════════════════════════════════
    # PART 4: TRADING SYSTEMS
    # ══════════════════════════════════════
    H1("Part 4: Trading Systems")
    H2("(SMC/ICT Concepts, Wyckoff Method, Supply & Demand, Risk Management, Trading Psychology, Setups)")
    P()
    HR()
    P()

    # ── Part 4 intro ──
    P("A trading system is a set of rules that define when to enter, where to place the stop loss, and where to take profit. A good system is mechanical — removes emotions. A great system adapts to market conditions. Below are the most powerful trading systems used by professional traders.")
    P()

    H2("4.1 Smart Money Concepts (SMC/ICT)")
    P()
    P("Smart Money Concepts (SMC) is a trading system developed by Michael Huddleston (Inner Circle Trader — ICT). It explains how 'smart money' (institutions, banks, hedge funds) moves in the market and how they use retail traders. SMC helps understand the inner workings of the market better than traditional technical analysis.")
    P()
    DIV()
    P(V.key_point("ICT Concepts: Market Structure, Liquidity Zones, Order Blocks, Fair Value Gaps"))
    IMG(V.market_structure, 550, 220)
    P()
    P(V.tip("FVG (Fair Value Gap) example: how price fills the gap."))
    P(V.worked_fvg_example())
    P()

    H3("ICT core concepts:")
    P()
    P("1. Market Structure: HH, HL, LH, LL — understanding market trend. BOS (Break of Structure) = price breaking recent swing high/low. CHOCH (Change of Character) = market trend change. Retail traders chase BOS — smart money enters after CHOCH.")
    P()
    P("2. Liquidity Zones: areas where price lingers — where stop losses are stacked. Buy-side liquidity: above swing highs — traps retail longs. Sell-side liquidity: below swing lows — traps retail shorts. ICT: 'Price moves for liquidity, nothing else.'")
    P()
    P("3. Order Block (OB): the last candle before a move — where institutions placed their large orders. Bullish OB: last bearish candle before an uptrend. Bearish OB: last bullish candle before a downtrend. OBs act as S/R.")
    P()
    P("4. Fair Value Gap (FVG): three consecutive candles — the middle candle's gap not fully covered. Bullish FVG: middle candle low > first candle high and third low > middle high. Bearish FVG: middle candle high < first candle low and third high < middle low. Price returns to fill FVG.")
    P()

    H3("ICT Institutional Order Flow:")
    P()
    P("Accumulation: market bottom — institutions slowly buy. Phase A: first rally (S/R shift). Phase B: retracement (last liquidity grab). Phase C: markup — BOS. Phase D: distribution — institutions sell. Phase E: markdown.")
    P()
    P("Judas Swing: false breakout — traps retail. FOMO entry then stop loss. Entry: after Judas swing, opposite direction of the false breakout.")
    P()
    P("Asian/London/Killzone: ICT trading sessions: Asian session (8 PM — 2 AM EST) — range. London open (2 AM EST) — first move. New York open (7 AM EST) — liquidity grab. New York close (12 PM EST) — reversal. Ammunition session (2 AM — 5 AM EST) — real move.")
    P()

    H3("ICT trading strategy:")
    P()
    P("1. Identify daily PD Array (Premium/Discount) — 0.5 Fibonacci division. 2. Expect setup in London/New York killzone. 3. FVG + OB + Liquidity sweep = high probability entry. 4. Entry: after FVG fill, at OB. 5. Stop loss: below/above OB. 6. Target: next liquidity zone (opposite side).")
    P()

    H3("ICT 2022 Buy/Sell Model:")
    P()
    P("Bullish: Sell-side liquidity sweep → FVG → OB bounce → BOS → target buy-side liquidity. Bearish: Buy-side liquidity sweep → FVG → OB rejection → CHOCH → target sell-side liquidity.")
    P()

    H2("4.2 Wyckoff Method")
    P()
    P("Richard Wyckoff studied stock market operations in the 1930s and developed a methodology. Wyckoff centers on the 'Composite Operator' (smart money) concept. Wyckoff is based on three laws: the law of supply and demand, the law of cause and effect, and the law of effort vs result.")
    P()
    DIV()
    P(V.key_point("Wyckoff Cycle: Accumulation → Markup → Distribution → Markdown"))
    IMG(V.wyckoff, 550, 230)
    P()

    H3("Wyckoff Accumulation sequence:")
    P()
    P("Phase A: selling climax (final drop — volume spike). Automatic Rally (AR) — price bounces. Secondary Test (ST) — test of AR low.")
    P()
    P("Phase B: accumulation range — buying and selling balance. Spring/Shakeout — false breakout below range. High volume + narrow range = buying. Low volume + narrow range = waiting.")
    P()
    P("Phase C: Spring — false breakdown below ST. UTAD (Upthrust After Distribution) — false breakout above.")
    P()
    P("Phase D: LPS (Last Point of Support) — final pullback before markup. Relative strength — stock stronger than market. Volume decreases on pullback.")
    P()
    P("Phase E: Markup — price breaks above range. Volume increases. Pullbacks are shallow. New highs confirmed.")
    P()

    H3("Wyckoff Distribution sequence:")
    P()
    P("Phase A: buying climax (final rise — volume spike). Automatic Reaction (AR) — price drops. Secondary Test (ST) — test of AR high (lower volume).")
    P()
    P("Phase B: distribution range — supply overcomes demand. UTAD (Upthrust After Distribution) — false breakout above range.")
    P()
    P("Phase C: UTAD — false breakout above ST. Spring — false breakdown below (bull trap).")
    P()
    P("Phase D: LUT (Last Point of Upthrust) — final rally before markdown. Relative weakness — stock weaker than market.")
    P()
    P("Phase E: Markdown — price breaks below range. Volume increases. Bounces are shallow. New lows confirmed.")
    P()

    H2("4.3 Supply and Demand Trading")
    P()
    P("Supply and Demand zones are larger than order blocks — they represent major institutional activity. Supply zone (resistance): where selling pressure exceeds buying pressure significantly. Demand zone (support): where buying pressure exceeds selling pressure significantly.")
    P()
    P("Key principles: fresh zones are stronger than tested zones. The first test is the most reliable. The stronger the move away from the zone, the stronger the zone. Time spent at the zone (base) — longer base = stronger zone. Rally-Base-Rally (RBR) = demand zone. Drop-Base-Drop (DBD) = supply zone. Rally-Base-Drop (RBD) = supply zone. Drop-Base-Rally (DBR) = demand zone.")
    P()

    H2("4.4 Risk Management")
    P()
    P("Risk management is the most important skill. It protects capital. Risk-reward ratio (R:R), position sizing, stop loss, take profit, maximum drawdown — these are a trader's weapons.")
    P()
    DIV()
    P(V.tip("Position Sizing and R:R tables every trader should know"))
    TBL(V.position_sizing_table)
    P()
    TBL(V.rr_table)
    P()

    H3("Position Sizing — Kelly Criterion:")
    P()
    P("Kelly % = W − (1 − W) / R. W = win rate, R = R:R (average win/average loss). Example: W=0.5, R=2 → Kelly = 0.5 − 0.5/2 = 0.25. Modified Kelly: 25% of Kelly. Trader with 55% win rate, R:R=1.5 → Kelly = 0.55 − 0.45/1.5 = 0.25 → 25% → Modified = 6.25%.")
    P()

    H3("Position Sizing:")
    P()
    P("Lot size = account_risk / (stop_loss_pips × pip_value). NSE position sizing: Quantity = (account_risk) / (entry − stop). Max loss per trade: 1-2% of capital. Max daily loss: 4-6% of capital. Max weekly loss: 8-12%. Max drawdown: 20% — stop trading.")
    P()
    DIV()
    P(V.tip("Position Sizing Worked Example — 1,00,000 capital, 2% risk per trade, Entry 150, Stop 140"))
    P(V.worked_position_sizing())
    P()

    H3("Fixed Fractional vs Fixed Ratio:")
    P()
    P("Fixed Fractional: Risk (%) × capital = position. Fixed Ratio: equity increases → position size increases by a fixed interval. Fixed Fractional simple and effective. Fixed Ratio fast compounder but higher risk.")
    P()

    H2("4.5 Trading Psychology")
    P()
    P("Trading psychology teaches emotion management. Mark Douglas: 'The market doesn't care about you. Follow your rules.' FOMO, revenge trading, analysis paralysis, confirmation bias — these are psychological failures.")
    P()

    H3("Psychological Biases:")
    P()
    P("Greed: ignoring risk management. Fear: not taking good setups. FOMO: late entry. Revenge Trading: impulsive trading after loss. Analysis Paralysis: delay in decision making. Confirmation Bias: only seeing data that supports your belief.")
    P()

    H3("Psychological Rules:")
    P()
    P("1. Create and follow a trading plan. 2. Define risk before entry. 3. Accept losses — they are part of the game. 4. Learn from losses instead of blaming. 5. Journal every trade — screenshots, setup, entry, management, exit, psychology. 6. Evaluate weekly — performance review. 7. Continuous improvement — never stop learning.")
    P()

    H2("4.6 Trading Setups — Complete Entry Framework")
    P()
    P("Setup Type 1 — Trend Continuation: price is in a strong uptrend. Price pulls back to 50 EMA or Fibonacci 38.2-61.8%. Bullish candlestick pattern appears (hammer, engulfing). Volume decreasing on pullback, increasing on bounce. RSI respects 50 level or oversold. Aggressive entry: at the candlestick close. Conservative entry: after first green candle. Stop loss: below the pullback low. Target: previous high or next S/R level.")
    P()
    P("Setup Type 2 — Support/Resistance Reversal: price approaches a strong S/R level. Bearish/bullish rejection candle at S/R. Volume confirms the rejection. Divergence (if applicable). Entry: at rejection candle close. Stop loss: beyond the level (5-10 points depending on timeframe). Target: next S/R level in the opposite direction. Risk-reward: minimum 1:2.")
    P()
    P("Setup Type 3 — Breakout: price breaks a key level or pattern. Volume must be higher than average. Retest of the level (role reversal). Entry on retest confirmation. Stop loss: inside the pattern/level. Target: measured move or next level.")
    P()
    P("Setup Type 4 — SMC/ICT: liquidity sweep at a key level. FVG identification. Order block entry. Stop loss beyond OB. Target: opposite liquidity zone.")
    P()
    P("High probability confluence checklist: trend direction (higher time frame), key S/R level, volume confirmation, candlestick pattern, indicator alignment, risk-reward > 1:2. Score: 6/6 = exceptional setup. Score: 4-5/6 = good setup. Score: < 4/6 = skip.")
    P()

    # ══════════════════════════════════════
    # PART 5: FUNDAMENTAL ANALYSIS
    # ══════════════════════════════════════
    H1("Part 5: Fundamental Analysis")
    H2("(PE/PB Ratios, ROE/ROCE, DCF, Piotroski F-Score, Altman Z-Score, Graham Number, Portfolio Construction)")
    P()
    HR()
    P()

    # ── Part 5 intro ──
    P("Fundamental analysis studies the financial health of a company. It calculates intrinsic value and compares it with market price. Benjamin Graham — the father of value investing — laid the foundation in his book 'The Intelligent Investor.' Warren Buffett is the most famous practitioner.")
    P()

    H2("5.1 Financial Statements")
    P()
    P("P&L Statement: revenue, expenses, profit. Revenue growth = company growth. Operating profit margin = business efficiency. Net profit = final profit. Balance Sheet: assets, liabilities, equity. Current ratio = current assets / current liabilities (> 1 = good). Debt-to-equity = total debt / shareholder equity (< 1 = good for most sectors). Cash Flow Statement: operating, investing, financing cash flows. Operating cash flow should be positive and growing.")
    P()

    H2("5.2 Key Valuation Ratios")
    P()

    H3("PE Ratio (Price-to-Earnings):")
    P()
    P("PE = Price per Share / Earnings per Share (EPS). PE shows how much you are willing to pay per rupee of earnings. PE 15-20 = average. PE < 10 = undervalued (may have issues). PE > 30 = overvalued (may have high growth). Nifty PE at 10 = extreme undervalue. Nifty PE at 25+ = overvalued. Compare within sectors. PEG ratio = PE / Growth rate. PEG < 1 = undervalued.")
    P()
    DIV()
    P(V.tip("PE Ratio Bands: different PE levels and their implications"))
    TBL(V.pe_bands_table)
    P()

    H3("PB Ratio (Price-to-Book):")
    P()
    P("PB = Price per Share / Book Value per Share. Book Value = Total Assets − Total Liabilities. PB < 1 = trading below liquidation value. Important for banks and financials. Nifty 50 median PB = 2.5-3.5. PB + ROE combination for financial stocks.")
    P()

    H3("Dividend Yield:")
    P()
    P("Dividend Yield = Annual Dividend per Share / Price per Share × 100. High yield = 4%+. Low yield = < 1%. Payout ratio = Dividend / EPS. Sustainable payout ratio < 60%. High dividend yield + low payout ratio = safe.")
    P()

    H3("EV/EBITDA (Enterprise Value / EBITDA):")
    P()
    P("EV = Market Cap + Total Debt − Cash. EBITDA = Earnings Before Interest, Tax, Depreciation, Amortization. EV/EBITDA includes debt in valuation. EV/EBITDA < 10 = undervalued. EV/EBITDA > 20 = overvalued. Compare within sectors.")
    P()

    H2("5.3 Profitability Ratios")
    P()

    H3("ROE (Return on Equity):")
    P()
    P("ROE = Net Profit / Shareholder Equity × 100. ROE > 15% = good. ROE > 20% = excellent. DuPont Analysis: ROE = Net Profit Margin × Asset Turnover × Financial Leverage. High ROE from high leverage is risky. Sustainable ROE from high margins is best. ROE + PB combination: PB < 3 and ROE > 15% = good value.")
    P()

    H3("ROCE (Return on Capital Employed):")
    P()
    P("ROCE = EBIT / (Total Assets − Current Liabilities) × 100. ROCE shows how efficiently capital is used. ROCE > 15% = good. ROCE > 20% = excellent. ROCE should be higher than the cost of capital. ROCE > WACC = value creation.")
    P()

    H2("5.4 DCF Valuation")
    P()
    P("DCF calculates a company's intrinsic value by discounting future cash flows to present value. DCF = Σ (FCF_t / (1 + r)^t). r = WACC (Weighted Average Cost of Capital). Terminal Value = FCF_n × (1 + g) / (r − g). Intrinsic Value per Share = DCF / Shares Outstanding. DCF is very sensitive to inputs. Conservative assumptions = better. Margin of safety = intrinsic value − market price.")
    P()

    H2("5.5 Piotroski F-Score")
    P()
    P("Joseph Piotroski developed this 9-point score for identifying strong value stocks. Profitability (4 points): positive net income (1), positive operating cash flow (1), ROE increasing (1), cash flow > net income (1). Leverage/Liquidity (3 points): long-term debt decreasing (1), current ratio increasing (1), no new shares issued (1). Operating Efficiency (2 points): gross margin increasing (1), asset turnover increasing (1). F-Score 8-9 = very strong. F-Score 0-3 = very weak.")
    P()

    H2("5.6 Altman Z-Score")
    P()
    P("Edward Altman developed the Z-Score to predict bankruptcy. Z = 1.2A + 1.4B + 3.3C + 0.6D + 1.0E. A = Working Capital / Total Assets. B = Retained Earnings / Total Assets. C = EBIT / Total Assets. D = Market Cap / Total Liabilities. E = Sales / Total Assets. Z > 2.99 = safe. Z < 1.81 = distress. Grey zone: 1.81-2.99.")
    P()

    H2("5.7 Graham Number")
    P()
    P("Benjamin Graham's formula for maximum fair price: Graham Number = sqrt(22.5 × EPS × BVPS). 22.5 comes from PE < 15 × PB < 1.5 = 22.5. Stock price < Graham Number = potentially undervalued. Conservative estimate — suitable for defensive investors. Not suitable for high-growth companies.")
    P()

    H2("5.8 Portfolio Construction")
    P()
    P("Core-Satellite approach: 70% core (index funds, large caps) + 30% satellite (mid caps, small caps, direct stocks). Modern Portfolio Theory (Markowitz): maximize return for given risk. Asset allocation: determines 90% of returns. Diversification: across sectors, market caps, asset classes. Rebalancing: quarterly or semi-annual. Systematic investment: SIP for long-term wealth.")
    P()
    P("Portfolio checklist: minimum 10-15 stocks. Maximum 25-30 stocks (beyond this, diversification benefits diminish). No single stock > 5-7% of portfolio. Top 5 holdings < 30% of portfolio. Sector allocation within 20-30% per sector. Rebalance when allocation deviates by 5%+.")
    P()

    # ══════════════════════════════════════
    # APPENDIX
    # ══════════════════════════════════════
    H1("Appendix: English–English Glossary of Financial Terms")
    P()
    HR()
    P()
    P("A comprehensive reference of key financial and trading terms used throughout this book.")
    P()

    # Glossary terms
    glossary = [
        ("Accumulation", "Phase where smart money builds a position, typically after a downtrend. Characterized by low prices and low public interest."),
        ("ADX (Average Directional Index)", "Indicator measuring trend strength (0-100 scale). Values above 25 indicate a trending market; below 20 indicates a ranging market."),
        ("Arbitrage", "Simultaneously buying and selling the same asset in different markets to profit from price differences."),
        ("Asset Allocation", "Dividing investments across asset classes (stocks, bonds, cash, real estate) to balance risk and reward."),
        ("ATR (Average True Range)", "Volatility indicator measuring the average range of price movement over 14 periods. Used for stop loss and position sizing."),
        ("Beta", "Measure of a stock's volatility relative to the market. Beta > 1 means higher volatility than the market; Beta < 1 means lower."),
        ("Bollinger Bands", "Volatility indicator with 3 lines: 20-period SMA (middle), upper and lower bands at ±2 standard deviations. 95% of price action occurs within bands."),
        ("Break of Structure (BOS)", "Price breaking a recent swing high (in uptrend) or swing low (in downtrend), confirming trend continuation."),
        ("Candlestick", "Chart type showing Open, High, Low, Close for a period. Body shows open-close range; shadows/wicks show high-low range."),
        ("Change of Character (CHoCH)", "Market structure shift indicating a potential trend reversal. Last HH/HL in uptrend broken, or last LH/LL in downtrend broken."),
        ("Confirmation Bias", "Psychological tendency to seek information that confirms existing beliefs while ignoring contradictory evidence."),
        ("Correlation", "Statistical measure of how two assets move together. Range: -1 (opposite) to +1 (same direction). 0 = no relationship."),
        ("DCF (Discounted Cash Flow)", "Valuation method calculating intrinsic value by discounting projected future cash flows to present value using WACC."),
        ("Death Cross", "Bearish signal when 50-period moving average crosses below 200-period moving average. Indicates potential long-term downtrend."),
        ("Divergence", "Price and indicator moving in opposite directions. Bullish divergence: lower price but higher indicator. Bearish divergence: higher price but lower indicator."),
        ("Doji", "Candlestick with open = close (or very close). Indicates market indecision. Long-legged doji shows high volatility and uncertainty."),
        ("Dow Theory", "Foundation of technical analysis with 6 principles: market discounts everything, 3 trend types, 3 phases, indices confirm, volume confirms, trend continues until reversal."),
        ("Drawdown", "Peak-to-trough decline in account equity. Maximum drawdown = largest loss from peak. 20% max drawdown is a common risk limit."),
        ("Earnings Per Share (EPS)", "Company's net profit divided by total shares outstanding. Core measure of profitability per share."),
        ("Elliott Wave Theory", "Theory that markets move in 5-wave impulsive patterns (trend) and 3-wave corrective patterns (counter-trend). Waves are fractal."),
        ("Engulfing Pattern", "Two-candle reversal pattern: second candle's body completely engulfs the first. Bullish engulfing follows downtrend; bearish follows uptrend."),
        ("EV/EBITDA", "Enterprise Value (market cap + debt − cash) divided by EBITDA. Valuation metric that accounts for debt. < 10 = undervalued, > 20 = overvalued."),
        ("Fair Value Gap (FVG)", "Three-candle pattern where middle candle's range is not fully covered. Price tends to return ('fill') these gaps before continuing."),
        ("Fibonacci Retracement", "Tool measuring potential support/resistance at key ratios: 23.6%, 38.2%, 50%, 61.8%, 78.6%. 61.8% is the 'golden ratio.'"),
        ("FII/DII", "Foreign Institutional Investors / Domestic Institutional Investors. FII buying indicates foreign confidence; DII buying shows domestic support."),
        ("F-Score (Piotroski)", "9-point fundamental score: profitability (4 pts), leverage/liquidity (3 pts), operating efficiency (2 pts). 8-9 = strong, 0-3 = weak."),
        ("Golden Cross", "Bullish signal when 50-period moving average crosses above 200-period moving average. Indicates potential long-term uptrend."),
        ("Graham Number", "Maximum fair price = √(22.5 × EPS × BVPS). Price below this = potentially undervalued (conservative estimate for defensive investors)."),
        ("Hammer", "Single candle reversal: small body at top, long lower wick (2-3x body). Bullish at support after downtrend. Shows buying after selling pressure."),
        ("Harmonic Patterns", "Chart patterns based on precise Fibonacci ratios. Includes Gartley, Bat, Butterfly, Crab, Cypher. Identify potential reversal zones (PRZ)."),
        ("Ichimoku Cloud", "Comprehensive indicator with 5 lines: Tenkan, Kijun, Senkou A, Senkou B, Chikou. Price above/below cloud indicates trend. Cloud color shows momentum."),
        ("Implied Volatility (IV)", "Expected future volatility derived from option prices. High IV = expensive options; low IV = cheap options. IV percentile helps assess relative value."),
        ("Intrinsic Value", "True calculated value of a company based on fundamentals. If market price < intrinsic value = potential investment opportunity."),
        ("Kelly Criterion", "Position sizing formula: Kelly % = W − (1−W)/R. Modified Kelly uses 25% of calculated value for conservative sizing."),
        ("Killzone (ICT)", "ICT trading sessions: London (2-5 AM EST), New York (7-10 AM EST), London Close (10 AM-12 PM EST). High-probability trading windows."),
        ("Liquidity (Market)", "Buy-side liquidity above swing highs; sell-side liquidity below swing lows. Price moves to grab liquidity before reversing."),
        ("MACD", "Trend-following momentum indicator: MACD line (12EMA − 26EMA), Signal line (9EMA of MACD), Histogram. Crossovers signal momentum changes."),
        ("Margin of Safety", "Difference between intrinsic value and market price. Graham: buy with 33-50% margin of safety. Larger margin = lower risk."),
        ("Market Breadth", "Measures how many stocks participate in a move. Advance-Decline ratio, new highs-new lows. Breadth confirming price = healthy trend."),
        ("Market Structure", "HH/HL = uptrend, LH/LL = downtrend. BOS = trend continuation. CHoCH = potential reversal. Foundation of SMC/ICT analysis."),
        ("Morning Star", "Three-candle bullish reversal: long bearish → small indecision (doji) → long bullish. After downtrend. Strong reversal signal."),
        ("Moving Average (MA)", "Smoothed average of price over n periods. SMA = equal weight. EMA = more weight to recent prices. 50, 100, 200-day are key levels."),
        ("Nifty 50", "India's benchmark stock index consisting of 50 large-cap companies listed on NSE. Represents ~65% of NSE market capitalization."),
        ("Order Block (OB)", "Last candle before a strong move. Bullish OB = last bearish candle before uptrend. Bearish OB = last bullish candle before downtrend. Acts as S/R."),
        ("Oversold/Overbought", "RSI < 30 = oversold (potential bounce). RSI > 70 = overbought (potential pullback). In strong trends, can remain in these zones for extended periods."),
        ("PB Ratio (Price-to-Book)", "Market price divided by book value per share. < 1 = below liquidation value. Key metric for banks and financial stocks."),
        ("PE Ratio (Price-to-Earnings)", "Market price divided by earnings per share. 15-20 = average. Compare within sectors. PEG = PE / Growth rate."),
        ("ROE (Return on Equity)", "Net profit divided by shareholder equity. > 15% = good. > 20% = excellent. DuPont: NPM × Asset Turnover × Leverage."),
        ("ROCE (Return on Capital Employed)", "EBIT divided by capital employed (total assets − current liabilities). Measures capital efficiency. Should exceed WACC."),
        ("RSI (Relative Strength Index)", "Momentum oscillator (0-100). RSI > 70 = overbought, < 30 = oversold. Divergence = the most powerful signal. 50 center line = trend bias."),
        ("S/R (Support/Resistance)", "Support = level where buying exceeds selling. Resistance = level where selling exceeds buying. Role reversal on break."),
        ("Smart Money", "Institutions, banks, hedge funds, market makers. They have capital, information, and influence. SMC studies their behavior."),
        ("Stop Loss (SL)", "Predetermined price to exit a losing trade. Essential for risk management. Typically placed below support (long) or above resistance (short)."),
        ("Supply and Demand", "Supply zone = selling pressure exceeds buying (resistance). Demand zone = buying pressure exceeds selling (support). Fresh zones are strongest."),
        ("Technical Analysis", "Analysis of price, volume, and time to forecast future price movements. Based on market discounts everything, prices trend, history repeats."),
        ("Trend", "General direction of price: uptrend (HH/HL), downtrend (LH/LL), sideways (range-bound). The trend is your friend."),
        ("Volume", "Number of shares/contracts traded. Rising volume confirms trend. Falling volume suggests weakening. Cannot be hidden — the most honest indicator."),
        ("WACC (Weighted Average Cost of Capital)", "Company's cost of capital including both debt and equity. Used as discount rate in DCF. Higher WACC = lower intrinsic value."),
        ("Wyckoff Method", "Market analysis based on Composite Operator behavior. Laws: Supply/Demand, Cause/Effect, Effort/Result. Phases: Accumulation → Markup → Distribution → Markdown."),
        ("Z-Score (Altman)", "Bankruptcy prediction model: Z = 1.2A + 1.4B + 3.3C + 0.6D + 1.0E. Z > 2.99 = safe, < 1.81 = distress."),
    ]
    for term, defn in glossary:
        H3(term)
        P(defn)
        P()

    P()
    HR()
    P()
    P("---")
    P("*End of The Complete Guide to Financial Markets — English Edition*")
    P()

    # ══════════════════════════════════════
    # Write output
    # ══════════════════════════════════════
    md = "\n".join(L)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"✅ English book written to {OUTPUT_FILE}")
    print(f"   Total lines: {len(L)}")
    return md


def generate_pdf():
    """Call the PDF generator script with --lang en."""
    if not os.path.exists(GENERATOR_SCRIPT):
        print(f"⚠ PDF generator not found: {GENERATOR_SCRIPT}")
        return
    print("🖨 Generating PDF (English)...")
    # Use existing generate_book_pdf.py with --lang en
    result = subprocess.run(
        [sys.executable, GENERATOR_SCRIPT, "--lang", "en", "-o", PDF_OUTPUT, OUTPUT_FILE],
        capture_output=True, text=True, cwd=BASE
    )
    if result.returncode == 0:
        print(result.stdout)
        print(f"✅ English PDF generated: {PDF_OUTPUT}")
    else:
        print(f"❌ PDF generation failed:\n{result.stderr}")


if __name__ == "__main__":
    build()
    if "--pdf" in sys.argv:
        generate_pdf()
    print("Done.")
