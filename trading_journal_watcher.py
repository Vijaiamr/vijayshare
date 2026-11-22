"""
Trading Journal Watcher
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Background service that monitors the "Trading Journal" note in macOS Notes app.

On detecting changes:
  1. Reads the note body via AppleScript
  2. Parses ##TASK: directives
  3. Executes unprocessed tasks using the pattern_validator engine
  4. Appends results (##RESULT:) back to the same note

Uses launchd for auto-start. Only touches the "Trading Journal" note — never
accesses any other notes in the app.

Usage:
    python3 trading_journal_watcher.py              # Start interactive mode
    python3 trading_journal_watcher.py --daemon      # Run as daemon (no stdin)
    python3 trading_journal_watcher.py --oneshot     # Single poll cycle
"""

import os
import sys
import time
import json
import hashlib
import logging
import subprocess
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Set

# ── Configuration ──
BASE_DIR = Path(__file__).parent.resolve()
PROCESSOR_SCRIPT = BASE_DIR / "trading_journal_processor.py"
WATCHER_LOG = BASE_DIR / "logs" / "trading_journal_watcher.log"
PID_FILE = Path("/tmp") / "trading_journal_watcher.pid"

POLL_INTERVAL_SEC = 30  # Check every 30 seconds
NOTE_NAME = "Trading Journal"
NOTE_FOLDER = "Notes"
NOTE_ACCOUNT = "iCloud"

# ── Implicit task detection ──
# Content below this sentinel line is scanned for bare stock symbols (no ##TASK: needed)
SENTINEL_LINE = "──────────────────────"
# Common uppercase words that are NOT stock symbols (filter out false positives)
COMMON_NON_STOCK_WORDS: Set[str] = {
    "I", "A", "AN", "THE", "AND", "OR", "FOR", "NOT", "BUT", "IS", "ARE",
    "WAS", "WERE", "BEEN", "BE", "BEING", "HAVE", "HAS", "HAD", "HAVING",
    "DO", "DOES", "DID", "DOING", "WILL", "WOULD", "CAN", "COULD", "SHALL",
    "SHOULD", "MAY", "MIGHT", "MUST", "ON", "IN", "AT", "TO", "BY", "WITH",
    "FROM", "OF", "AS", "IF", "THEN", "ELSE", "WHEN", "WHAT", "WHY", "HOW",
    "WHERE", "WHICH", "WHO", "WHOM", "THIS", "THAT", "THESE", "THOSE",
    "EACH", "EVERY", "ALL", "SOME", "ANY", "NO", "MORE", "MOST", "MUCH",
    "MANY", "SUCH", "ONLY", "JUST", "ALSO", "VERY", "TOO", "OK", "YES",
    "NO", "FYI", "ASAP", "RSVP", "VS", "PER", "E_G", "I_E", "ETC", "N_A",
    "TBD", "TBA", "AKA", "A_K_A",
    # Template / structural words
    "TRADING", "JOURNAL", "CREATED", "HOW", "USE", "EXAMPLES", "THAT",
    "WORK", "WATCHER", "ACTIVE", "ADD", "TASK", "ABOVE", "YOUR", "BELOW",
    "THIS", "LINE", "NOTE", "NOTES", "APP", "ICLOUD", "ACCOUNT", "FOLDER",
    "MACOS", "BACKGROUND", "SERVICE",
}
STOCK_SYMBOL_PATTERN = re.compile(r"\b([A-Z]{2,12})\b")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("journal_watcher")


# ============================================================================
# APPLESCRIPT HELPERS
# ============================================================================


def run_applescript(script: str) -> str:
    """Execute an AppleScript and return stdout. Raises on error."""
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"AppleScript error: {result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        raise RuntimeError("AppleScript timed out")
    except FileNotFoundError:
        raise RuntimeError("osascript not found — are you on macOS?")


def get_note_body() -> Optional[str]:
    """Read the body of the Trading Journal note via AppleScript.

    Returns None if the note doesn't exist.
    """
    script = f'''
    tell application "Notes"
        set noteList to notes of folder "{NOTE_FOLDER}" of account "{NOTE_ACCOUNT}"
        repeat with n in noteList
            if name of n is "{NOTE_NAME}" then
                return body of n
            end if
        end repeat
        return "##NOT_FOUND##"
    end tell
    '''
    body = run_applescript(script)
    if body == "##NOT_FOUND##":
        return None
    return body


def update_note_body(new_body: str) -> bool:
    """Overwrite the Trading Journal note body via AppleScript.

    The body must be valid HTML (as Notes.app expects).
    """
    # Escape for AppleScript string (double quotes, backslashes)
    escaped = new_body.replace("\\", "\\\\").replace('"', '\\"')
    script = f'''
    tell application "Notes"
        set noteList to notes of folder "{NOTE_FOLDER}" of account "{NOTE_ACCOUNT}"
        repeat with n in noteList
            if name of n is "{NOTE_NAME}" then
                set body of n to "{escaped}"
                return "OK"
            end if
        end repeat
        return "NOT_FOUND"
    end tell
    '''
    result = run_applescript(script)
    return result == "OK"


def note_exists() -> bool:
    """Check if the Trading Journal note exists."""
    script = f'''
    tell application "Notes"
        set noteList to notes of folder "{NOTE_FOLDER}" of account "{NOTE_ACCOUNT}"
        repeat with n in noteList
            if name of n is "{NOTE_NAME}" then
                return "YES"
            end if
        end repeat
        return "NO"
    end tell
    '''
    return run_applescript(script) == "YES"


# ============================================================================
# TASK DETECTION & EXECUTION
# ============================================================================


def strip_html(text: str) -> str:
    """Remove HTML tags and decode common entities for clean text."""
    text = re.sub(r"<[^>]+>", " ", text)  # Replace tags with space
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"\s+", " ", text)  # Collapse whitespace
    return text.strip()


def _find_explicit_tasks(lines: List[str], result_pattern: "re.Pattern") -> List[Dict]:
    """Find ##TASK: directives that don't have a following ##RESULT.

    Returns list of dicts with: raw_text
    """
    tasks = []
    task_pattern = re.compile(r"(?:^|\b)##TASK:\s+(.+?)(?:$|</)", re.IGNORECASE | re.DOTALL)

    for i, line in enumerate(lines):
        line_clean = strip_html(line)
        m = task_pattern.search(line_clean)
        if not m:
            continue

        # Full raw text after "##TASK:" — will be parsed smartly by the processor
        raw_text = m.group(1).strip()
        first_word = raw_text.split(None, 1)[0].lower() if raw_text else ""

        # Check if a ##RESULT appears after this task but before the next task
        has_result = False
        for j in range(i + 1, len(lines)):
            line_j = strip_html(lines[j]) if lines[j].strip() else ""
            # Found a result for this task
            if result_pattern.search(line_j):
                has_result = True
                break
            # Found another task before any result — this task is still pending
            m2 = task_pattern.search(line_j)
            if m2:
                break

        if not has_result:
            tasks.append({
                "raw_text": raw_text,
            })

    return tasks


def _find_implicit_tasks(lines: List[str], result_pattern: "re.Pattern") -> List[Dict]:
    """Find bare stock symbols (no ##TASK:) below the sentinel line.

    This lets users just type "RELIANCE" or "do technical analysis of HDFCBANK"
    without needing the ##TASK: prefix.

    Returns list of task dicts with: raw_text
    """
    # Find the sentinel line index
    sentinel_idx = -1
    for i, line in enumerate(lines):
        if SENTINEL_LINE in line:
            sentinel_idx = i
            break

    if sentinel_idx < 0:
        return []  # No sentinel — no implicit detection

    # Collect all stock symbols found below the sentinel
    symbols_found: List[str] = []
    symbol_lines: List[int] = []

    for i in range(sentinel_idx + 1, len(lines)):
        line_text = strip_html(lines[i]).strip()
        if not line_text:
            continue
        # Skip lines that are part of a ##RESULT: block (already processed)
        if result_pattern.search(line_text):
            continue
        # Skip lines that are part of an explicit ##TASK:
        if re.search(r"(?:^|\b)##TASK:", line_text, re.IGNORECASE):
            continue

        # Extract all-caps words that look like stock symbols
        matches = STOCK_SYMBOL_PATTERN.findall(line_text)
        for sym in matches:
            sym_clean = sym.strip(".").strip()
            if sym_clean in COMMON_NON_STOCK_WORDS:
                continue
            if sym_clean.isdigit():
                continue
            # Store the full line text as the raw task (natural language works too)
            symbols_found.append(sym_clean)
            symbol_lines.append(i)

    if not symbols_found:
        return []

    # Check if each symbol already has a ##RESULT
    tasks = []
    processed_symbols: Set[str] = set()
    for sym, line_idx in zip(symbols_found, symbol_lines):
        if sym in processed_symbols:
            continue
        # Check if a ##RESULT for this symbol exists anywhere in the note
        has_result = False
        for j in range(line_idx + 1, len(lines)):
            line_j = strip_html(lines[j]).strip()
            if result_pattern.search(line_j):
                # Found a result block — check if it mentions this symbol
                for k in range(j, min(j + 20, len(lines))):
                    if sym in strip_html(lines[k]).upper():
                        has_result = True
                        break
                if has_result:
                    break
            # Stop if we hit another implicit symbol or sentinel (next batch)
            if j != line_idx and SENTINEL_LINE in strip_html(lines[j]):
                break
        if not has_result:
            processed_symbols.add(sym)
            tasks.append({
                "raw_text": sym,
            })

    return tasks


def extract_unprocessed_tasks(note_body: str) -> List[Dict]:
    """Find all unprocessed tasks in the note body.

    Two passes:
      1. Explicit ##TASK: directives (works anywhere in the note)
      2. Implicit stock symbols below the sentinel line (no ##TASK: needed)

    Handles HTML-wrapped content (as Notes.app stores rich text as HTML).

    Returns list of task dicts with: raw_text
    """
    # Normalize HTML: replace </div><div> with newlines for line-based scanning
    # Notes.app wraps each paragraph in <div>...</div>
    normalized = note_body
    normalized = re.sub(r"</div>\s*<div[^>]*>", "\n", normalized)
    normalized = re.sub(r"</?div[^>]*>", "\n", normalized)
    normalized = re.sub(r"</?br\s*/?>", "\n", normalized)
    normalized = re.sub(r"</?li[^>]*>", "\n", normalized)
    normalized = re.sub(r"</?ul[^>]*>", "\n", normalized)

    lines = normalized.split("\n")

    result_pattern = re.compile(r"##RESULT:", re.IGNORECASE)

    # Pass 1: explicit ##TASK: directives
    tasks = _find_explicit_tasks(lines, result_pattern)
    if tasks:
        return tasks

    # Pass 2: implicit stock symbols below sentinel (only if no explicit tasks)
    tasks = _find_implicit_tasks(lines, result_pattern)
    return tasks


def execute_task(task: Dict) -> Dict:
    """Delegate a task to the processor script and return result."""
    raw_text = task.get("raw_text", "")
    log.info("Executing: ##TASK: %s", raw_text)

    try:
        result = subprocess.run(
            [sys.executable, str(PROCESSOR_SCRIPT), "--task", raw_text],
            capture_output=True,
            text=True,
            timeout=600,  # 10 min max for scans
            cwd=str(BASE_DIR),
        )
        if result.returncode == 0 and result.stdout:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                pass

        # Fallback: return raw output
        symbol_match = re.search(r"[A-Z]{2,}", raw_text)
        return {
            "status": "COMPLETE",
            "symbol": symbol_match.group(0) if symbol_match else "TASK",
            "prediction": "See raw output",
            "duration": "N/A",
            "raw_output": (result.stdout + result.stderr)[:2000],
        }

    except subprocess.TimeoutExpired:
        return {
            "status": "ERROR",
            "symbol": raw_text.split()[0].upper() if raw_text.split() else "TASK",
            "error": "Task timed out after 600s",
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "symbol": raw_text.split()[0].upper() if raw_text.split() else "TASK",
            "error": str(e),
        }


def _html(val: str) -> str:
    """Escape a value for safe HTML insertion."""
    val = str(val)
    val = val.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return val


def result_to_html(task_raw: str, result: Dict) -> str:
    """Format a task and its result as an HTML block for the note."""
    ts = datetime.now().strftime("%d-%b-%Y %H:%M")
    symbol = _html(result.get("symbol", task_raw.split()[-1] if task_raw.split() else "?"))

    parts = [
        f'<div><br></div><hr><div><br></div>',
    ]

    if result.get("status") == "ERROR":
        parts.append(
            f'<div><span style="color:#cc0000"><b>##RESULT: {ts}</b></span></div>'
            f'<div><span style="color:#cc0000">Status: ERROR</span></div>'
            f'<div><span style="color:#cc0000">Error: {_html(result.get("error", "Unknown"))}</span></div>'
        )
    elif result.get("status") == "HELP":
        parts.append(
            f'<div><b>##RESULT: {ts}</b></div>'
            f'<div>Available commands:</div>'
        )
        # Import help generator
        try:
            from trading_journal_processor import format_help_html, SUPPORTED_COMMANDS
            for cmd, info in SUPPORTED_COMMANDS.items():
                parts.append(
                    f'<div><b>{_html(info["syntax"])}</b> — {_html(info["desc"])}</div>'
                )
        except ImportError:
            parts.append("<div>See trading_journal_processor.py --list-commands</div>")
    else:
        parts.append(
            f'<div><b>##RESULT: {ts} — {symbol}</b></div>'
            f'<div>Status: <span style="color:#008800">COMPLETE</span></div>'
            f'<div>Duration: {_html(result.get("duration", "N/A"))}</div>'
            f'<div><br></div>'
        )
        if result.get("prediction"):
            parts.append(f'<div><b>Prediction:</b> {_html(result["prediction"])}</div>')
        if result.get("confidence"):
            parts.append(f'<div><b>Confidence:</b> {_html(result["confidence"])}</div>')
        if result.get("conviction"):
            parts.append(f'<div><b>Conviction:</b> {_html(result["conviction"])}</div>')
        if result.get("direction"):
            parts.append(f'<div><b>Direction:</b> {_html(result["direction"])}</div>')
        if result.get("chart_patterns"):
            parts.append(f'<div><b>Chart Patterns:</b> {_html(result["chart_patterns"])}</div>')
        if result.get("candle_signals"):
            parts.append(f'<div><b>Candle Signals:</b> {_html(result["candle_signals"])}</div>')
        if result.get("signal_confluence"):
            parts.append(f'<div><b>Signal Confluence:</b> {_html(result["signal_confluence"])}</div>')
        if result.get("detail"):
            parts.append(f'<div>{_html(result["detail"])}</div>')

        error = result.get("error", "")
        if error:
            parts.append(f'<div><span style="color:#cc0000">{_html(error)}</span></div>')

    return "\n".join(parts)


def append_results_to_note(current_body: str, task_raw: str, result: Dict) -> bool:
    """Append result HTML after the task line in the note body."""
    result_html = result_to_html(task_raw, result)
    new_body = current_body + result_html
    return update_note_body(new_body)


# ============================================================================
# TEMPLATE MANAGEMENT
# ============================================================================


def generate_template_html() -> str:
    """Generate the clean Trading Journal template with sentinel separator."""
    return """<div><b><span style="font-size: 24px">Trading Journal</span></b></div>
<div><br></div>
<div><b>Created:</b> 13-Jul-2026</div>
<div><br></div>
<div><b>How to use:</b></div>
<div>Write a stock symbol or question below the line. The watcher auto-detects it.</div>
<div><br></div>
<div><b>Examples that work (below the line):</b></div>
<div>• RELIANCE</div>
<div>• do technical analysis of TCS</div>
<div>• what is the analysis of INFY</div>
<div>• check SBIN stock</div>
<div>• ##TASK: scan 50</div>
<div>• ##TASK: help</div>
<div><br></div>
<div>──────────────────────</div>
<div><b>YOUR TASKS — add below this line:</b></div>
<div>──────────────────────</div>
<div><br></div>
<div><i>Watcher is active. Add your task below.</i><br></div>
<div><br></div>"""


def reset_template() -> bool:
    """Overwrite the Trading Journal note with a clean template.

    Returns True on success.
    """
    current = get_note_body()
    if not current:
        log.warning("Trading Journal note not found — cannot reset")
        return False

    new_body = generate_template_html()
    ok = update_note_body(new_body)
    if ok:
        log.info("Template reset to clean state")
    else:
        log.error("Failed to reset template")
    return ok


# ============================================================================
# POLLING LOOP
# ============================================================================


def get_body_hash(body: str) -> str:
    """Return a hash of the note body for change detection."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def poll_cycle(last_hash: Optional[str]) -> Optional[str]:
    """Run one poll cycle. Returns new hash if body changed, None otherwise.

    Handles note not found, parsing, task execution, and appending results.
    """
    if not note_exists():
        log.warning("Trading Journal note not found — waiting for creation")
        return last_hash

    body = get_note_body()
    if body is None:
        log.warning("Could not read note body")
        return last_hash

    current_hash = get_body_hash(body)

    # Skip if unchanged (and we already have a baseline)
    if last_hash is not None and current_hash == last_hash:
        return current_hash

    log.info("Note changed — scanning for new tasks")

    tasks = extract_unprocessed_tasks(body)
    if not tasks:
        log.debug("No unprocessed tasks found")
        return current_hash

    log.info("Found %d unprocessed task(s)", len(tasks))

    for task in tasks:
        raw = task.get("raw_text", "")
        log.info("  → ##TASK: %s", raw)

        # Execute the task
        result = execute_task(task)

        # Append result to note
        # Re-read body to avoid race conditions with multiple tasks
        current_body = get_note_body()
        if current_body is None:
            log.warning("Could not read note for result append — skipping")
            continue

        # Verify task is still unprocessed (another cycle might have handled it)
        remaining = extract_unprocessed_tasks(current_body)
        still_pending = any(
            t.get("raw_text", "") == raw
            for t in remaining
        )

        if not still_pending:
            log.info("  Task already processed by another cycle — skipping append")
            continue

        success = append_results_to_note(current_body, task["raw_text"], result)
        if success:
            log.info("  ✓ Result appended to note")
        else:
            log.error("  ✗ Failed to append result to note")

        # Small delay between tasks to let Notes sync
        time.sleep(2)

    # Return new hash after all updates
    updated_body = get_note_body()
    return get_body_hash(updated_body) if updated_body else current_hash


def daemon_loop(interval: int = POLL_INTERVAL_SEC, oneshot: bool = False):
    """Main polling loop. Runs forever unless oneshot is True."""
    log.info("=" * 60)
    log.info("Trading Journal Watcher started")
    log.info("Poll interval: %ds", interval)
    log.info("Watching note: %s / %s / %s", NOTE_ACCOUNT, NOTE_FOLDER, NOTE_NAME)
    log.info("Processor: %s", PROCESSOR_SCRIPT)
    log.info("=" * 60)

    last_hash: Optional[str] = None
    cycle = 0

    while True:
        cycle += 1
        try:
            last_hash = poll_cycle(last_hash)
        except Exception as e:
            log.error("Poll cycle %d failed: %s", cycle, e)

        if oneshot:
            log.info("Oneshot cycle complete")
            break

        # Heartbeat every 20 cycles (~10 min) to confirm watcher is alive
        if cycle % 20 == 0:
            log.info("Heartbeat — cycle %d OK, watching %s", cycle, NOTE_NAME)

        time.sleep(interval)


# ============================================================================
# PID FILE MANAGEMENT
# ============================================================================


def write_pid():
    PID_FILE.write_text(str(os.getpid()))


def remove_pid():
    if PID_FILE.exists():
        PID_FILE.unlink()


def is_running() -> bool:
    if not PID_FILE.exists():
        return False
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)  # Check if process exists
        return True
    except (ProcessLookupError, ValueError, OSError):
        remove_pid()
        return False


# ============================================================================
# COMMAND-LINE ENTRY POINT
# ============================================================================


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Trading Journal Watcher — monitors macOS Notes for ##TASK directives",
    )
    parser.add_argument("--daemon", action="store_true",
                        help="Run as daemon (no stdin, write PID)")
    parser.add_argument("--oneshot", action="store_true",
                        help="Single poll cycle (for testing)")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SEC,
                        help=f"Poll interval in seconds (default: {POLL_INTERVAL_SEC})")
    parser.add_argument("--read", action="store_true",
                        help="Read and display current note body (for debugging)")
    parser.add_argument("--reset-template", action="store_true",
                        help="Reset note to clean template with sentinel separator")
    args = parser.parse_args()

    # Ensure log directory exists
    log_dir = BASE_DIR / "logs"
    log_dir.mkdir(exist_ok=True)

    # File handler for persistent logging
    fh = logging.FileHandler(str(WATCHER_LOG))
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    log.addHandler(fh)

    if args.reset_template:
        if reset_template():
            print("✓ Template reset. Note now has sentinel line for implicit task detection.")
        else:
            print("✗ Failed to reset template. Is the Trading Journal note accessible?")
        return

    if args.read:
        body = get_note_body()
        if body:
            print(body)
        else:
            print("Trading Journal note not found")
        return

    if args.daemon:
        if is_running():
            print(f"Watcher already running (PID {PID_FILE.read_text().strip()})")
            sys.exit(1)
        write_pid()
        log.info("Daemon mode — PID %d", os.getpid())

    try:
        daemon_loop(interval=args.interval, oneshot=args.oneshot)
    except KeyboardInterrupt:
        log.info("Shutdown requested")
    finally:
        if args.daemon:
            remove_pid()
        log.info("Watcher stopped")


if __name__ == "__main__":
    main()
