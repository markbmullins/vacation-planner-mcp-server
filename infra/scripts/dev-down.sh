#!/usr/bin/env bash
# infra/scripts/dev-down.sh
#
# Stop local development infrastructure.
#
# Usage:
#   ./infra/scripts/dev-down.sh          # stop, keep volumes
#   ./infra/scripts/dev-down.sh --reset  # stop and remove volumes (wipes DB)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESET="${1:-}"

# ---------------------------------------------------------------------------
# Locate docker compose (plugin or standalone)
# ---------------------------------------------------------------------------
if docker compose version &>/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  DOCKER_COMPOSE="docker-compose"
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' found." >&2
  exit 1
fi

COMPOSE_CMD="$DOCKER_COMPOSE -f $REPO_ROOT/docker-compose.yml"

if [[ "$RESET" == "--reset" ]]; then
  echo "==> Stopping and removing all data volumes (reset)..."
  $COMPOSE_CMD down -v
  echo "    Data volumes removed."
else
  echo "==> Stopping local infrastructure (volumes preserved)..."
  $COMPOSE_CMD down
fi

echo "    Done."
