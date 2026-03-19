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

import { ConfigError, loadConfig, loadDotenv, redactConfig } from "@dive-planner/shared";

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

// TODO (E2-T6): Register FastMCP adapter and tool handlers
// TODO (E1-T4): Wire health endpoints

process.on("SIGTERM", () => {
  console.log("[mcp-server] Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[mcp-server] Received SIGINT, shutting down gracefully");
  process.exit(0);
});

console.log("[mcp-server] MCP Server ready (placeholder — tools not yet registered)");

export { config };
