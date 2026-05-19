#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KUBECTL="${KUBECTL:-kubectl}"
BACKEND_IMAGE="${BACKEND_IMAGE:-}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-}"

k() {
  $KUBECTL "$@"
}

apply_manifest() {
  k apply --validate=false -f "$1"
}

apply_deployment_manifest() {
  local manifest="$1"
  local image="$2"
  local local_image="$3"

  if [[ -z "$image" ]]; then
    apply_manifest "$manifest"
    return
  fi

  local temp_file
  temp_file="$(mktemp)"
  sed "s#image: ${local_image}#image: ${image}#" "$manifest" > "$temp_file"
  k apply --validate=false -f "$temp_file"
  rm -f "$temp_file"
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
POSTGRES_SECRET_VALUE="${POSTGRES_PASSWORD:-}"
if [[ -z "$POSTGRES_SECRET_VALUE" ]]; then
  POSTGRES_SECRET_VALUE="$($KUBECTL -n irrigation get secret irrigation-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || true)"
fi
POSTGRES_SECRET_VALUE="${POSTGRES_SECRET_VALUE:-postgres}"
SMTP_SECRET_VALUE="${SMTP_PASSWORD:-}"
if [[ -z "$SMTP_SECRET_VALUE" ]]; then
  SMTP_SECRET_VALUE="$($KUBECTL -n irrigation get secret irrigation-secret -o jsonpath='{.data.SMTP_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || true)"
fi
CLOUDFLARE_TUNNEL_TOKEN_VALUE="${CLOUDFLARE_TUNNEL_TOKEN:-}"
if [[ -z "$CLOUDFLARE_TUNNEL_TOKEN_VALUE" ]]; then
  CLOUDFLARE_TUNNEL_TOKEN_VALUE="$($KUBECTL -n irrigation get secret irrigation-secret -o jsonpath='{.data.CLOUDFLARE_TUNNEL_TOKEN}' 2>/dev/null | base64 -d 2>/dev/null || true)"
fi
if [[ -z "$CLOUDFLARE_TUNNEL_TOKEN_VALUE" ]]; then
  CLOUDFLARE_TUNNEL_TOKEN_VALUE="${SMARTGARDEN_TUNNEL_TOKEN_BOOTSTRAP:-}"
fi
CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET_VALUE="${CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET:-${CF_ACCESS_CLIENT_SECRET:-}}"
if [[ -z "$CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET_VALUE" ]]; then
  CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET_VALUE="$($KUBECTL -n irrigation get secret irrigation-secret -o jsonpath='{.data.CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET}' 2>/dev/null | base64 -d 2>/dev/null || true)"
fi

secret_env_file="$(mktemp)"
trap 'rm -f "$secret_env_file"' EXIT
chmod 600 "$secret_env_file"
{
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_SECRET_VALUE"
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_SECRET_VALUE"
  printf 'SMTP_PASSWORD=%s\n' "$SMTP_SECRET_VALUE"
  printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$CLOUDFLARE_TUNNEL_TOKEN_VALUE"
  printf 'CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET=%s\n' "$CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET_VALUE"
} > "$secret_env_file"

apply_manifest "$ROOT_DIR/k8s/namespace.yaml"
k create secret generic irrigation-secret \
  --namespace irrigation \
  --from-env-file="$secret_env_file" \
  --dry-run=client -o yaml | k apply --validate=false -f -
apply_manifest "$ROOT_DIR/k8s/configmap.yaml"
apply_manifest "$ROOT_DIR/k8s/postgres-service.yaml"
apply_manifest "$ROOT_DIR/k8s/postgres-statefulset.yaml"
apply_manifest "$ROOT_DIR/k8s/backend-service.yaml"
apply_deployment_manifest "$ROOT_DIR/k8s/backend-deployment-pi.yaml" "$BACKEND_IMAGE" "irrigation-backend:latest"
apply_manifest "$ROOT_DIR/k8s/remote-gate-service.yaml"
apply_deployment_manifest "$ROOT_DIR/k8s/remote-gate-deployment.yaml" "$BACKEND_IMAGE" "irrigation-backend:latest"
apply_deployment_manifest "$ROOT_DIR/k8s/scheduler-deployment-pi.yaml" "$BACKEND_IMAGE" "irrigation-backend:latest"
apply_deployment_manifest "$ROOT_DIR/k8s/watchdog-deployment-pi.yaml" "$BACKEND_IMAGE" "irrigation-backend:latest"
apply_manifest "$ROOT_DIR/k8s/prometheus.yaml"
apply_manifest "$ROOT_DIR/k8s/frontend-service.yaml"
apply_deployment_manifest "$ROOT_DIR/k8s/frontend-deployment.yaml" "$FRONTEND_IMAGE" "irrigation-frontend:latest"
apply_manifest "$ROOT_DIR/k8s/ingress.yaml"
if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN_VALUE" ]]; then
  apply_manifest "$ROOT_DIR/k8s/cloudflared-deployment.yaml"
else
  echo "CLOUDFLARE_TUNNEL_TOKEN is not set; skipping cloudflared deployment."
fi
