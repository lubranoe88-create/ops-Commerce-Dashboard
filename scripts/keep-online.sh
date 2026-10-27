#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/home/ubuntu/.fly/bin:/usr/local/bin:$PATH"
mkdir -p "$ROOT/backend/data" /tmp/ops-dash

start_server() {
  if ! curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo "[keep] starting node server"
    (cd "$ROOT/backend" && node src/server.js >>/tmp/ops-dash/server.log 2>&1 &)
    sleep 1
  fi
}

start_tunnel() {
  if ! pgrep -f 'cloudflared tunnel --url' >/dev/null 2>&1; then
    echo "[keep] starting cloudflared"
    nohup /tmp/cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate \
      >>/tmp/ops-dash/tunnel.log 2>&1 &
    sleep 3
  fi
  grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /tmp/ops-dash/tunnel.log 2>/dev/null | tail -1 \
    || grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /home/ubuntu/.cursor/projects/agent/terminals/712280.txt 2>/dev/null | tail -1 \
    || true
}

while true; do
  start_server
  start_tunnel
  sleep 20
done
