#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${1:-latest}"

docker build -t "irrigation-backend:${TAG}" "$ROOT_DIR/backend"
docker build -t "irrigation-frontend:${TAG}" "$ROOT_DIR/frontend"

