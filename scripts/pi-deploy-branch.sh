#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-${DEPLOY_BRANCH:-main}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${SMARTGARDEN_REMOTE:-origin}"
REPO_FULL_NAME="${SMARTGARDEN_REPO_FULL_NAME:-philippgri11/SmartGarden}"
REQUIRE_CI="${REQUIRE_CI:-true}"
CI_TIMEOUT_SECONDS="${CI_TIMEOUT_SECONDS:-1800}"
KUBECTL="${KUBECTL:-sudo kubectl --request-timeout=60s}"

cd "$ROOT_DIR"

git fetch "$REMOTE" "$BRANCH"
SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$REQUIRE_CI" == "true" ]]; then
  python3 "$ROOT_DIR/scripts/pi-check-github-ci.py" \
    --repo "$REPO_FULL_NAME" \
    --sha "$SHA" \
    --wait \
    --timeout-seconds "$CI_TIMEOUT_SECONDS"
fi

git checkout -B "$BRANCH" "$REMOTE/$BRANCH"
git reset --hard "$REMOTE/$BRANCH"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif command -v docker >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  echo "Docker is required on the Pi to build local ARM64 images." >&2
  echo "Install it once with: sudo apt-get update && sudo apt-get install -y docker.io" >&2
  exit 1
fi

"${DOCKER[@]}" build -t irrigation-backend:latest "$ROOT_DIR/backend"
"${DOCKER[@]}" build -t irrigation-frontend:latest "$ROOT_DIR/frontend"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
"${DOCKER[@]}" save irrigation-backend:latest -o "$TMP_DIR/irrigation-backend-latest.tar"
"${DOCKER[@]}" save irrigation-frontend:latest -o "$TMP_DIR/irrigation-frontend-latest.tar"

sudo ctr -n k8s.io images import "$TMP_DIR/irrigation-backend-latest.tar"
sudo ctr -n k8s.io images import "$TMP_DIR/irrigation-frontend-latest.tar"

KUBECTL="$KUBECTL" bash "$ROOT_DIR/scripts/deploy-pi.sh"
$KUBECTL -n irrigation rollout restart deployment/backend deployment/scheduler deployment/frontend
$KUBECTL -n irrigation rollout status deployment/backend --timeout=180s
$KUBECTL -n irrigation rollout status deployment/scheduler --timeout=180s
$KUBECTL -n irrigation rollout status deployment/frontend --timeout=180s

echo "Deployed $BRANCH at $SHA"
