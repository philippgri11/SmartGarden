#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KUBECTL="${KUBECTL:-kubectl}"

k() {
  $KUBECTL "$@"
}

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

OPENAI_SECRET_VALUE="${OPENAI_API_KEY:-}"
if [[ -z "$OPENAI_SECRET_VALUE" ]]; then
  OPENAI_SECRET_VALUE="$($KUBECTL -n irrigation get secret irrigation-secret -o jsonpath='{.data.OPENAI_API_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)"
fi

k apply -f "$ROOT_DIR/k8s/namespace.yaml"
k create secret generic irrigation-secret \
  --namespace irrigation \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}" \
  --from-literal=OPENAI_API_KEY="$OPENAI_SECRET_VALUE" \
  --dry-run=client -o yaml | k apply -f -
k apply -f "$ROOT_DIR/k8s/configmap.yaml"
k apply -f "$ROOT_DIR/k8s/postgres-service.yaml"
k apply -f "$ROOT_DIR/k8s/postgres-statefulset.yaml"
k apply -f "$ROOT_DIR/k8s/backend-service.yaml"
k apply -f "$ROOT_DIR/k8s/backend-deployment-pi.yaml"
k apply -f "$ROOT_DIR/k8s/scheduler-deployment-pi.yaml"
k apply -f "$ROOT_DIR/k8s/frontend-service.yaml"
k apply -f "$ROOT_DIR/k8s/frontend-deployment.yaml"
k apply -f "$ROOT_DIR/k8s/ingress.yaml"
