#!/usr/bin/env bash
# Installs the Video Studio media worker on an Ubuntu machine (Oracle Always Free Ampere works).
# Runs as root (cloud-init does this). Needs these variables, passed in the environment:
#   APP_URL WORKER_TOKEN CALLBACK_SECRET R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
# Optional: GEMINI_API_KEY
set -euo pipefail
exec > >(tee -a /var/log/video-studio-setup.log) 2>&1

for v in APP_URL WORKER_TOKEN CALLBACK_SECRET R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [ -n "${!v:-}" ] || { echo "Missing $v"; exit 1; }
done
REPO=https://github.com/Priest98/Video-studio.git
DIR=/opt/video-studio
ARCH=$(dpkg --print-architecture)

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ffmpeg fonts-liberation git curl ca-certificates python3 python3-venv python3-pip

if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  dpkg -i /tmp/cloudflared.deb
fi

id vstudio >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin vstudio
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install --upgrade pip
"$DIR/venv/bin/pip" install -r "$DIR/workers/media/requirements.txt" faster-whisper
chmod +x "$DIR/deploy/oracle/tunnel.sh"
mkdir -p /var/tmp/video-studio && chown vstudio:vstudio /var/tmp/video-studio

mkdir -p /etc/video-studio
umask 077
cat > /etc/video-studio/worker.env <<ENV
APP_URL=$APP_URL
WORKER_TOKEN=$WORKER_TOKEN
CALLBACK_SECRET=$CALLBACK_SECRET
R2_ACCOUNT_ID=$R2_ACCOUNT_ID
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
R2_BUCKET=$R2_BUCKET
GEMINI_API_KEY=${GEMINI_API_KEY:-}
WORKER_CONCURRENCY=1
WORK_ROOT=/var/tmp/video-studio
ENV
chown root:vstudio /etc/video-studio/worker.env && chmod 640 /etc/video-studio/worker.env

cat > /etc/systemd/system/video-studio-worker.service <<UNIT
[Unit]
Description=Video Studio media worker
After=network-online.target
Wants=network-online.target

[Service]
User=vstudio
WorkingDirectory=$DIR/workers/media
EnvironmentFile=/etc/video-studio/worker.env
ExecStart=$DIR/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/video-studio-tunnel.service <<UNIT
[Unit]
Description=Video Studio public address (Cloudflare quick tunnel) and registration
After=video-studio-worker.service network-online.target
Wants=video-studio-worker.service

[Service]
User=vstudio
EnvironmentFile=/etc/video-studio/worker.env
ExecStart=$DIR/deploy/oracle/tunnel.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now video-studio-worker video-studio-tunnel
sleep 8
systemctl is-active video-studio-worker video-studio-tunnel || true
curl -fsS http://127.0.0.1:8080/health && echo
echo "Setup finished. The worker reports its address to $APP_URL within a minute."
