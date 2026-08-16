#!/usr/bin/env bash
# One-time (or recovery) bring-up of live demo API + phone tunnel.
# After this, use scripts/deploy-live.sh to publish code changes without
# changing the public URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMUX_CFG="/exec-daemon/tmux.portal.conf"

cd "$ROOT"
chmod +x "$ROOT/scripts/deploy-live.sh" "$ROOT/scripts/keep-tunnel-alive.sh"

"$ROOT/scripts/deploy-live.sh"

# Start tunnel only if not already running.
if ps aux | grep -v grep | grep -q 'keep-tunnel-alive.sh'; then
  echo "[start-live] tunnel watchdog already running"
else
  if ! tmux -f "$TMUX_CFG" has-session -t "=attest-tunnel" 2>/dev/null; then
    tmux -f "$TMUX_CFG" new-session -d -s "attest-tunnel" -c "$ROOT" -- "${SHELL:-bash}" -l
  fi
  tmux -f "$TMUX_CFG" send-keys -t "attest-tunnel:0.0" "bash '$ROOT/scripts/keep-tunnel-alive.sh'" Enter
  echo "[start-live] started tunnel watchdog"
fi

for i in $(seq 1 40); do
  if [[ -s "$ROOT/TUNNEL_URL.txt" ]]; then
    echo "[start-live] $(cat "$ROOT/TUNNEL_URL.txt")"
    exit 0
  fi
  sleep 1
done

echo "[start-live] tunnel URL not ready yet — check tmux attest-tunnel /tmp/phone-tunnel.log" >&2
exit 1
