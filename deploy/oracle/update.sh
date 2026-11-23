#!/usr/bin/env bash
# Pulls the latest worker code and restarts it. Run on the machine: sudo bash /opt/video-studio/deploy/oracle/update.sh
set -euo pipefail
git -C /opt/video-studio pull --ff-only
/opt/video-studio/venv/bin/pip install -r /opt/video-studio/workers/media/requirements.txt faster-whisper
systemctl restart video-studio-worker video-studio-tunnel
