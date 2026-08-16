#!/usr/bin/env bash
# Keep Cloudflare quick tunnel alive for phone demos.
# - Restarts cloudflared if it exits
# - Pings the public URL every ~45s to reduce idle drops
# - Writes the live URL to /workspace/TUNNEL_URL.txt
set -u

CF_BIN="${CF_BIN:-/home/ubuntu/.npm/_npx/8a26fc3a61fe4212/node_modules/cloudflared/bin/cloudflared}"
TARGET_URL="${TARGET_URL:-http://127.0.0.1:8787}"
URL_FILE="${URL_FILE:-/workspace/TUNNEL_URL.txt}"
LOG_FILE="${LOG_FILE:-/tmp/cf-tunnel.log}"
PING_EVERY_SEC="${PING_EVERY_SEC:-45}"

extract_url() {
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true
}

ping_loop() {
  while true; do
    sleep "$PING_EVERY_SEC"
    local url
    url="$(extract_url)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url" > "$URL_FILE"
      curl -fsS -o /dev/null --max-time 15 "$url/api/health" >/dev/null 2>&1 || true
      curl -fsS -o /dev/null --max-time 5 "$TARGET_URL/api/health" >/dev/null 2>&1 || true
    fi
  done
}

: > "$LOG_FILE"
ping_loop &
PING_PID=$!
trap 'kill "$PING_PID" 2>/dev/null || true' EXIT

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[tunnel-keepalive] start attempt=$attempt $(date -u +%FT%TZ)" >> "$LOG_FILE"
  # http2 is more stable than quic in this environment (fewer idle timeouts)
  "$CF_BIN" tunnel --no-autoupdate --protocol http2 --url "$TARGET_URL" >> "$LOG_FILE" 2>&1 &
  CF_PID=$!

  url=""
  for _ in $(seq 1 40); do
    sleep 1
    url="$(extract_url)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url" > "$URL_FILE"
      echo "[tunnel-keepalive] public url: $url" >> "$LOG_FILE"
      echo "$url"
      break
    fi
    if ! kill -0 "$CF_PID" 2>/dev/null; then
      break
    fi
  done

  wait "$CF_PID" || true
  echo "[tunnel-keepalive] exited; restarting in 3s $(date -u +%FT%TZ)" >> "$LOG_FILE"
  sleep 3
done
