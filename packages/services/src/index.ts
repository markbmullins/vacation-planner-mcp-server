/**
 * @dive-planner/services
 *
 * Domain service layer for the Dive Vacation Planner.
 *
 * Responsibilities:
 * - Business logic for trip planning workflows
 * - Orchestration of adapters and repositories
 * - Constraint enforcement (no-fly rules, certification fit)
 * - Ranking and recommendation logic
 *
 * Allowed imports: all @dive-planner/* packages.
 * Must not be imported by adapters or data-access (to avoid circular deps).
 */

export * from "./dive-discovery/index.js";
export * from "./operator-research/index.js";
export * from "./travel-planning/index.js";
export * from "./itinerary/index.js";
export * from "./cost-estimation/index.js";
export * from "./research/index.js";
export * from "./trip-plan/index.js";
