#!/usr/bin/env bash
set -euo pipefail
# Run as root from the installed project; environment file must be mode 600.
project="$(pwd -P)"
python_bin="${EXPORT_PYTHON:-$project/.export-venv/bin/python}"
[[ -x "$python_bin" ]] || { echo 'Install .export-venv and cos-python-sdk-v5 first'; exit 1; }
[[ -f "$project/.env.cos" ]] || { echo 'Create mode-600 .env.cos with COS credentials and absolute DATA_DIR'; exit 1; }
chmod 600 "$project/.env.cos"
cat > /etc/systemd/system/big-pump-export.service <<EOF
[Unit]
Description=Export previous 24h big-pump data to private COS
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
WorkingDirectory="$project"
EnvironmentFile="$project/.env.cos"
ExecStart="$python_bin" "$project/scripts/export_daily.py" --upload
UMask=0077
TimeoutStartSec=1800
Restart=on-failure
RestartSec=300
EOF
cat > /etc/systemd/system/big-pump-export.timer <<'EOF'
[Unit]
Description=Daily big-pump export at 06:00 Beijing time
[Timer]
OnCalendar=*-*-* 06:00:00 Asia/Shanghai
Persistent=true
AccuracySec=1s
Unit=big-pump-export.service
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now big-pump-export.timer
systemctl list-timers big-pump-export.timer
