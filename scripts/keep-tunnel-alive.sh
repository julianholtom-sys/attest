#!/usr/bin/env bash
# Phone-demo public tunnel via localhost.run (SSH reverse proxy).
#
# IMPORTANT: Do NOT restart this when deploying code. Restarting SSH always
# mints a new *.lhr.life hostname. Only restart when the SSH process itself
# dies, or when the public URL fails while the local API is healthy.
set -u

TARGET_HOST="${TARGET_HOST:-127.0.0.1}"
TARGET_PORT="${TARGET_PORT:-8787}"
URL_FILE="${URL_FILE:-/workspace/TUNNEL_URL.txt}"
LOG_FILE="${LOG_FILE:-/tmp/phone-tunnel.log}"
PING_EVERY_SEC="${PING_EVERY_SEC:-30}"
FAILS_BEFORE_RESTART="${FAILS_BEFORE_RESTART:-5}"

local_ok() {
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    "http://${TARGET_HOST}:${TARGET_PORT}/api/health" 2>/dev/null || echo 000)
  [[ "$code" == "200" ]]
}

public_ok() {
  local url="$1"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/api/health" 2>/dev/null || echo 000)
  [[ "$code" == "200" ]]
}

extract_url() {
  grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LOG_FILE" 2>/dev/null | tail -1 || true
}

start_tunnel() {
  # Append logs — never truncate while a session may still be useful for debugging.
  ssh -T \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=6 \
    -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=20 \
    -o TCPKeepAlive=yes \
    -R "80:${TARGET_HOST}:${TARGET_PORT}" \
    nokey@localhost.run \
    </dev/null >>"$LOG_FILE" 2>&1 &
  echo $!
}

touch "$LOG_FILE"
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

    # While the app is restarting/deploying, public checks may fail. Wait —
    # do NOT recycle the SSH tunnel or the public hostname will change.
    if ! local_ok; then
      echo "[phone-tunnel] local API down; holding tunnel open $(date -u +%FT%TZ)" >> "$LOG_FILE"
      fails=0
      continue
    fi

    url="$(extract_url)"
    if [[ -z "$url" && -f "$URL_FILE" ]]; then
      url="$(tr -d '[:space:]' < "$URL_FILE")"
    fi

    if [[ -z "$url" ]]; then
      fails=$((fails + 1))
    elif public_ok "$url"; then
      fails=0
      printf '%s\n' "$url" > "$URL_FILE"
    else
      fails=$((fails + 1))
      echo "[phone-tunnel] public health fail=$fails (local OK) url=$url $(date -u +%FT%TZ)" | tee -a "$LOG_FILE"
    fi

    if (( fails >= FAILS_BEFORE_RESTART )); then
      echo "[phone-tunnel] restarting SSH after $fails public failures while local API healthy" | tee -a "$LOG_FILE"
      kill "$SSH_PID" 2>/dev/null || true
      wait "$SSH_PID" 2>/dev/null || true
      break
    fi
  done

  kill "$SSH_PID" 2>/dev/null || true
  wait "$SSH_PID" 2>/dev/null || true
  echo "[phone-tunnel] ssh ended; retry in 5s $(date -u +%FT%TZ)" | tee -a "$LOG_FILE"
  sleep 5
done
