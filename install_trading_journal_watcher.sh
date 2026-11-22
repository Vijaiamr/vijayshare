#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Trading Journal Watcher — Installer
# ──────────────────────────────────────────────────────────────────────────────
# Installs the launchd plist so the watcher starts automatically on login
# and runs in the background, monitoring your Trading Journal note.
#
# Usage:
#   chmod +x install_trading_journal_watcher.sh
#   ./install_trading_journal_watcher.sh
#
# Uninstall:
#   ./install_trading_journal_watcher.sh --uninstall
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SOURCE="${SCRIPT_DIR}/com.vijaymaruthi.trading-journal-watcher.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.vijaymaruthi.trading-journal-watcher.plist"
PLIST_LABEL="com.vijaymaruthi.trading-journal-watcher"
WATCHER_SCRIPT="${SCRIPT_DIR}/trading_journal_watcher.py"
PROCESSOR_SCRIPT="${SCRIPT_DIR}/trading_journal_processor.py"
LOG_DIR="${SCRIPT_DIR}/logs"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Uninstall ──
if [[ "${1:-}" == "--uninstall" ]]; then
    info "Uninstalling Trading Journal Watcher..."

    # Unload if running
    if launchctl list "${PLIST_LABEL}" &>/dev/null 2>&1; then
        launchctl bootout "gui/$(id -u)" "${PLIST_DEST}" 2>/dev/null || true
        ok "Stopped and unloaded launchd job"
    fi

    # Remove plist
    if [[ -f "${PLIST_DEST}" ]]; then
        rm -f "${PLIST_DEST}"
        ok "Removed ${PLIST_DEST}"
    fi

    # Remove PID file
    rm -f /tmp/trading_journal_watcher.pid

    info "Uninstall complete."
    exit 0
fi

# ── Install ──
echo ""
echo "┌────────────────────────────────────────────────────────────────┐"
echo "│        Trading Journal Watcher — Installer                     │"
echo "└────────────────────────────────────────────────────────────────┘"
echo ""

# 1. Verify files exist
info "Checking prerequisites..."
for f in "${WATCHER_SCRIPT}" "${PROCESSOR_SCRIPT}" "${PLIST_SOURCE}"; do
    if [[ ! -f "$f" ]]; then
        err "Missing required file: $f"
        exit 1
    fi
done
ok "All required files present"

# 2. Ensure scripts are executable
chmod +x "${WATCHER_SCRIPT}" "${PROCESSOR_SCRIPT}" 2>/dev/null || true

# 3. Test Python imports
info "Testing Python modules..."
python3 -c "import sys; sys.path.insert(0, '${SCRIPT_DIR}'); from trading_journal_processor import parse_tasks, process_task; print('  ✓ processor module OK')" 2>&1 || {
    err "Python import test failed"
    exit 1
}
python3 -c "import sys; sys.path.insert(0, '${SCRIPT_DIR}'); from trading_journal_watcher import note_exists, get_note_body; print('  ✓ watcher module OK')" 2>&1 || {
    err "Python import test failed"
    exit 1
}
ok "Python modules verified"

# 4. Test Notes app access
info "Testing Notes app access..."
NOTE_TEST=$(osascript -e 'tell application "Notes" to get name of every account' 2>&1)
if echo "${NOTE_TEST}" | grep -qi "iCloud"; then
    ok "Notes app accessible — found account: ${NOTE_TEST}"
else
    warn "Could not detect iCloud account in Notes. Got: ${NOTE_TEST}"
    warn "Make sure you're signed into iCloud with Notes enabled"
fi

# 5. Check if Trading Journal note exists
info "Checking Trading Journal note..."
NOTE_EXISTS=$(osascript -e 'tell application "Notes" to return (exists note "Trading Journal" of folder "Notes" of account "iCloud")')
if [[ "${NOTE_EXISTS}" == "true" ]]; then
    ok "Trading Journal note already exists"
else
    info "Creating Trading Journal note..."
    osascript -e 'tell application "Notes" to make new note at folder "Notes" of account "iCloud" with properties {name:"Trading Journal", body:"<h1>Trading Journal</h1><div><br></div><div><b>Created:</b> 13-Jul-2026</div><div><br></div><hr><div><br></div><div><i>Waiting for tasks...</i></div>"}'
    ok "Trading Journal note created"
fi

# 6. Ensure logs directory
mkdir -p "${LOG_DIR}"

# 7. Ensure LaunchAgents directory exists
mkdir -p "${HOME}/Library/LaunchAgents"

# 8. Install launchd plist
info "Installing launchd plist..."
cp "${PLIST_SOURCE}" "${PLIST_DEST}"
ok "Copied plist to ${PLIST_DEST}"

# 9. Load launchd job
info "Starting watcher..."
if launchctl list "${PLIST_LABEL}" &>/dev/null 2>&1; then
    warn "Watcher already loaded — reloading"
    launchctl bootout "gui/$(id -u)" "${PLIST_DEST}" 2>/dev/null || true
    sleep 1
fi

if launchctl bootstrap "gui/$(id -u)" "${PLIST_DEST}" 2>&1; then
    ok "Watcher started successfully via launchd"
else
    err "Failed to start watcher via launchd"
    err "Try: launchctl bootstrap gui/$(id -u) ${PLIST_DEST}"
    exit 1
fi

# 10. Verify it's running
sleep 2
if launchctl list "${PLIST_LABEL}" &>/dev/null 2>&1; then
    PID=$(launchctl list "${PLIST_LABEL}" | awk '{print $1}')
    ok "Watcher is running (PID: ${PID:-unknown})"
else
    warn "Watcher may not have started. Check logs:"
    warn "  ${LOG_DIR}/trading_journal_watcher.stdout.log"
    warn "  ${LOG_DIR}/trading_journal_watcher.stderr.log"
fi

echo ""
echo "┌────────────────────────────────────────────────────────────────┐"
echo "│                      ✅ Installation Complete                  │"
echo "├────────────────────────────────────────────────────────────────┤"
echo "│                                                                │"
echo "│  The watcher is now running in the background.                 │"
echo "│  It checks your Trading Journal note every 30 seconds          │"
echo "│  for new ##TASK: directives.                                   │"
echo "│                                                                │"
echo "│  TRY THIS → Open the Notes app, open Trading Journal,          │"
echo "│             and write:                                         │"
echo "│               ##TASK: help                                     │"
echo "│             Save (⌘+S) and wait ~30s — results appear below!   │"
echo "│                                                                │"
echo "│  Commands:                                                     │"
echo "│    ##TASK: analyze RELIANCE DAILY                              │"
echo "│    ##TASK: analyze HDFCBANK WEEKLY                             │"
echo "│    ##TASK: scan 50                                             │"
echo "│    ##TASK: help                                                │"
echo "│                                                                │"
echo "│  Logs:                                                         │"
echo "│    tail -f ${LOG_DIR}/trading_journal_watcher.log              │"
echo "│                                                                │"
echo "│  Uninstall:                                                    │"
echo "│    ./install_trading_journal_watcher.sh --uninstall            │"
echo "│                                                                │"
echo "└────────────────────────────────────────────────────────────────┘"
echo ""
