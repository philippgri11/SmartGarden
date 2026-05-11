#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${TAG:-arm64-latest}"

docker buildx build --platform linux/arm64 -t "irrigation-backend:${TAG}" "$ROOT_DIR/backend" --load
docker buildx build --platform linux/arm64 -t "irrigation-frontend:${TAG}" "$ROOT_DIR/frontend" --load

