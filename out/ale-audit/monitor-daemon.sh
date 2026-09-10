#!/bin/bash
set -u
STATUS="/Users/huchenrui/Documents/metis_v2/out/ale-audit/monitor-live.txt"
LOG="/Users/huchenrui/Documents/metis_v2/out/ale-audit/monitor-daemon.log"
SSH_CMD=(ssh -p 10022 -i "$HOME/oliver-credentials/oliver_ed25519" -o StrictHostKeyChecking=no -o ConnectTimeout=20 oliver@192.168.1.64)
echo "daemon_start $(date '+%F %T') pid=$$" | tee -a "$LOG" "$STATUS"
for i in $(seq 1 64); do
  echo "$(date '+%F %T') poll=$i" | tee -a "$STATUS" "$LOG"
  if ! "${SSH_CMD[@]}" '~/ale-bench/logs/audit/monitor-r2-once.sh' >> "$STATUS" 2>> "$LOG"; then
    echo "ssh_fail poll=$i at $(date '+%F %T')" | tee -a "$STATUS" "$LOG"
  fi
  finished=$(grep -E 'run\.json finished:' "$STATUS" | tail -1 | awk '{print $NF}')
  active=$("${SSH_CMD[@]}" 'systemctl --user is-active ale-metis-99-r2.service' 2>/dev/null || echo unknown)
  echo "parsed finished=${finished:-?} active=$active" | tee -a "$STATUS" "$LOG"
  if [ "${finished:-0}" = "98" ]; then
    echo "DONE 98/98 at $(date '+%F %T')" | tee -a "$STATUS" "$LOG"
    exit 0
  fi
  if [ "$active" != "active" ]; then
    echo "SERVICE_NOT_ACTIVE=$active at $(date '+%F %T')" | tee -a "$STATUS" "$LOG"
    "${SSH_CMD[@]}" 'systemctl --user status ale-metis-99-r2.service --no-pager -l | head -50' >> "$STATUS" 2>&1 || true
    # If service died early, exit so human/agent notices
    exit 2
  fi
  # 45 min
  sleep 2700
done
echo "monitor_max_polls_reached at $(date '+%F %T')" | tee -a "$STATUS" "$LOG"
