#!/usr/bin/env bash
# Resume watcher for ALE r2: poll every ~40min; remediate only if service dead or Codex fetch-failed.
set -u
STATUS_LOCAL="/Users/huchenrui/Documents/metis_v2/out/ale-audit/r2-resume-monitor.log"
SSH_BASE=(ssh -p 10022 -i "$HOME/oliver-credentials/oliver_ed25519" -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=accept-new oliver@192.168.1.64)
INTERVAL_SEC=2400  # 40 minutes
mkdir -p "$(dirname "$STATUS_LOCAL")"
exec >>"$STATUS_LOCAL" 2>&1
echo "resume_watcher_start $(date '+%F %T') pid=$$ interval=${INTERVAL_SEC}s"

remote() {
  "${SSH_BASE[@]}" "$@"
}

remediate() {
  local reason="$1"
  echo "REMEDIATE reason=$reason at $(date '+%F %T')"
  remote 'bash -lc "
set -u
echo --- remediate begin ---
if systemctl --user list-unit-files sing-box.service >/dev/null 2>&1; then
  systemctl --user restart sing-box.service || true
  sleep 2
  systemctl --user is-active sing-box.service || true
fi
if ! pgrep -af \"socat TCP-LISTEN:7890,bind=172.17.0.1\" >/dev/null; then
  nohup socat TCP-LISTEN:7890,bind=172.17.0.1,fork,reuseaddr TCP:127.0.0.1:7890 >/tmp/socat-7890.log 2>&1 &
  sleep 1
fi
pgrep -af \"sing-box|socat TCP-LISTEN:7890\" | head -5 || true
curl -sS -o /dev/null -w \"proxy_chatgpt=%{http_code}\\n\" --connect-timeout 8 --max-time 15 -x http://127.0.0.1:7890 https://chatgpt.com/ || echo proxy_chatgpt=FAIL
systemctl --user restart ale-metis-99-r2.service
sleep 3
systemctl --user is-active ale-metis-99-r2.service
systemctl --user status ale-metis-99-r2.service --no-pager -l | head -20
echo --- remediate end ---
"'
}

for i in $(seq 1 120); do
  echo "==== resume poll=$i $(date '+%F %T') ===="
  if ! out=$(remote 'bash -lc "
set -u
bash ~/ale-bench/scripts/monitor_r2.sh
echo ---
bash ~/ale-bench/logs/audit/monitor-r2-once.sh 2>/dev/null | tail -40
echo ---
systemctl --user is-active ale-metis-99-r2.service
systemctl --user is-active sing-box.service 2>/dev/null || echo sing-box_unknown
pgrep -af \"socat TCP-LISTEN:7890,bind=172.17.0.1\" | head -1 || echo SOCAT_MISSING
echo FETCH_HITS=\$(tail -n 2000 ~/ale-bench/logs/ale-99-r2-run.log 2>/dev/null | grep -Eic \"fetch-failed|Fetch failed|APIConnectionError\" || echo 0)
free -h | head -2
df -h / | tail -1
docker ps --format \"{{.Names}} {{.Status}}\" 2>/dev/null | head -5
"'); then
    out="SSH_FAIL: $?"
  fi
  echo "$out"

  finished=$(echo "$out" | grep -E 'run\.json finished:' | tail -1 | awk '{print $NF}')
  best=$(echo "$out" | grep -Eo 'best_tasks=[0-9]+/98' | tail -1)
  active=$(echo "$out" | grep -E '^(active|inactive|failed|activating|deactivating)$' | head -1)
  cats=$(echo "$out" | grep -E '^cats ' | tail -1)
  fetch_hits=$(echo "$out" | grep -Eo 'FETCH_HITS=[0-9]+' | tail -1 | cut -d= -f2)
  echo "parsed finished=${finished:-?} best=${best:-?} active=${active:-?} fetch_hits=${fetch_hits:-?} $cats"

  if echo "$out" | grep -q 'SSH_FAIL:'; then
    echo "SSH_BLOCKER $(date '+%F %T')"
    exit 2
  fi
  if echo "$out" | grep -qiE 'No space left|ENOSPC'; then
    echo "DISK_BLOCKER $(date '+%F %T')"
    exit 2
  fi
  if [ "${finished:-0}" = "98" ]; then
    echo "DONE 98/98 $(date '+%F %T')"
    exit 0
  fi

  need_fix=0
  reason=""
  if [ "${active:-active}" != "active" ]; then
    need_fix=1
    reason="service_${active:-empty}"
  fi
  if echo "$out" | grep -q 'SOCAT_MISSING'; then
    need_fix=1
    reason="socat_missing"
  fi
  if [ "${fetch_hits:-0}" != "0" ] && [ -n "${fetch_hits:-}" ]; then
    recent=$(remote 'bash -lc "tail -n 400 ~/ale-bench/logs/ale-99-r2-run.log | grep -Eic \"fetch-failed|Fetch failed\" || echo 0"' 2>/dev/null || echo 0)
    if [ "${recent:-0}" != "0" ]; then
      need_fix=1
      reason="codex_fetch_failed_hits=${recent}"
    fi
  fi

  if [ "$need_fix" = "1" ]; then
    remediate "${reason:-unknown}"
    sleep 90
    post=$(remote 'bash -lc "systemctl --user is-active ale-metis-99-r2.service"' 2>/dev/null || echo unknown)
    echo "post_remediate active=$post"
    if [ "$post" != "active" ]; then
      echo "REMEDIATE_FAILED $(date '+%F %T')"
      exit 2
    fi
  fi

  sleep "$INTERVAL_SEC"
done
echo "WATCHER_EXHAUSTED $(date '+%F %T')"
exit 3
