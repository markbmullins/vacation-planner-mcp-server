/**
 * Dependency health probes.
 *
 * Each probe makes a low-overhead connectivity check against an external
 * dependency and returns a structured DependencyCheckResult.
 *
 * Implementation notes:
 * - Probes use raw TCP connections (Node.js `net` module) so that no
 *   database/Redis client library is required here.  This keeps @dive-planner/shared
 *   dependency-free while allowing both the mcp-server and worker to share
 *   the same probe logic.
 * - Probes have a hard timeout (default 3 s) and never throw — all errors
 *   are captured and returned as a non-ok result.
 * - Callers should run probes concurrently (Promise.all) to keep readiness
 *   check latency low.
 */

import net from "node:net";
import type { DependencyCheckResult } from "./types.js";

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

/**
 * Performs a TCP connect probe against host:port.
 * Resolves with a DependencyCheckResult regardless of outcome.
 */
async function tcpProbe(
  name: string,
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<DependencyCheckResult> {
  const start = Date.now();

  return new Promise<DependencyCheckResult>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean, message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ name, ok, message, latencyMs: Date.now() - start });
    };

    const timer = setTimeout(() => {
      finish(false, `TCP connect to ${host}:${port} timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true, `TCP connect to ${host}:${port} succeeded`);
    });

    socket.once("error", (err) => {
      clearTimeout(timer);
      finish(false, `TCP connect to ${host}:${port} failed: ${err.message}`);
    });

    socket.connect(port, host);
  });
}

// ---------------------------------------------------------------------------
// Postgres probe
// ---------------------------------------------------------------------------

export interface PostgresProbeOptions {
  /** DATABASE_URL or explicit host for the TCP probe */
  url?: string;
  host?: string;
  port?: number;
  timeoutMs?: number;
}

/**
 * Probes Postgres reachability via a raw TCP connection.
 *
 * Parses host/port from `url` (a postgres:// DSN) when explicit host/port
 * are not provided.  Falls back to localhost:5432.
 */
export async function probePostgres(
  options: PostgresProbeOptions = {},
): Promise<DependencyCheckResult> {
  let host = options.host ?? "localhost";
  let port = options.port ?? 5432;

  if (options.url) {
    try {
      const parsed = new URL(options.url);
      if (parsed.hostname) host = parsed.hostname;
      if (parsed.port) port = Number(parsed.port);
    } catch {
      // Malformed URL — fall back to defaults.
    }
  }

  return tcpProbe("postgres", host, port, options.timeoutMs);
}

// ---------------------------------------------------------------------------
// Redis probe
// ---------------------------------------------------------------------------

export interface RedisProbeOptions {
  /** REDIS_URL (redis:// DSN) or explicit host/port */
  url?: string;
  host?: string;
  port?: number;
  timeoutMs?: number;
}

/**
 * Probes Redis reachability via a raw TCP connection.
 *
 * Parses host/port from `url` when explicit values are not provided.
 * Falls back to localhost:6379.
 */
export async function probeRedis(
  options: RedisProbeOptions = {},
): Promise<DependencyCheckResult> {
  let host = options.host ?? "localhost";
  let port = options.port ?? 6379;

  if (options.url) {
    try {
      const parsed = new URL(options.url);
      if (parsed.hostname) host = parsed.hostname;
      if (parsed.port) port = Number(parsed.port);
    } catch {
      // Malformed URL — fall back to defaults.
    }
  }

  return tcpProbe("redis", host, port, options.timeoutMs);
}

// ---------------------------------------------------------------------------
// Aggregate helper
// ---------------------------------------------------------------------------

export interface RunProbesOptions {
  postgres: PostgresProbeOptions;
  redis: RedisProbeOptions;
}

/**
 * Runs all dependency probes concurrently.
 * Never rejects — individual probe failures are captured in results.
 */
export async function runDependencyProbes(
  options: RunProbesOptions,
): Promise<DependencyCheckResult[]> {
  return Promise.all([probePostgres(options.postgres), probeRedis(options.redis)]);
}
