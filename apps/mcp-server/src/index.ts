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
    console.error("[mcp-server] Startup aborted: configuration error");
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

console.log("[mcp-server] Dive Vacation Planner MCP Server starting...");
console.log("[mcp-server] Configuration loaded", JSON.stringify(redactConfig(config)));

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
  console.error(
    "[mcp-server] Startup aborted: health server failed to bind port",
    config.server.healthPort,
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// TODO (E2-T6): Register FastMCP adapter and tool handlers

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`[mcp-server] Received ${signal}, shutting down gracefully`);
  try {
    await healthServer.close();
    console.log("[mcp-server] Health server stopped");
  } catch (err) {
    console.error("[mcp-server] Error stopping health server:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("[mcp-server] MCP Server ready (placeholder — tools not yet registered)");

export { config };
