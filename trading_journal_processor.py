"""
Trading Journal Task Processor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Parses structured tasks from the Trading Journal note and executes them using
the pattern_validator engine. Handles single-stock analysis, universe scans,
and help commands.

Usage (standalone):
    python3 trading_journal_processor.py --task "analyze RELIANCE DAILY"

Part of the Trading Journal Watcher system.
"""

import re
import sys
import json
import time
import subprocess
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Tuple

# ── Configuration ──
BASE_DIR = Path(__file__).parent.resolve()
VALIDATOR_SCRIPT = BASE_DIR / "pattern_validator.py"
CACHE_FILE = BASE_DIR / "validation_results" / "all_stock_results.json"
REPORTS_DIR = BASE_DIR / "reports"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("journal_processor")


# ============================================================================
# TASK PARSING
# ============================================================================

# Task patterns
TASK_PATTERN = re.compile(r"(?:^|\b)##TASK:\s+(.+?)(?:$|</)", re.IGNORECASE | re.DOTALL)
RESULT_PATTERN = re.compile(r"##RESULT:", re.IGNORECASE)


def strip_html(text: str) -> str:
    """Remove HTML tags and decode common entities for clean text."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def html_escape(text: str) -> str:
    """Escape special HTML characters for safe display in Notes/HTML."""
    text = str(text)
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    text = text.replace('"', "&quot;")
    return text

SUPPORTED_COMMANDS = {
    "analyze": {
        "syntax": "##TASK: analyze SYMBOL [DAILY|WEEKLY|MONTHLY]",
        "desc": "Run full multi-pattern analysis on a single stock",
    },
    "scan": {
        "syntax": "##TASK: scan [N|all]",
        "desc": "Scan N stocks or the full universe (may take time)",
    },
    "help": {
        "syntax": "##TASK: help",
        "desc": "Show available commands",
    },
}


def normalize_html(text: str) -> str:
    """Convert HTML block structure to newline-separated lines for parsing."""
    text = re.sub(r"</div>\s*<div[^>]*>", "\n", text)
    text = re.sub(r"</?div[^>]*>", "\n", text)
    text = re.sub(r"</?br\s*/?>", "\n", text)
    text = re.sub(r"</?li[^>]*>", "\n", text)
    text = re.sub(r"</?ul[^>]*>", "\n", text)
    return text


def parse_tasks(note_body: str) -> List[Dict]:
    """Extract all ##TASK: directives from the note body (handles HTML).

    Returns list of dicts with: line_index, raw_text, command, args, processed
    """
    tasks = []
    normalized = normalize_html(note_body)
    lines = normalized.split("\n")

    for i, line in enumerate(lines):
        line_clean = strip_html(line)
        m = TASK_PATTERN.search(line_clean)
        if not m:
            continue

        raw_text = m.group(1).strip()

        # Check if a ##RESULT appears after this task but before the next task
        processed = False
        for j in range(i + 1, len(lines)):
            line_j = strip_html(lines[j]) if lines[j].strip() else ""
            if RESULT_PATTERN.search(line_j):
                processed = True
                break
            # Found another task before any result — this task is still pending
            m2 = TASK_PATTERN.search(line_j)
            if m2:
                break

        tasks.append({
            "line_index": i,
            "raw_text": raw_text,
            "processed": processed,
        })

    return tasks


# ============================================================================
# TASK EXECUTION
# ============================================================================


def run_validator(symbol: str, timeout_sec: int = 120) -> Dict:
    """Run pattern_validator.py for a single symbol and return structured result."""
    log.info("Running analysis for %s ...", symbol)

    t0 = time.time()
    try:
        result = subprocess.run(
            [sys.executable, str(VALIDATOR_SCRIPT), "--symbol", symbol, "--fresh"],
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            cwd=str(BASE_DIR),
        )
        elapsed = time.time() - t0
    except subprocess.TimeoutExpired:
        return {
            "status": "ERROR",
            "symbol": symbol,
            "error": f"Analysis timed out after {timeout_sec}s",
            "elapsed": timeout_sec,
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "symbol": symbol,
            "error": str(e),
            "elapsed": time.time() - t0,
        }

    # Check if analysis ran successfully
    stderr_lower = result.stderr.lower()
    stdout_lower = result.stdout.lower()

    if "error" in stderr_lower and "no daily data" in stderr_lower:
        return {
            "status": "ERROR",
            "symbol": symbol,
            "error": "No daily data available for symbol",
            "elapsed": elapsed,
        }

    # Try to read result from cache
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE) as f:
                all_results = json.load(f)

            for r in all_results:
                if r.get("symbol", "").upper() == symbol.upper():
                    return _format_result_from_cache(r, elapsed)
        except (json.JSONDecodeError, KeyError) as e:
            log.warning("Failed to parse cache: %s", e)

    # Fallback: parse terminal output
    return _parse_terminal_output(symbol, result.stdout + result.stderr, elapsed)


def _format_result_from_cache(cache_entry: Dict, elapsed: float) -> Dict:
    """Convert a cache entry into structured result dict."""
    sc = cache_entry.get("signal_confluence", {}) or {}
    cp = cache_entry.get("chart_patterns", [])
    cs = cache_entry.get("candlestick_signals", [])
    errors = cache_entry.get("errors", [])

    # Summarize chart patterns
    chart_summary = ""
    if cp:
        by_type: Dict[str, list] = {}
        for p in cp:
            by_type.setdefault(p.get("pattern_type", "UNKNOWN"), []).append(p)
        chart_lines = []
        for ptype, plist in sorted(by_type.items()):
            obeyed = sum(1 for p in plist if p.get("obeyed"))
            chart_lines.append(f"{ptype}: {obeyed}/{len(plist)} obeyed")
        chart_summary = " | ".join(chart_lines)

    # Summarize candles
    candle_net = sc.get("net_candle_signals", 0)
    candle_dir = "bullish" if (candle_net or 0) > 0 else "bearish" if (candle_net or 0) < 0 else "neutral"

    direction = cache_entry.get("conviction_direction", "")
    pred = cache_entry.get("prediction", "N/A")
    conf = cache_entry.get("prediction_confidence", 0)
    conviction = cache_entry.get("conviction_score", 0)
    rating = cache_entry.get("conviction_rating", "N/A")

    sig_types = sc.get("signal_types", 0)
    timeframes = sc.get("timeframes", 0)

    error_str = f" | Errors: {'; '.join(errors)}" if errors else ""

    return {
        "status": "COMPLETE" if not errors else "PARTIAL",
        "symbol": cache_entry.get("symbol", ""),
        "prediction": pred.upper(),
        "confidence": f"{conf:.0f}%",
        "conviction": f"{conviction:.1f}% ({rating})",
        "direction": direction.capitalize() if direction else "N/A",
        "chart_patterns": f"{len(cp)} ({chart_summary})" if cp else "None",
        "candle_signals": f"{len(cs)} total (net {candle_dir}: {candle_net:.1f})",
        "signal_confluence": f"{sig_types} signal types across {timeframes} timeframe(s)",
        "fundamental": sc.get("fundamental", "N/A"),
        "duration": f"{elapsed:.1f}s",
        "error": error_str,
    }


def _parse_terminal_output(symbol: str, output: str, elapsed: float) -> Dict:
    """Fallback: extract what we can from terminal output."""
    result = {
        "status": "COMPLETE",
        "symbol": symbol,
        "prediction": "N/A",
        "confidence": "N/A",
        "conviction": "N/A",
        "direction": "N/A",
        "chart_patterns": "N/A",
        "candle_signals": "N/A",
        "signal_confluence": "N/A",
        "fundamental": "N/A",
        "duration": f"{elapsed:.1f}s",
        "error": "",
    }

    # Try to extract prediction
    m = re.search(r"Prediction:\s*(\w+)", output, re.IGNORECASE)
    if m:
        result["prediction"] = m.group(1).upper()

    # Try to extract conviction
    m = re.search(r"Conviction:\s*([\d.]+)%", output)
    if m:
        result["conviction"] = m.group(1) + "%"
    m = re.search(r"Rating:\s*(\w+)", output, re.IGNORECASE)
    if m:
        result["conviction"] += f" ({m.group(1).upper()})"

    return result


# ============================================================================
# RESULT FORMATTING
# ============================================================================


def format_result_html(result: Dict) -> str:
    """Format a task result as HTML for appending to the Notes note."""
    ts = datetime.now().strftime("%d-%b-%Y %H:%M")
    symbol = result.get("symbol", "")
    status = result.get("status", "UNKNOWN")

    lines = [
        f"<div><br></div><hr><div><br></div>",
    ]

    if status == "ERROR":
        lines.append(
            f'<div><b>##RESULT: {ts} — {symbol}</b></div>'
            f'<div><span style="color:#cc0000">Status: ERROR</span></div>'
            f'<div>Error: {result.get("error", "Unknown")}</div>'
            f'<div>Duration: {result.get("duration", "N/A")}</div>'
        )
    else:
        lines.append(
            f'<div><b>##RESULT: {ts} — {symbol}</b></div>'
            f'<div>Status: <span style="color:#008800">COMPLETE</span></div>'
            f'<div>Duration: {result.get("duration", "N/A")}</div>'
            f'<div><br></div>'
            f'<div><b>Prediction:</b> {result.get("prediction", "N/A")} ({result.get("confidence", "N/A")})</div>'
            f'<div><b>Direction:</b> {result.get("direction", "N/A")}</div>'
            f'<div><b>Conviction:</b> {result.get("conviction", "N/A")}</div>'
            f'<div><b>Chart Patterns:</b> {result.get("chart_patterns", "N/A")}</div>'
            f'<div><b>Candle Signals:</b> {result.get("candle_signals", "N/A")}</div>'
            f'<div><b>Signal Confluence:</b> {result.get("signal_confluence", "N/A")}</div>'
            f'<div><b>Fundamental:</b> {result.get("fundamental", "N/A")}</div>'
        )

    error = result.get("error", "")
    if error:
        lines.append(f'<div><span style="color:#cc0000">{error}</span></div>')

    return "".join(lines)


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================


# Stock symbol pattern: 2-12 uppercase letters, optionally followed by digits
STOCK_PATTERN = re.compile(r"\b([A-Z]{2,12}\d*)\b")

# Common phrases that map to actions
PHRASE_MAP = [
    (re.compile(r"\b(?:scan|scanning|screen|screener)\b", re.IGNORECASE), "scan"),
    (re.compile(r"\b(?:help|commands|what can you do|usage)\b", re.IGNORECASE), "help"),
    (re.compile(r"\b(?:analyze|analyse|analysis|technical|check|lookup|research|valuate)\b", re.IGNORECASE), "analyze"),
]


def smart_parse(raw_text: str) -> Tuple[str, str]:
    """Intelligently parse any raw text into (command, args).

    Handles:
      - ##TASK: analyze RELIANCE
      - ##TASK: RELIANCE  (implicit analyze)
      - ##TASK: do technical analysis of HDFCBANK
      - ##TASK: scan 100
      - ##TASK: help
      - RELIANCE  (no ##TASK: prefix — implicit analyze)
    """
    text = raw_text.strip()

    # Detect command from text
    cmd = None
    args_text = text

    # Check explicit first word or phrase matches
    first_word = text.split(None, 1)[0].lower() if text else ""
    if first_word in ("analyze", "analyse", "scan", "help"):
        cmd = first_word
        args_text = text.split(None, 1)[1] if len(text.split(None, 1)) > 1 else ""
    elif first_word in ("do", "run", "perform", "execute"):
        # "do technical analysis of RELIANCE" → extract actual command
        args_text = text.split(None, 1)[1] if len(text.split(None, 1)) > 1 else args_text
        # Re-parse with remaining text
        return smart_parse(args_text)

    if cmd is None:
        # Try phrase matching
        for pattern, mapped_cmd in PHRASE_MAP:
            if pattern.search(text):
                cmd = mapped_cmd
                break

    if cmd is None:
        # Check if text contains a stock symbol (implicit analyze)
        symbols = STOCK_PATTERN.findall(text.upper())
        valid_symbols = [s for s in symbols if len(s) >= 2 and not s.isdigit()]
        if valid_symbols:
            cmd = "analyze"
            args_text = valid_symbols[0]
        else:
            cmd = first_word  # fallback

    return cmd, args_text


def process_task(task_cmd: str, task_args: str) -> Optional[Dict]:
    """Parse and execute a single task.

    Args:
        task_cmd: Command name (analyze, scan, help, or raw text)
        task_args: Arguments string (can be empty)

    Returns:
        Result dict.
    """
    # If task_cmd is not a known command, try smart parsing
    if task_cmd not in ("analyze", "scan", "help"):
        combined = f"{task_cmd} {task_args}".strip()
        parsed_cmd, parsed_args = smart_parse(combined)
        log.info("Smart parse: '%s' → cmd=%s args='%s'", combined, parsed_cmd, parsed_args)
        task_cmd = parsed_cmd
        task_args = parsed_args

    if task_cmd == "help":
        return {
            "status": "HELP",
            "symbol": "help",
            "detail": "help requested",
        }

    if task_cmd == "analyze":
        parts = task_args.split()
        if not parts:
            return {
                "status": "ERROR",
                "symbol": task_args or "?",
                "error": "Missing symbol. Try: analyze RELIANCE",
                "duration": "0s",
            }
        # Extract the actual stock symbol — look for words already in uppercase
        symbol = None
        for p in parts:
            clean = p.strip().rstrip(".,;:!?")
            if clean.isupper() and re.match(r"^[A-Z]{2,12}\d*$", clean) and not clean.isdigit():
                symbol = clean
                break
        if symbol is None:
            # Fallback: try to find any uppercase word or take first word
            for p in parts:
                if re.match(r"^[A-Za-z]{2,12}$", p.strip().rstrip(".,;:!?")):
                    symbol = p.strip().rstrip(".,;:!?").upper()
                    break
        if symbol is None:
            symbol = parts[0].strip().rstrip(".,;:!?").upper()
        timeframe = parts[-1].upper() if len(parts) > 1 and parts[-1].upper() in ("DAILY", "WEEKLY", "MONTHLY") else "DAILY"
        return run_validator(symbol)

    if task_cmd == "scan":
        parts = task_args.split()
        scan_arg = parts[0] if parts else "50"
        log.info("Starting scan: %s symbols", scan_arg)

        t0 = time.time()
        try:
            result = subprocess.run(
                [sys.executable, str(VALIDATOR_SCRIPT), "--scan", scan_arg,
                 "--workers", "8", "--fresh"],
                capture_output=True,
                text=True,
                timeout=3600,
                cwd=str(BASE_DIR),
            )
            elapsed = time.time() - t0
        except subprocess.TimeoutExpired:
            return {
                "status": "ERROR",
                "symbol": "SCAN",
                "error": f"Scan timed out after 3600s",
                "elapsed": "3600s",
            }

        # Extract key metrics from output
        output = result.stdout + result.stderr
        charts_m = re.search(r"Chart patterns:\s*(\d+)", output)
        candles_m = re.search(r"Candle signals:\s*(\d+)", output)
        obey_m = re.search(r"Overall chart obey rate:\s*([\d.]+)%", output)
        time_m = re.search(r"Complete:\s*(\d+)\s*symbols\sin\s*([\d.]+)s", output)

        return {
            "status": "COMPLETE",
            "symbol": f"SCAN:{scan_arg}",
            "prediction": f"{charts_m.group(1) if charts_m else '?'} chart patterns, "
                         f"{candles_m.group(1) if candles_m else '?'} candle signals" if charts_m else "Scan complete",
            "confidence": f"Obey: {obey_m.group(1)}%" if obey_m else "",
            "duration": f"{elapsed:.1f}s",
            "detail": (f"Scanned {scan_arg} symbols in {elapsed:.1f}s"
                      f" | Charts: {charts_m.group(1) if charts_m else '?'}"
                      f" | Candles: {candles_m.group(1) if candles_m else '?'}"
                      f" | Obey: {obey_m.group(1)}%"),
        }

    return {
        "status": "ERROR",
        "symbol": task_cmd,
        "error": f"Unknown command: {task_cmd}. Try ##TASK: help",
        "duration": "0s",
    }


def format_help_html() -> str:
    """Return HTML-formatted help text."""
    lines = [
        "<div><b>## Available Commands</b></div>",
        "<div><br></div>",
    ]
    for cmd, info in SUPPORTED_COMMANDS.items():
        lines.append(
            f"<div><b>{info['syntax']}</b></div>"
            f"<div>&nbsp;&nbsp;→ {info['desc']}</div>"
            f"<div><br></div>"
        )
    lines.append(
        "<div><b>Notes:</b></div>"
        "<div>- Only unprocessed tasks (no ##RESULT after them) will be executed</div>"
        "<div>- Results are appended below the task automatically</div>"
        "<div>- Do NOT edit or remove ##RESULT blocks unless you want the task re-run</div>"
    )
    return "".join(lines)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Trading Journal Task Processor")
    parser.add_argument("--task", type=str, help="Task string to process (e.g. 'analyze RELIANCE')")
    parser.add_argument("--list-commands", action="store_true", help="Show available commands")
    args = parser.parse_args()

    if args.list_commands:
        print("Available commands:")
        for cmd, info in SUPPORTED_COMMANDS.items():
            print(f"  {info['syntax']}")
            print(f"    {info['desc']}")
        sys.exit(0)

    if args.task:
        # Pass full raw text to smart parser
        result = process_task(args.task, "")
        if result:
            print(json.dumps(result, indent=2))
        sys.exit(0)

    print("Use --task or --list-commands")
    sys.exit(1)
