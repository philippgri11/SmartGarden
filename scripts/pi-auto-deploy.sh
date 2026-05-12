#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${SMARTGARDEN_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${SMARTGARDEN_AUTO_DEPLOY_BRANCH:-main}"
STATE_DIR="${SMARTGARDEN_DEPLOY_STATE_DIR:-$ROOT_DIR/.deploy-state}"
LOCK_FILE="${STATE_DIR}/auto-deploy.lock"
LAST_DEPLOY_FILE="${STATE_DIR}/last-deployed-${BRANCH//\//_}.sha"

mkdir -p "$STATE_DIR"

(
  flock -n 9 || exit 0
  cd "$ROOT_DIR"
  git fetch origin "$BRANCH"
  TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
  LAST_SHA="$(cat "$LAST_DEPLOY_FILE" 2>/dev/null || true)"

  if [[ "$TARGET_SHA" == "$LAST_SHA" && "${FORCE_DEPLOY:-false}" != "true" ]]; then
    echo "No new commit on $BRANCH. Last deployed: $LAST_SHA"
    exit 0
  fi

  bash "$ROOT_DIR/scripts/pi-deploy-branch.sh" "$BRANCH"
  printf '%s\n' "$TARGET_SHA" > "$LAST_DEPLOY_FILE"
) 9>"$LOCK_FILE"
