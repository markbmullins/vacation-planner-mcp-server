/**
 * MCP Server entrypoint for the Dive Vacation Planner.
 *
 * This process runs the interactive FastMCP server that exposes
 * planning capabilities as MCP tools to LLM clients.
 *
 * Architecture:
 *   MCP Client -> FastMCP Adapter -> Tool Handlers -> Domain Services
 *
 * The FastMCP framework registration is isolated here.
 * Business logic lives in @dive-planner/services.
 * Domain types live in @dive-planner/domain.
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
    process.stderr.write("[mcp-server] Startup aborted: configuration error\n");
    process.stderr.write(err.message + "\n");
    process.exit(1);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Structured logger
//
// Created immediately after config load so all subsequent startup steps
// use the configured log level and runtime label.
// The logger automatically injects correlation IDs from the async context
// (see @dive-planner/shared logging/context.ts) into every log entry.
// ---------------------------------------------------------------------------

const log = createLogger(config.server.logLevel, { runtime: "mcp-server" });

// ---------------------------------------------------------------------------
// Global unhandled error handlers
//
// Installed before any async work begins.  Any uncaught exception or
// unhandled Promise rejection produces a structured JSON error entry on
// stderr and exits the process with code 1.
// ---------------------------------------------------------------------------

installGlobalErrorHandlers({ logger: log, runtime: "mcp-server" });

log.info("Dive Vacation Planner MCP Server starting");
log.info("Configuration loaded", redactConfig(config) as Record<string, unknown>);

// ---------------------------------------------------------------------------
// Health server
//
// Starts a lightweight HTTP server on config.server.healthPort that exposes:
//   GET /health/live  — shallow liveness probe (no external deps)
//   GET /health/ready — deep readiness probe (Postgres + Redis connectivity)
//
// The health server is separate from the MCP protocol port so that
// load-balancers and orchestrators can probe it without interfering with
// the stdio/SSE MCP transport.
//
// createHealthServer returns a Promise that resolves only once the port is
// successfully bound.  If binding fails (e.g. EADDRINUSE), the process exits
// immediately rather than continuing without health endpoints.
// ---------------------------------------------------------------------------

let healthServer: Awaited<ReturnType<typeof createHealthServer>>;
try {
  healthServer = await createHealthServer({
    runtime: "mcp-server",
    port: config.server.healthPort,
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
    port: config.server.healthPort,
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}

// TODO (E2-T6): Register FastMCP adapter and tool handlers
//
// Each MCP tool handler must wrap its execution in runWithContext so that all
// downstream log calls (services, repositories, adapters) automatically carry
// the per-request correlation ID:
//
//   server.addTool("searchDiveSites", async (params) => {
//     return runWithContext(
//       { correlationId: generateCorrelationId(), contextType: "request", meta: { tool: "searchDiveSites" } },
//       () => DiveDiscoveryService.searchSites(params),
//     );
//   });

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
// emitted after startup (e.g. from health-check processing or future tool
// handler wiring) carry a stable correlation ID rather than appearing as
// untracked log lines.
// ---------------------------------------------------------------------------

runWithContext(
  {
    correlationId: generateCorrelationId(),
    contextType: "request",
    meta: { phase: "startup" },
  },
  () => {
    log.info("MCP Server ready (placeholder — tools not yet registered)");
  },
);

export { config };
