#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 pi@<PI_HOST> [target-dir]"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_HOST="$1"
TARGET_DIR="${2:-~/irrigation-control}"

rsync -av --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude ".angular" \
  "$ROOT_DIR/" "${TARGET_HOST}:${TARGET_DIR}/"

