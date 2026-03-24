#!/usr/bin/env bash
# infra/scripts/dev-up.sh
#
# Start local development infrastructure (Postgres + Redis) and wait until
# both services are healthy before returning. Exits non-zero if any service
# fails to become healthy within the timeout.
#
# Usage:
#   ./infra/scripts/dev-up.sh
#   ./infra/scripts/dev-up.sh --wait-timeout 60

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WAIT_TIMEOUT="${2:-60}"

# ---------------------------------------------------------------------------
# Locate docker compose (plugin or standalone)
# ---------------------------------------------------------------------------
if docker compose version &>/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  DOCKER_COMPOSE="docker-compose"
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' found." >&2
  echo "       Install Docker Desktop or Docker Engine with Compose plugin." >&2
  exit 1
fi

COMPOSE_CMD="$DOCKER_COMPOSE -f $REPO_ROOT/docker-compose.yml"

echo "==> Starting dive-planner local infrastructure..."

# Ensure .env exists (copy from example if missing)
if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "    .env not found — copying from .env.example"
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
fi

# Start services in detached mode
$COMPOSE_CMD up -d

echo "==> Waiting for services to be healthy (timeout: ${WAIT_TIMEOUT}s)..."

wait_healthy() {
  local service="$1"
  local deadline=$(( $(date +%s) + WAIT_TIMEOUT ))

  while true; do
    local health
    health=$($COMPOSE_CMD ps --format '{{.Health}}' "$service" 2>/dev/null || echo "unknown")

    if [[ "$health" == "healthy" ]]; then
      echo "    $service: healthy"
      return 0
    fi

    if [[ $(date +%s) -ge $deadline ]]; then
      echo "    $service: timed out waiting for healthy status (current: $health)"
      return 1
    fi

    sleep 2
  done
}

wait_healthy postgres
wait_healthy redis

echo ""
echo "==> Local infrastructure is ready."
echo ""
echo "    PostgreSQL: localhost:${POSTGRES_PORT:-5432}  (db: ${POSTGRES_DB:-divedb})"
echo "    Redis:      localhost:${REDIS_PORT:-6379}"
echo ""
echo "    To stop:  docker compose down  (or docker-compose down)"
echo "    To reset: npm run infra:reset  (deletes all data)"
