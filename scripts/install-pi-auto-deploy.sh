#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTO_BRANCH="${SMARTGARDEN_AUTO_DEPLOY_BRANCH:-main}"
REPO_DIR="${SMARTGARDEN_REPO_DIR:-$ROOT_DIR}"

sudo install -m 0644 "$ROOT_DIR/deploy/systemd/smartgarden-auto-deploy.service" /etc/systemd/system/smartgarden-auto-deploy.service
sudo install -m 0644 "$ROOT_DIR/deploy/systemd/smartgarden-auto-deploy.timer" /etc/systemd/system/smartgarden-auto-deploy.timer

sudo tee /etc/default/smartgarden-auto-deploy >/dev/null <<EOF
SMARTGARDEN_REPO_DIR=$REPO_DIR
SMARTGARDEN_AUTO_DEPLOY_BRANCH=$AUTO_BRANCH
SMARTGARDEN_REPO_FULL_NAME=philippgri11/SmartGarden
KUBECTL="sudo kubectl --request-timeout=60s"
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now smartgarden-auto-deploy.timer
sudo systemctl list-timers smartgarden-auto-deploy.timer --no-pager
