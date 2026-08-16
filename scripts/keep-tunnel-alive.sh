#!/usr/bin/env bash
# Phone-demo public tunnel via localhost.run (SSH reverse proxy).
# Cloudflare quick tunnels were dying with HTTP 530 while the process
# still looked healthy. This watchdog:
#   1) uses SSH ServerAlive to prevent idle drops
#   2) health-checks the public URL every 20s
#   3) fully restarts if the public URL stops returning 200
set -u

TARGET_HOST="${TARGET_HOST:-127.0.0.1}"
TARGET_PORT="${TARGET_PORT:-8787}"
URL_FILE="${URL_FILE:-/workspace/TUNNEL_URL.txt}"
LOG_FILE="${LOG_FILE:-/tmp/phone-tunnel.log}"
PING_EVERY_SEC="${PING_EVERY_SEC:-20}"
FAILS_BEFORE_RESTART="${FAILS_BEFORE_RESTART:-2}"

: > "$LOG_FILE"

extract_url() {
  grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LOG_FILE" 2>/dev/null | tail -1 || true
}

public_ok() {
  local url="$1"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/api/health" 2>/dev/null || echo 000)
  [[ "$code" == "200" ]]
}

start_tunnel() {
  # No remote command: localhost.run streams the assigned *.lhr.life URL on connect.
  # stdin from /dev/null keeps ssh non-interactive but still connected.
  ssh -T \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=20 \
    -R "80:${TARGET_HOST}:${TARGET_PORT}" \
    nokey@localhost.run \
    </dev/null >>"$LOG_FILE" 2>&1 &
  echo $!
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[phone-tunnel] start attempt=$attempt $(date -u +%FT%TZ)" | tee -a "$LOG_FILE"

  SSH_PID=$(start_tunnel)

  url=""
  for _ in $(seq 1 45); do
    sleep 1
    url="$(extract_url)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url" > "$URL_FILE"
      echo "[phone-tunnel] public url: $url" | tee -a "$LOG_FILE"
      break
    fi
    if ! kill -0 "$SSH_PID" 2>/dev/null; then
      break
    fi
  done

  fails=0
  while kill -0 "$SSH_PID" 2>/dev/null; do
    sleep "$PING_EVERY_SEC"
    url="$(extract_url)"
    if [[ -z "$url" ]]; then
      fails=$((fails + 1))
    elif public_ok "$url"; then
      fails=0
      printf '%s\n' "$url" > "$URL_FILE"
      curl -fsS -o /dev/null --max-time 5 "http://${TARGET_HOST}:${TARGET_PORT}/api/health" >/dev/null 2>&1 || true
    else
      fails=$((fails + 1))
      echo "[phone-tunnel] public health fail=$fails url=$url $(date -u +%FT%TZ)" | tee -a "$LOG_FILE"
    fi
    if (( fails >= FAILS_BEFORE_RESTART )); then
      echo "[phone-tunnel] restarting after $fails failed health checks" | tee -a "$LOG_FILE"
      kill "$SSH_PID" 2>/dev/null || true
      wait "$SSH_PID" 2>/dev/null || true
      break
    fi
  done

  kill "$SSH_PID" 2>/dev/null || true
  wait "$SSH_PID" 2>/dev/null || true
  echo "[phone-tunnel] tunnel ended; retry in 3s $(date -u +%FT%TZ)" | tee -a "$LOG_FILE"
  sleep 3
done
