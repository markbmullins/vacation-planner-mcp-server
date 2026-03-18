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

console.log("[worker] Dive Vacation Planner Worker starting...");

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
