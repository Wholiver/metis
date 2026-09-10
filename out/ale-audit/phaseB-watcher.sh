#!/usr/bin/env bash
# Local Phase-B watcher: poll remote r2 status every ~45min until 98/98 or service down.
set -u
STATUS_LOCAL="/Users/huchenrui/Documents/metis_v2/out/ale-audit/phaseB-monitor.log"
SSH=(ssh -p 10022 -i "$HOME/oliver-credentials/oliver_ed25519" -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new oliver@192.168.1.64)
mkdir -p "$(dirname "$STATUS_LOCAL")"
echo "local_watcher_start $(date '+%F %T')" | tee -a "$STATUS_LOCAL"

for i in $(seq 1 120); do
  echo "==== local poll=$i $(date '+%F %T') ====" | tee -a "$STATUS_LOCAL"
  out=$("${SSH[@]}" 'bash ~/ale-bench/logs/audit/monitor-r2-once.sh; echo ---; tail -5 ~/ale-bench/logs/audit/monitor-r2-daemon.log; echo ---; systemctl --user is-active ale-metis-99-r2.service; free -h | head -2; docker stats --no-stream --format "{{.Name}} mem={{.MemUsage}} cpu={{.CPUPerc}}" 2>/dev/null | head -3' 2>&1) || out="SSH_FAIL: $?"
  echo "$out" | tee -a "$STATUS_LOCAL"
  finished=$(echo "$out" | grep -E 'run\.json finished:' | tail -1 | awk '{print $NF}')
  active=$(echo "$out" | grep -E '^(active|inactive|failed|unknown)$' | tail -1)
  cats=$(echo "$out" | grep -E '^cats ' | tail -1)
  echo "parsed finished=${finished:-?} active=${active:-?} $cats" | tee -a "$STATUS_LOCAL"

  # infra blocker heuristics
  if echo "$out" | grep -qiE 'SERVICE_NOT_ACTIVE|SSH_FAIL|Cannot connect to the Docker|No space left|ENOSPC'; then
    echo "BLOCKER_DETECTED $(date '+%F %T')" | tee -a "$STATUS_LOCAL"
    exit 2
  fi
  if [ "${finished:-0}" = "98" ]; then
    echo "DONE 98/98 $(date '+%F %T')" | tee -a "$STATUS_LOCAL"
    exit 0
  fi
  if [ "${active:-active}" != "active" ] && [ -n "${active:-}" ]; then
    echo "SERVICE_DOWN=$active $(date '+%F %T')" | tee -a "$STATUS_LOCAL"
    exit 2
  fi
  # 45 minutes
  sleep 2700
done
echo "WATCHER_EXHAUSTED $(date '+%F %T')" | tee -a "$STATUS_LOCAL"
exit 3
