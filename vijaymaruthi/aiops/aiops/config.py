"""Central configuration — defaults + environment overrides.

All runtime state lives under AIOPS_ROOT/state and AIOPS_ROOT/reports
(never inside the package). Values can be overridden via environment
variables (see .env.example).
"""

from __future__ import annotations

import os
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────
# aiops/aiops/config.py -> parent.parent = vijaymaruthi/aiops
AIOPS_ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = Path(os.environ.get("AIOPS_STATE_DIR", AIOPS_ROOT / "state"))
REPORTS_DIR = Path(os.environ.get("AIOPS_REPORTS_DIR", AIOPS_ROOT / "reports"))
DB_PATH = Path(os.environ.get("AIOPS_DB_PATH", STATE_DIR / "aiops.db"))

# ── Universe ─────────────────────────────────────────────────────────────
DEFAULT_SYMBOLS = [
    "^NSEI",
    "RELIANCE.NS",
    "HDFCBANK.NS",
    "INFY.NS",
    "TCS.NS",
    "ICICIBANK.NS",
    "SBIN.NS",
    "BHARTIARTL.NS",
    "ITC.NS",
    "LT.NS",
    "KOTAKBANK.NS",
]


def symbols() -> list[str]:
    raw = os.environ.get("AIOPS_SYMBOLS", "")
    if not raw.strip():
        return list(DEFAULT_SYMBOLS)
    return [s.strip() for s in raw.split(",") if s.strip()]


# ── OpenCode LLM bridge ──────────────────────────────────────────────────
OPENCODE_BIN = Path(
    os.environ.get("OPENCODE_BIN", str(Path.home() / ".opencode/bin/opencode"))
)
OPENCODE_SERVER_URL = os.environ.get("OPENCODE_SERVER_URL", "http://127.0.0.1:4096")
OPENCODE_SERVER_PASSWORD = os.environ.get("OPENCODE_SERVER_PASSWORD", "")
OPENCODE_MODEL = os.environ.get("OPENCODE_MODEL", "") or None
OPENCODE_AGENT = os.environ.get("OPENCODE_AGENT", "aiops-llm")
OPENCODE_DIRECTORY = os.environ.get(
    "OPENCODE_DIRECTORY", str(AIOPS_ROOT.parent.parent)  # share root (opencode project)
)

# ── ADK Web UI ───────────────────────────────────────────────────────────
ADK_UI_URL = os.environ.get("ADK_UI_URL", "http://127.0.0.1:8011")

# ── Local HTTP API ───────────────────────────────────────────────────────
AIOPS_API_HOST = os.environ.get("AIOPS_API_HOST", "127.0.0.1")
AIOPS_API_PORT = int(os.environ.get("AIOPS_API_PORT", "8010"))

# ── Temporal discipline (IST) ────────────────────────────────────────────
PREDICT_AT = os.environ.get("PREDICT_AT", "09:00")
MORNING_DATA_AS_OF = os.environ.get("MORNING_DATA_AS_OF", "16:00")
VALIDATE_AT = os.environ.get("VALIDATE_AT", "16:00")

# ── Learning ─────────────────────────────────────────────────────────────
MIN_LESSON_OBSERVATIONS = int(os.environ.get("MIN_LESSON_OBSERVATIONS", "3"))
BACKTEST_DEFAULT_DAYS = int(os.environ.get("BACKTEST_DEFAULT_DAYS", "15"))

# ── Knowledge system (v3 — noise fix + decision gates) ───────────────────
# Minimum sample size before a pattern's stats may be promoted to knowledge.
# The old default of 5 promoted noise (86% of entries came from n<20 samples).
KNOWLEDGE_MIN_OBS = int(os.environ.get("KNOWLEDGE_MIN_OBS", "50"))

# Patterns with measured NEGATIVE expectancy (2005-09: meanrev_up -0.117%,
# breakout_up -0.018%, breakout_down -0.026%) — suppressed globally.
SUPPRESS_PATTERNS = set(
    p.strip()
    for p in os.environ.get("SUPPRESS_PATTERNS", "meanrev_up,breakout_up,breakout_down").split(",")
    if p.strip()
)

# Symbol gate: only trade symbols with >=1 positive knowledge entry.
SYMBOL_GATE = os.environ.get("SYMBOL_GATE", "1") == "1"

# Direction gate: "" (off) or "down" (suppress up predictions — the measured
# base-rate edge). Off by default so the pattern gate handles direction.
DIRECTION_GATE = os.environ.get("DIRECTION_GATE", "")

# ── Model identity ───────────────────────────────────────────────────────
PROMPT_VERSION = "analysis-v2"
KNOWLEDGE_VERSION_INIT = 0