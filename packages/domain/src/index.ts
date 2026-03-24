/**
 * @dive-planner/domain
 *
 * Core domain entities, value objects, and business rules for the
 * Dive Vacation Planner. This package contains the canonical data model
 * and constraint definitions used across all service layers.
 *
 * Allowed imports: @dive-planner/shared only.
 * Must not import from services, adapters, or data-access.
 */

export * from "./entities/index.js";
export * from "./constraints/index.js";
