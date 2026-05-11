#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist-images}"
TAG="${TAG:-arm64-latest}"

mkdir -p "$OUT_DIR"
docker save "irrigation-backend:${TAG}" -o "$OUT_DIR/irrigation-backend-${TAG}.tar"
docker save "irrigation-frontend:${TAG}" -o "$OUT_DIR/irrigation-frontend-${TAG}.tar"

