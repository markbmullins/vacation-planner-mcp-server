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

console.log("[mcp-server] Dive Vacation Planner MCP Server starting...");

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
