#!/usr/bin/env bash
# Deploy current workspace build to the live demo API on :8787.
# Does NOT touch the phone tunnel (SSH / localhost.run) — the public URL stays.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMUX_CFG="/exec-daemon/tmux.portal.conf"
SESSION="attest-server"
PORT="${PORT:-8787}"

cd "$ROOT"

echo "[deploy-live] building client…"
npm run build

echo "[deploy-live] restarting API in tmux session '$SESSION' (tunnel left alone)…"
if ! tmux -f "$TMUX_CFG" has-session -t "=$SESSION" 2>/dev/null; then
  tmux -f "$TMUX_CFG" new-session -d -s "$SESSION" -c "$ROOT" -- "${SHELL:-bash}" -l
fi

# Stop only the node server process listening on PORT — never the tunnel.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
else
  # Fallback: kill node src/index.js only
  ps aux | awk '/node src\/index\.js/ && !/awk/ {print $2}' | while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done
fi
sleep 1

tmux -f "$TMUX_CFG" send-keys -t "${SESSION}:0.0" C-c 2>/dev/null || true
sleep 1
tmux -f "$TMUX_CFG" send-keys -t "${SESSION}:0.0" "cd '$ROOT' && NODE_ENV=production npm start" Enter

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/api/health"; then
    echo "[deploy-live] API healthy on :${PORT}"
    if [[ -f "$ROOT/TUNNEL_URL.txt" ]]; then
      url="$(tr -d '[:space:]' < "$ROOT/TUNNEL_URL.txt")"
      echo "[deploy-live] public URL unchanged: $url"
      code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/api/health" || echo 000)
      echo "[deploy-live] public health: $code"
    else
      echo "[deploy-live] no TUNNEL_URL.txt yet — start scripts/keep-tunnel-alive.sh once"
    fi
    exit 0
  fi
  sleep 1
done

echo "[deploy-live] API failed to become healthy" >&2
exit 1
