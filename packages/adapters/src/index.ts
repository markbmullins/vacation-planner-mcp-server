/**
 * @dive-planner/adapters
 *
 * Source adapters that isolate external provider dependencies.
 * Each adapter encapsulates a specific external service (flight sources,
 * accommodation providers, crawlers, research tools) behind a stable interface.
 *
 * Allowed imports: @dive-planner/domain, @dive-planner/shared.
 * Must not import from services or data-access.
 */

export * from "./mcp/index.js";
export * from "./flight/index.js";
export * from "./accommodation/index.js";
export * from "./research/index.js";
export * from "./crawl/index.js";
