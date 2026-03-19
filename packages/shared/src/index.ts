/**
 * @dive-planner/shared
 *
 * Cross-cutting utilities and types shared across all packages.
 * This package must not import from any other @dive-planner/* package
 * to avoid circular dependencies.
 */

export * from "./types/common.js";
export * from "./types/errors.js";
export * from "./types/result.js";
export * from "./config/index.js";
export * from "./health/index.js";
export * from "./logging/index.js";
export * from "./errors/index.js";
