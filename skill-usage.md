# VijayMaruthi-Py-Share — Skill Usage Guide

This skill is an **OpenCode Agent Skill**. It must be loaded via the `skill` tool inside an OpenCode session.
The skill itself does NOT run standalone — it requires an OpenCode agent.

---

## PREREQUISITES

- OpenCode installed (`brew install opencode` or `curl -fsSL https://opencode.ai/install | bash`)
- The skill files placed at `.opencode/skills/vijaymaruthi-py-share/` (already done)

---

## HOW TO LOAD THE SKILL

When chatting with OpenCode, the agent automatically sees available skills.
To load this skill, simply mention a share market related task:

> "Analyze RELIANCE on the daily timeframe"

> "Backtest a moving average crossover strategy for NIFTY 50"

> "What is the current market structure of BANKNIFTY?"

The agent will detect the relevant skill and offer to load it. You can also explicitly ask:

> "Load the vijaymaruthi-py-share skill and analyze HDFCBANK"

Once loaded, the agent behaves as an **Institutional Share Market Expert** and follows all rules defined in SKILL.md.

---

## WHAT YOU CAN ASK THE AGENT TO DO

### Technical Analysis
- "Show me the daily chart of TCS with key S/R levels"
- "Is NIFTY in an uptrend or downtrend on the weekly timeframe?"
- "What is the RSI divergence on INFY?"
- "Draw Fibonacci retracement from the recent swing low to swing high on BANKNIFTY"
- "Identify supply and demand zones on the 4H chart of RELIANCE"

### Chart Patterns
- "Is there a head and shoulders pattern forming on NIFTY?"
- "Show me all bullish flag patterns on NSE 500 stocks"
- "Identify cup and handle patterns on weekly charts"
- "Is this a double top or consolidation on HDFCBANK?"

### Candlestick Analysis
- "What does the morning star pattern on the daily chart of TCS indicate?"
- "Identify any bullish engulfing patterns on NIFTY stocks today"
- "Is that a shooting star on the 1H chart of BANKNIFTY?"
- "Show me the psychology behind this doji on RELIANCE"

### Smart Money Concepts (ICT/Wyckoff)
- "Identify order blocks on the 4H chart of NIFTY"
- "Is there a fair value gap on BANKNIFTY daily?"
- "Show me Wyckoff accumulation phases on TCS"
- "Where is the liquidity sweep on RELIANCE 1H?"

### Python Strategy Development
- "Write a Python script to backtest a 20/50 EMA crossover on NIFTY"
- "Create a trend-following strategy class with ATR-based stops"
- "Build a screener to find RSI divergence on NSE 500 stocks"
- "Generate a backtest report with Sharpe, Sortino, and drawdown metrics"
- "Calculate optimal position size using Kelly Criterion for my strategy"

### Backtesting
- "Walk-forward test my strategy on 10 years of NIFTY data"
- "Run a Monte Carlo simulation on these backtest results"
- "What is the Sharpe ratio of this strategy?"
- "Check for overfitting — run a sensitivity analysis"
- "Stress test this strategy during the 2020 COVID crash"

### Risk Management
- "Calculate position size for a Rs. 5 lakh account with 2% risk"
- "What is the optimal R:R ratio for this setup?"
- "Set up ATR-based trailing stops"
- "Calculate portfolio heat across my current positions"

### Market Analysis
- "Full market analysis of NIFTY for tomorrow"
- "Generate a trade report for my last 20 trades"
- "Screen for breakout candidates on NSE 500"
- "Compare performance of RELIANCE vs TCS vs INFY"

---

## SKILL MODULES

The skill is modular. The agent may read specific files for detailed knowledge:

| Module | File | When the Agent Uses It |
|--------|------|------------------------|
| **SKILL.md** | `SKILL.md` | Always loaded first — sets role, rules, decision framework |
| **Technical Analysis** | `technical_analysis.md` | When analyzing indicators, trends, levels |
| **Candlestick Patterns** | `candlestick_patterns.md` | When identifying candle patterns (62 patterns) |
| **Chart Patterns** | `chart_patterns.md` | When identifying chart patterns (22+ patterns) |
| **Smart Money Concepts** | `smart_money_concepts.md` | When using ICT/Wyckoff/VSA analysis |
| **Risk Management** | `risk_management.md` | When sizing positions, calculating risk |
| **Python Quant** | `python_quant.md` | When writing Python for strategies/backtesting |
| **Backtesting** | `backtesting.md` | When validating and evaluating strategies |
| **Report Templates** | `report_templates.md` | When generating structured reports |

---

## EXAMPLE PROMPTS

### Example 1: Quick Market Check

```
User: Load the share market skill and check NIFTY daily
Agent: [Loads skill, reads technical_analysis.md, produces analysis]

NIFTY — Daily — 06 Jul 2026

MARKET STRUCTURE
Trend:    Uptrend
Structure: HH + HL intact
ADX: 24 (Trending)

KEY LEVELS
Resistance: 24,500 / 24,800
Support:    24,000 / 23,700
20 EMA:     24,120 (bullish)
50 EMA:     23,850 (bullish)

INDICATORS
RSI(14):  62 (bullish, room to run)
MACD:     Bullish, histogram rising
OBV:      Confirming uptrend

CANDLESTICK: Bullish engulfing on Friday
PATTERN:    None active

BIAS: BULLISH — trade pullbacks to 24,000-24,120 zone
Stop: 23,850 | Target: 24,500 | R:R 1:2.4
Confidence: 75%
```

### Example 2: Full Strategy Backtest

```
User: I want a Python script to backtest a 50/200 SMA crossover on BANKNIFTY
       with walk-forward validation and full metrics report.

Agent: [Loads python_quant.md, backtesting.md, risk_management.md,
        writes complete Python script with:
        - yfinance data loader
        - VectorBT engine
        - WFA with 3 windows
        - Monte Carlo simulation
        - Sharpe, Sortino, Calmar, drawdown
        - HTML report via quantstats]
```

---

## TROUBLESHOOTING

| Issue | Fix |
|-------|-----|
| Skill not loading | Ensure files are at `.opencode/skills/vijaymaruthi-py-share/SKILL.md` exactly |
| Agent not seeing the skill | Run from the project directory where `.opencode/skills/` exists |
| Skill loads but lacks detail | The agent reads SKILL.md first; ask it to load specific sub-modules |
| Want to disable the skill | Add `"skill": { "vijaymaruthi-py-share": "deny" }` in `opencode.json` permissions |

---

## FILE LOCATION

```
/Users/vijaykumar/opencode/share/.opencode/skills/vijaymaruthi-py-share/
├── SKILL.md
├── technical_analysis.md
├── candlestick_patterns.md
├── chart_patterns.md
├── smart_money_concepts.md
├── risk_management.md
├── python_quant.md
├── backtesting.md
└── report_templates.md
```

---

> **Note:** This skill enhances the agent's capabilities but all analysis requires real market data.
> Python code generated by the skill must be executed in an appropriate Python environment
> with the required libraries installed (see `python_quant.md` for dependencies).
