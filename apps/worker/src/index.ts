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
    console.error("[worker] Startup aborted: configuration error");
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

console.log("[worker] Dive Vacation Planner Worker starting...");
console.log("[worker] Configuration loaded", JSON.stringify(redactConfig(config)));

// TODO (E4-T1): Register BullMQ worker processors
// TODO (E4-T3): Wire Playwright + Crawlee crawl processor
// TODO (E4-T5): Wire reddit research processor

process.on("SIGTERM", () => {
  console.log("[worker] Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[worker] Received SIGINT, shutting down gracefully");
  process.exit(0);
});

console.log("[worker] Worker ready (placeholder — processors not yet registered)");

export { config };
