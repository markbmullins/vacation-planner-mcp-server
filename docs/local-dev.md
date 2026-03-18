# Local Development Setup

This guide covers everything a new engineer needs to bring the Dive Vacation Planner stack up locally from scratch.

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 20 LTS | Required for TypeScript workspaces |
| npm | 10 | Bundled with Node 20 |
| Docker | 24 | Required for Postgres and Redis |
| Docker Compose | v2 (plugin) | Bundled with Docker Desktop |

Verify your tools:

```bash
node --version   # expect v20.x.x
npm --version    # expect 10.x.x
docker --version
docker compose version
```

---

## 1. Clone and install dependencies

```bash
git clone <repo-url> vacation-mcp
cd vacation-mcp
npm install
```

---

## 2. Set up environment files

```bash
# Application services (.env at the repo root)
cp .env.example .env

# Autodev controller (separate env for the automation tooling)
cp autodev/.env.example autodev/.env
```

Both files contain sensible local defaults. No values need changing for basic local development.

---

## 3. Start local infrastructure

```bash
npm run infra:up
```

This command:
- starts a **PostgreSQL 16** container with the `pgvector` extension enabled automatically
- starts a **Redis 7** container for BullMQ job queues
- waits until both services report `healthy` before returning

You should see output similar to:

```
==> Starting dive-planner local infrastructure...
==> Waiting for services to be healthy (timeout: 60s)...
    postgres: healthy
    redis: healthy

==> Local infrastructure is ready.

    PostgreSQL: localhost:5432  (db: divedb)
    Redis:      localhost:6379
```

### Infrastructure commands

| Command | Effect |
|---------|--------|
| `npm run infra:up` | Start Postgres and Redis (idempotent) |
| `npm run infra:down` | Stop containers, keep data volumes |
| `npm run infra:reset` | Stop containers **and delete all data** |

You can also use Docker Compose directly from the repo root:

```bash
docker compose up -d          # start in background
docker compose down           # stop, keep volumes
docker compose down -v        # stop and wipe all volumes
docker compose logs -f        # follow logs for all services
docker compose logs -f redis  # follow logs for one service
```

---

## 4. Verify the database

Connect with `psql` to confirm the `pgvector` extension is installed:

```bash
psql postgresql://diveuser:divepass@localhost:5432/divedb
```

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp');
-- Should return two rows: vector and uuid-ossp
\q
```

---

## 5. Build the project

```bash
npm run build
```

This compiles all TypeScript packages and apps in dependency order:
1. `packages/shared`
2. `packages/domain`
3. `packages/data-access`
4. `packages/adapters`
5. `packages/services`
6. `apps/mcp-server`
7. `apps/worker`

---

## 6. Run tests

```bash
npm test
```

Currently this runs the TypeScript build as a type check. Full test suites are added in later milestones.

> **Note:** `npm test` requires `npm install` (step 1) to have been run first so that workspace symlinks are in place. If you see errors like `Cannot find module '@dive-planner/shared'`, run `npm install` from the repo root and retry.

---

## Port reference

| Service | Default port | Override env var |
|---------|-------------|-----------------|
| PostgreSQL | 5432 | `POSTGRES_PORT` |
| Redis | 6379 | `REDIS_PORT` |
| MCP server | 3000 | `MCP_SERVER_PORT` |

---

## Environment variables

### Root `.env` (application services)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://diveuser:divepass@localhost:5432/divedb` | Full Postgres connection string |
| `POSTGRES_USER` | `diveuser` | Postgres username |
| `POSTGRES_PASSWORD` | `divepass` | Postgres password |
| `POSTGRES_DB` | `divedb` | Postgres database name |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `POSTGRES_PORT` | `5432` | Postgres port |
| `REDIS_URL` | `redis://localhost:6379` | Full Redis connection string |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | _(blank)_ | Redis AUTH password; blank disables AUTH |
| `MCP_SERVER_PORT` | `3000` | HTTP port for the MCP server |
| `LOG_LEVEL` | `info` | Log verbosity: `error` \| `warn` \| `info` \| `debug` |
| `WORKER_CONCURRENCY` | `2` | Background worker concurrency |

### `autodev/.env` (automation controller)

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTODEV_REDIS_HOST` | `127.0.0.1` | Redis host for autodev controller |
| `AUTODEV_REDIS_PORT` | `6379` | Redis port for autodev controller |
| `AUTODEV_REDIS_PASSWORD` | _(blank)_ | Redis AUTH for autodev controller |
| `AUTODEV_REDIS_DB` | _(unset)_ | Redis DB index for controller (set to `1` to isolate from app queues) |

---

## Directory layout for infrastructure

```text
docker-compose.yml          # Service definitions for Postgres and Redis
.env.example                # Application environment template
.env                        # Your local env (git-ignored)
infra/
  db/
    init/
      00-extensions.sql     # Creates pgvector, uuid-ossp, pg_trgm extensions
      01-schema-check.sql   # Verifies extensions on startup
  scripts/
    dev-up.sh               # Start infrastructure and wait for healthy
    dev-down.sh             # Stop infrastructure
autodev/
  .env.example              # Autodev controller env template
  .env                      # Your local autodev env (git-ignored)
```

---

## Troubleshooting

### Port already in use

If port 5432 or 6379 is already taken by a local Postgres or Redis process, either stop those processes or override the port in `.env`:

```bash
POSTGRES_PORT=5433 docker compose up -d postgres
```

### `pgvector` missing after upgrade

If you upgrade the Docker image and the extension disappears, run:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

Or reset the volume to re-run init scripts:

```bash
npm run infra:reset && npm run infra:up
```

### Container health check failing

Check the logs:

```bash
docker compose logs postgres
docker compose logs redis
```

### Cannot connect to Redis from autodev

Make sure `autodev/.env` exists. If it is missing, copy from the example:

```bash
cp autodev/.env.example autodev/.env
```

### `npm test` fails with `Cannot find module '@dive-planner/shared'`

This means `npm install` has not been run yet. Workspace symlinks under `node_modules/@dive-planner/` are created by `npm install` and are required before any TypeScript compilation can resolve internal packages.

```bash
npm install
npm test
```
