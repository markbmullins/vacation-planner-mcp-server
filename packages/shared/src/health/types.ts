/**
 * Health check types for liveness and readiness probes.
 *
 * Design:
 * - Liveness  – the process is running and not deadlocked.  No external deps.
 * - Readiness – the process can serve traffic; all required dependencies are up.
 *
 * The shape is intentionally machine-readable so orchestrators (Kubernetes,
 * PM2, Docker healthcheck, ALB) can parse the JSON body.
 */

/** A single dependency probe result */
export interface DependencyCheckResult {
  /** Logical name of the dependency (e.g. "postgres", "redis") */
  name: string;
  /** Whether the dependency is currently reachable */
  ok: boolean;
  /** Human-readable detail: latency, error message, etc. */
  message: string;
  /** Milliseconds taken to check, or undefined if not measured */
  latencyMs?: number;
}

/** Overall health status */
export type HealthStatus = "ok" | "degraded" | "unavailable";

/** Shape of the liveness response body */
export interface LivenessResponse {
  status: "ok";
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Process identifier (useful when multiple replicas run) */
  pid: number;
  /** Runtime name (e.g. "mcp-server", "worker") */
  runtime: string;
  /** Process uptime in seconds */
  uptimeSeconds: number;
}

/** Shape of the readiness response body */
export interface ReadinessResponse {
  /** Aggregated status across all dependency checks */
  status: HealthStatus;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Runtime name */
  runtime: string;
  /** Individual dependency check outcomes */
  dependencies: DependencyCheckResult[];
}
