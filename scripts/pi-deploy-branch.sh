#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-${DEPLOY_BRANCH:-main}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${SMARTGARDEN_REMOTE:-origin}"
REPO_FULL_NAME="${SMARTGARDEN_REPO_FULL_NAME:-philippgri11/SmartGarden}"
REQUIRE_CI="${REQUIRE_CI:-true}"
CI_TIMEOUT_SECONDS="${CI_TIMEOUT_SECONDS:-1800}"
KUBECTL="${KUBECTL:-sudo kubectl --request-timeout=300s}"
BACKEND_IMAGE_REPOSITORY="${BACKEND_IMAGE_REPOSITORY:-ghcr.io/philippgri11/smartgarden-backend}"
FRONTEND_IMAGE_REPOSITORY="${FRONTEND_IMAGE_REPOSITORY:-ghcr.io/philippgri11/smartgarden-frontend}"

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

BACKEND_IMAGE="${BACKEND_IMAGE_REPOSITORY}:${SHA}"
FRONTEND_IMAGE="${FRONTEND_IMAGE_REPOSITORY}:${SHA}"

KUBECTL="$KUBECTL" BACKEND_IMAGE="$BACKEND_IMAGE" FRONTEND_IMAGE="$FRONTEND_IMAGE" bash "$ROOT_DIR/scripts/deploy-pi.sh"
$KUBECTL -n irrigation rollout status deployment/backend --timeout=180s
$KUBECTL -n irrigation rollout status deployment/scheduler --timeout=180s
$KUBECTL -n irrigation rollout status deployment/frontend --timeout=180s

echo "Deployed $BRANCH at $SHA"
echo "Backend image: $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
