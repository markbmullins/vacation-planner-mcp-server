/**
 * Minimal HTTP health server.
 *
 * Exposes two endpoints on a configurable port:
 *
 *   GET /health/live   — shallow liveness probe (no external deps)
 *   GET /health/ready  — deep readiness probe (checks Postgres + Redis)
 *
 * This server is intentionally thin — it uses only Node.js built-in `http`
 * so no additional dependencies are required.
 *
 * Usage:
 *   const server = await createHealthServer({ runtime: "mcp-server", port: 9000, ... });
 *   // on shutdown:
 *   await server.close();
 *
 * Startup safety:
 *   `createHealthServer` returns a Promise that resolves only after the server
 *   successfully binds its port.  If the port is already in use or cannot be
 *   bound for any reason, the Promise rejects.  Callers MUST await the returned
 *   Promise and handle the rejection (e.g. by calling `process.exit(1)`) to
 *   prevent the process from continuing without live health endpoints.
 */

import http from "node:http";
import type { DependencyCheckResult, HealthStatus, LivenessResponse, ReadinessResponse } from "./types.js";
import type { RunProbesOptions } from "./probes.js";
import { runDependencyProbes } from "./probes.js";
import type { Logger } from "../logging/logger.js";

export interface HealthServerOptions {
  /** Logical name of this runtime process, included in responses */
  runtime: string;
  /** TCP port for the health HTTP server */
  port: number;
  /** Options passed to the dependency probes */
  probeOptions: RunProbesOptions;
  /**
   * Optional override for the readiness check function.
   * Defaults to runDependencyProbes(probeOptions).
   * Useful for testing.
   */
  runProbes?: (opts: RunProbesOptions) => Promise<DependencyCheckResult[]>;
  /**
   * Optional structured logger.  When provided, startup messages are emitted
   * via the logger instead of writing plain text to stdout.  This keeps all
   * runtime log output in a consistent structured format.
   *
   * When omitted the server falls back to `process.stdout.write` so it
   * remains usable before a logger is configured.
   */
  logger?: Logger;
}

export interface HealthServerHandle {
  /** Gracefully closes the HTTP server. Resolves when the server is stopped. */
  close(): Promise<void>;
}

/**
 * Computes the aggregated health status from a set of dependency results.
 *
 *  - All ok          -> "ok"
 *  - Any not-ok      -> "unavailable"
 *
 * If the application later distinguishes non-critical dependencies (e.g.
 * optional integrations) the caller can treat those as "degraded".
 */
function aggregateStatus(results: DependencyCheckResult[]): HealthStatus {
  if (results.every((r) => r.ok)) return "ok";
  return "unavailable";
}

function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    // Prevent proxies/load-balancers from caching health responses.
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  res.end(payload);
}

/**
 * Creates and starts an HTTP health server.
 *
 * Returns a Promise that resolves to a handle with a `close()` method once
 * the server has successfully bound its port.  Rejects if the port cannot be
 * bound (e.g. EADDRINUSE), so callers MUST await the result and treat a
 * rejection as a fatal startup error.
 */
export function createHealthServer(options: HealthServerOptions): Promise<HealthServerHandle> {
  const { runtime, port, probeOptions, logger } = options;
  const probe = options.runProbes ?? runDependencyProbes;

  return new Promise<HealthServerHandle>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = req.url ?? "/";

      // -----------------------------------------------------------------------
      // GET /health/live — shallow liveness check
      // -----------------------------------------------------------------------
      if (url === "/health/live" || url === "/health/live/") {
        const body: LivenessResponse = {
          status: "ok",
          timestamp: new Date().toISOString(),
          pid: process.pid,
          runtime,
          uptimeSeconds: Math.floor(process.uptime()),
        };
        return jsonResponse(res, 200, body);
      }

      // -----------------------------------------------------------------------
      // GET /health/ready — deep readiness check (dependency probes)
      // -----------------------------------------------------------------------
      if (url === "/health/ready" || url === "/health/ready/") {
        let dependencies: DependencyCheckResult[];
        try {
          dependencies = await probe(probeOptions);
        } catch (err) {
          // The probe runner itself failed — treat as fully unavailable.
          dependencies = [
            {
              name: "probe-runner",
              ok: false,
              message: `Internal probe error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ];
        }

        const status = aggregateStatus(dependencies);
        const body: ReadinessResponse = {
          status,
          timestamp: new Date().toISOString(),
          runtime,
          dependencies,
        };

        // HTTP 200 when ready, 503 when not ready so load-balancers can act on it.
        const httpStatus = status === "ok" ? 200 : 503;
        return jsonResponse(res, httpStatus, body);
      }

      // -----------------------------------------------------------------------
      // 404 for any other path
      // -----------------------------------------------------------------------
      jsonResponse(res, 404, { error: "Not found", path: url });
    });

    // Resolve only after the port is successfully bound.
    server.once("listening", () => {
      if (logger) {
        logger.info("health server listening", { component: "health", runtime, port });
      } else {
        process.stdout.write(
          `[health] ${runtime} health server listening on port ${port}\n`,
        );
      }
      resolve({
        close(): Promise<void> {
          return new Promise((res, rej) => {
            server.close((err) => {
              if (err) rej(err);
              else res();
            });
          });
        },
      });
    });

    // Reject on any bind-time error so the caller can fail startup.
    server.once("error", (err) => {
      reject(err);
    });

    server.listen(port);
  });
}
