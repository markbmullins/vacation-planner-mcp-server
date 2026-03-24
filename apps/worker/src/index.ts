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

import {
  ConfigError,
  loadConfig,
  loadDotenv,
  redactConfig,
  createHealthServer,
  createLogger,
  installGlobalErrorHandlers,
  generateCorrelationId,
  runWithContext,
  type RequestContext,
} from "@dive-planner/shared";

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
    process.stderr.write("[worker] Startup aborted: configuration error\n");
    process.stderr.write(err.message + "\n");
    process.exit(1);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Structured logger
//
// Created immediately after config load so all subsequent startup steps
// use the configured log level and "worker" runtime label.
// The logger automatically injects correlation IDs from the async context
// (see @dive-planner/shared logging/context.ts) into every log entry.
// BullMQ job processors should wrap their execution in runWithContext()
// using the job ID as the correlation ID.
// ---------------------------------------------------------------------------

const log = createLogger(config.server.logLevel, { runtime: "worker" });

// ---------------------------------------------------------------------------
// Global unhandled error handlers
//
// Installed before any async work begins.  Any uncaught exception or
// unhandled Promise rejection (e.g. from a crashed BullMQ processor)
// produces a structured JSON error entry on stderr and exits the process
// with code 1 so the orchestrator can restart it.
// ---------------------------------------------------------------------------

installGlobalErrorHandlers({ logger: log, runtime: "worker" });

log.info("Dive Vacation Planner Worker starting");
log.info("Configuration loaded", redactConfig(config) as Record<string, unknown>);

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
  log.error("Startup aborted: health server failed to bind port", {
    port: config.worker.healthPort,
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Job correlation context wrapper
//
// All BullMQ job processors MUST use wrapJobProcessor (or call runWithContext
// directly) so that every log line emitted during job execution carries the
// BullMQ job ID as the correlationId.  This makes it possible to correlate
// log output with queue entries without adding explicit ID threading through
// every service call.
//
// Usage (E4-T1 and later tickets):
//
//   import { wrapJobProcessor } from "../index.js";  // re-export or co-locate
//
//   const worker = new Worker("crawl-fetch", async (job) => {
//     return wrapJobProcessor(job, async () => {
//       await CrawlService.fetch(job.data);
//     });
//   }, { connection: redisConnection });
// ---------------------------------------------------------------------------

/**
 * Wraps a BullMQ job processor function in an async context that carries the
 * job's correlation ID.  All log calls made within `fn` — including those in
 * downstream service and adapter code — will automatically include:
 *
 *   correlationId, contextType: "job", jobId, queueName, jobName
 *
 * @param job  The BullMQ Job object passed to the Worker processor callback.
 * @param fn   The async processor logic to run inside the correlation context.
 * @returns    The return value of `fn`.
 */
export function wrapJobProcessor<T>(
  job: { id?: string; queueName: string; name: string },
  fn: () => Promise<T>,
): Promise<T> {
  const correlationId = job.id ?? generateCorrelationId();
  const context: RequestContext = {
    correlationId,
    contextType: "job",
    jobId: job.id,
    queueName: job.queueName,
    jobName: job.name,
  };
  return runWithContext(context, fn);
}

// TODO (E4-T1): Register BullMQ worker processors using wrapJobProcessor
// TODO (E4-T3): Wire Playwright + Crawlee crawl processor
// TODO (E4-T5): Wire reddit research processor

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, shutting down gracefully`);
  try {
    await healthServer.close();
    log.info("Health server stopped");
  } catch (err) {
    log.error("Error stopping health server", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Startup correlation context
//
// Wrap the ready announcement in a startup context so that any log calls
// emitted after startup (e.g. from processor registration or future wiring)
// carry a stable correlation ID rather than appearing as untracked log lines.
// ---------------------------------------------------------------------------

runWithContext(
  {
    correlationId: generateCorrelationId(),
    contextType: "job",
    meta: { phase: "startup" },
  },
  () => {
    log.info("Worker ready (placeholder — processors not yet registered)");
  },
);

export { config };
