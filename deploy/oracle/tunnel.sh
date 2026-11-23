#!/usr/bin/env bash
# Opens a Cloudflare quick tunnel to the worker and tells the web app the address, now and every 2 minutes.
set -u
LOG=/var/tmp/cloudflared.log
: > "$LOG"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080 >"$LOG" 2>&1 &
CF=$!
trap 'kill "$CF" 2>/dev/null' EXIT

URL=""
for _ in $(seq 1 90); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "Tunnel did not start"; exit 1; }
echo "Tunnel address: $URL"

while kill -0 "$CF" 2>/dev/null; do
  if curl -fsS -m 20 -X POST "$APP_URL/api/worker/register" \
      -H "authorization: Bearer $WORKER_TOKEN" -H 'content-type: application/json' \
      -d "{\"url\":\"$URL\"}" >/dev/null; then echo "Registered $URL"; else echo "Could not register yet"; fi
  sleep 120
done
exit 1
