#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

echo "Lokale Konfiguration bereit. Starte mit:"
echo "  docker compose up --build"
echo "Dabei werden einmalig lokale Beispielbereiche und Zeitpläne angelegt."
