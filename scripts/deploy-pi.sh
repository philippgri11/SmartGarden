#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

kubectl apply -f "$ROOT_DIR/k8s/namespace.yaml"
kubectl create secret generic irrigation-secret \
  --namespace irrigation \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$ROOT_DIR/k8s/configmap.yaml"
kubectl apply -f "$ROOT_DIR/k8s/postgres-service.yaml"
kubectl apply -f "$ROOT_DIR/k8s/postgres-statefulset.yaml"
kubectl apply -f "$ROOT_DIR/k8s/backend-service.yaml"
kubectl apply -f "$ROOT_DIR/k8s/backend-deployment.yaml"
kubectl apply -f "$ROOT_DIR/k8s/scheduler-deployment-pi.yaml"
kubectl apply -f "$ROOT_DIR/k8s/frontend-service.yaml"
kubectl apply -f "$ROOT_DIR/k8s/frontend-deployment.yaml"
kubectl apply -f "$ROOT_DIR/k8s/ingress.yaml"
