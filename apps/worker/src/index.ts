/**
 * Worker entrypoint for the Dive Vacation Planner.
 *
 * This process runs background jobs separated from the interactive MCP server:
 * - Crawl and fetch jobs (Playwright + Crawlee, crawl4ai)
 * - Research enrichment (reddit-research-mcp)
 * - Content extraction and normalization
 * - Embedding generation
 * - Stale data revalidation
 *
 * BullMQ consumers are registered here.
 * Job business logic lives in @dive-planner/services and @dive-planner/adapters.
 */

import { ConfigError, loadConfig, loadDotenv, redactConfig, createHealthServer } from "@dive-planner/shared";

// Populate process.env from the repo root .env file before any other module
// reads environment variables.  Variables already present (e.g. injected by CI
// or Docker) always take precedence; the file acts as a local-dev fallback.
loadDotenv();

// Load and validate all required environment configuration before anything else.
// Throws ConfigError immediately if required variables are absent or invalid.
let config;
try {
  config = loadConfig();
} catch (err: unknown) {
  if (err instanceof ConfigError) {
    console.error("[worker] Startup aborted: configuration error");
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

console.log("[worker] Dive Vacation Planner Worker starting...");
console.log("[worker] Configuration loaded", JSON.stringify(redactConfig(config)));

// ---------------------------------------------------------------------------
// Health server
//
// Starts a lightweight HTTP server on config.worker.healthPort that exposes
// equivalent operational health signals to the MCP server:
//   GET /health/live  — shallow liveness probe (no external deps)
//   GET /health/ready — deep readiness probe (Postgres + Redis connectivity)
//
// Worker crashes, OOM kills, and deadlocks are detectable through the
// liveness endpoint.  Readiness confirms that the dependencies the worker
// needs to process jobs are reachable.
//
// createHealthServer returns a Promise that resolves only once the port is
// successfully bound.  If binding fails (e.g. EADDRINUSE), the process exits
// immediately rather than continuing without health endpoints.
// ---------------------------------------------------------------------------

let healthServer: Awaited<ReturnType<typeof createHealthServer>>;
try {
  healthServer = await createHealthServer({
    runtime: "worker",
    port: config.worker.healthPort,
    probeOptions: {
      postgres: {
        url: config.database.url,
      },
      redis: {
        url: config.redis.url,
        host: config.redis.host,
        port: config.redis.port,
      },
    },
  });
} catch (err: unknown) {
  console.error(
    "[worker] Startup aborted: health server failed to bind port",
    config.worker.healthPort,
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// TODO (E4-T1): Register BullMQ worker processors
// TODO (E4-T3): Wire Playwright + Crawlee crawl processor
// TODO (E4-T5): Wire reddit research processor

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] Received ${signal}, shutting down gracefully`);
  try {
    await healthServer.close();
    console.log("[worker] Health server stopped");
  } catch (err) {
    console.error("[worker] Error stopping health server:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("[worker] Worker ready (placeholder — processors not yet registered)");

export { config };
