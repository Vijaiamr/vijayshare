#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  install_service.sh — register systemd timer for the daily analysis
#
#  Run on the Pi:   bash install_service.sh
#
#  Creates:
#    /etc/systemd/system/vijaymaruthi-analysis.service
#    /etc/systemd/system/vijaymaruthi-analysis.timer   (Mon-Fri 19:30 IST)
#    /etc/systemd/system/vijaymaruthi-cloud-sync.service
#    /etc/systemd/system/vijaymaruthi-cloud-sync.timer (daily 15:30 IST)
#
#  View status:  systemctl list-timers 'vijaymaruthi-*'
#  Logs:         journalctl -u vijaymaruthi-analysis -f
#  Disable:      sudo systemctl disable --now vijaymaruthi-analysis.timer
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root:  sudo bash install_service.sh"
    exit 1
fi

# ── Daily analysis: Mon-Fri 19:30 IST ──
cat > /etc/systemd/system/vijaymaruthi-analysis.service <<EOF
[Unit]
Description=VijayMaruthi daily NSE analysis
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=$ROOT/run_daily.sh --limit 100
EOF

cat > /etc/systemd/system/vijaymaruthi-analysis.timer <<EOF
[Unit]
Description=Run VijayMaruthi daily analysis Mon-Fri 19:30 IST

[Timer]
OnCalendar=Mon..Fri 19:30
Persistent=true

[Install]
WantedBy=timers.target
EOF

# ── Cloud sync: daily 15:30 IST ──
cat > /etc/systemd/system/vijaymaruthi-cloud-sync.service <<EOF
[Unit]
Description=VijayMaruthi cloud OHLCV sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=$ROOT/run_cloud_sync.sh
EOF

cat > /etc/systemd/system/vijaymaruthi-cloud-sync.timer <<EOF
[Unit]
Description=Run VijayMaruthi cloud sync daily 15:30 IST

[Timer]
OnCalendar=*-*-* 15:30
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now vijaymaruthi-analysis.timer
systemctl enable --now vijaymaruthi-cloud-sync.timer

echo "=== Timers registered ==="
systemctl list-timers 'vijaymaruthi-*' --no-pager