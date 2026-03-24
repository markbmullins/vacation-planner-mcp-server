/**
 * @dive-planner/data-access
 *
 * Repository layer for the Dive Vacation Planner.
 *
 * Responsibilities:
 * - Database access patterns and query abstractions
 * - Transaction management
 * - Raw entity persistence and retrieval
 *
 * Allowed imports: @dive-planner/domain, @dive-planner/shared.
 * Must not import from services or adapters.
 */

export * from "./repositories/index.js";
export * from "./source-records/index.js";
