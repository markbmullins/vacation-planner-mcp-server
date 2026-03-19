/**
 * Tests for the health module.
 *
 * Covers:
 * - GET /health/live response shape and HTTP status
 * - GET /health/ready HTTP 200 when all probes pass
 * - GET /health/ready HTTP 503 when any probe fails
 * - probe-runner internal failure handling (caught, returned as unavailable)
 * - 404 for unknown paths
 * - createHealthServer rejects when the port is already in use (EADDRINUSE)
 * - MCP_HEALTH_PORT and WORKER_HEALTH_PORT config defaulting and parsing
 *
 * Uses Node.js built-in test runner (node:test) and http client so no
 * additional test dependencies are needed.  Each test that starts a server
 * picks an ephemeral port (port 0) to avoid conflicts between parallel runs.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHealthServer } from "./server.js";
import type { HealthServerOptions } from "./server.js";
import type { DependencyCheckResult } from "./types.js";
import { loadConfig, ConfigError } from "../config/index.js";
import { createLogger } from "../logging/logger.js";
import type { LogEntry } from "../logging/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the actual bound port from a server handle.
 * We exploit the fact that `server.listen(0)` assigns an OS port; we expose
 * it by reading the address before returning the handle.
 *
 * Because createHealthServer now returns Promise<HealthServerHandle> and the
 * internal server is closed via handle.close(), we need the port separately.
 * We thread it through via a shared ref set in the options factory.
 */
async function startTestServer(
  overrides: Partial<HealthServerOptions> & { portRef?: { value: number } } = {},
): Promise<{ handle: Awaited<ReturnType<typeof createHealthServer>>; port: number }> {
  let resolvedPort = 0;

  // Build a minimal working options object.  Use port 0 so the OS picks a
  // free ephemeral port; we retrieve the actual port from the 'listening'
  // event by wrapping the server creation.
  //
  // To capture the bound port without leaking internals we create the server
  // ourselves here and pass a custom runProbes to avoid real TCP probes.
  const options: HealthServerOptions = {
    runtime: overrides.runtime ?? "test-runtime",
    port: overrides.port ?? 0,
    probeOptions: overrides.probeOptions ?? { postgres: {}, redis: {} },
    runProbes: overrides.runProbes,
  };

  // We need the port but createHealthServer returns only a close handle.
  // Resolve by temporarily binding a plain http.Server on port 0, capturing
  // the address, closing it, then re-using that port.  This is racy in
  // principle but acceptable for tests.  A cleaner approach: return the port
  // from the handle.
  //
  // Instead, we use the fact that Node's http.Server exposes address() after
  // listening.  We extend HealthServerHandle here to capture this by
  // reimplementing the start with a probe shim that tells us the port via
  // a side-channel.  This keeps test code isolated from production code.
  //
  // Simplest working approach: wrap createHealthServer start call, then
  // immediately make a request to an unused probe path to confirm the port.
  // Actually the cleanest: just pre-allocate a port with a probe server.

  // Allocate an ephemeral port by binding and immediately unbinding.
  const port = await new Promise<number>((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, () => {
      const addr = probe.address();
      const p = addr && typeof addr === "object" ? addr.port : 0;
      probe.close((err) => (err ? reject(err) : resolve(p)));
    });
    probe.on("error", reject);
  });

  const handle = await createHealthServer({ ...options, port });
  return { handle, port };
}

/**
 * Makes a GET request to the given URL and resolves with { statusCode, body }.
 */
function get(url: string): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { raw += chunk; });
      res.on("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// /health/live
// ---------------------------------------------------------------------------

describe("GET /health/live", () => {
  it("returns 200 with a valid liveness response shape", async () => {
    const { handle, port } = await startTestServer();
    after(() => handle.close());

    const { statusCode, body } = await get(`http://localhost:${port}/health/live`);

    assert.strictEqual(statusCode, 200);
    assert.ok(body !== null && typeof body === "object", "body should be an object");
    const b = body as Record<string, unknown>;
    assert.strictEqual(b["status"], "ok");
    assert.strictEqual(b["runtime"], "test-runtime");
    assert.strictEqual(typeof b["timestamp"], "string");
    assert.strictEqual(typeof b["pid"], "number");
    assert.strictEqual(typeof b["uptimeSeconds"], "number");
  });

  it("accepts trailing slash on /health/live/", async () => {
    const { handle, port } = await startTestServer();
    after(() => handle.close());

    const { statusCode } = await get(`http://localhost:${port}/health/live/`);
    assert.strictEqual(statusCode, 200);
  });

  it("includes the correct runtime name in the response", async () => {
    const { handle, port } = await startTestServer({ runtime: "mcp-server" });
    after(() => handle.close());

    const { body } = await get(`http://localhost:${port}/health/live`);
    const b = body as Record<string, unknown>;
    assert.strictEqual(b["runtime"], "mcp-server");
  });
});

// ---------------------------------------------------------------------------
// /health/ready — all probes passing
// ---------------------------------------------------------------------------

describe("GET /health/ready — all probes pass", () => {
  it("returns HTTP 200 when all dependency probes return ok:true", async () => {
    const passingProbes = async (): Promise<DependencyCheckResult[]> => [
      { name: "postgres", ok: true, message: "ok", latencyMs: 1 },
      { name: "redis", ok: true, message: "ok", latencyMs: 1 },
    ];

    const { handle, port } = await startTestServer({ runProbes: passingProbes });
    after(() => handle.close());

    const { statusCode, body } = await get(`http://localhost:${port}/health/ready`);

    assert.strictEqual(statusCode, 200);
    const b = body as Record<string, unknown>;
    assert.strictEqual(b["status"], "ok");
  });

  it("returns a valid readiness response shape when all probes pass", async () => {
    const passingProbes = async (): Promise<DependencyCheckResult[]> => [
      { name: "postgres", ok: true, message: "tcp ok", latencyMs: 2 },
      { name: "redis", ok: true, message: "tcp ok", latencyMs: 1 },
    ];

    const { handle, port } = await startTestServer({ runProbes: passingProbes });
    after(() => handle.close());

    const { body } = await get(`http://localhost:${port}/health/ready`);
    const b = body as Record<string, unknown>;

    assert.strictEqual(typeof b["timestamp"], "string");
    assert.strictEqual(typeof b["runtime"], "string");
    assert.ok(Array.isArray(b["dependencies"]), "dependencies should be an array");
    const deps = b["dependencies"] as Array<Record<string, unknown>>;
    assert.strictEqual(deps.length, 2);
    assert.ok(deps.every((d) => d["ok"] === true));
  });
});

// ---------------------------------------------------------------------------
// /health/ready — at least one probe failing
// ---------------------------------------------------------------------------

describe("GET /health/ready — probe failure", () => {
  it("returns HTTP 503 when any dependency probe returns ok:false", async () => {
    const failingProbes = async (): Promise<DependencyCheckResult[]> => [
      { name: "postgres", ok: false, message: "connection refused" },
      { name: "redis", ok: true, message: "ok", latencyMs: 1 },
    ];

    const { handle, port } = await startTestServer({ runProbes: failingProbes });
    after(() => handle.close());

    const { statusCode, body } = await get(`http://localhost:${port}/health/ready`);

    assert.strictEqual(statusCode, 503);
    const b = body as Record<string, unknown>;
    assert.strictEqual(b["status"], "unavailable");
  });

  it("returns HTTP 503 when all probes fail", async () => {
    const failingProbes = async (): Promise<DependencyCheckResult[]> => [
      { name: "postgres", ok: false, message: "timeout" },
      { name: "redis", ok: false, message: "connection refused" },
    ];

    const { handle, port } = await startTestServer({ runProbes: failingProbes });
    after(() => handle.close());

    const { statusCode } = await get(`http://localhost:${port}/health/ready`);
    assert.strictEqual(statusCode, 503);
  });

  it("surfaces individual failing dependency details in the response body", async () => {
    const failingProbes = async (): Promise<DependencyCheckResult[]> => [
      { name: "postgres", ok: false, message: "TCP connect timed out" },
      { name: "redis", ok: true, message: "ok" },
    ];

    const { handle, port } = await startTestServer({ runProbes: failingProbes });
    after(() => handle.close());

    const { body } = await get(`http://localhost:${port}/health/ready`);
    const b = body as Record<string, unknown>;
    const deps = b["dependencies"] as Array<Record<string, unknown>>;

    const pgDep = deps.find((d) => d["name"] === "postgres");
    assert.ok(pgDep !== undefined, "postgres dependency should be in response");
    assert.strictEqual(pgDep["ok"], false);
    assert.ok(
      typeof pgDep["message"] === "string" && pgDep["message"].length > 0,
      "failure message should be non-empty",
    );
  });
});

// ---------------------------------------------------------------------------
// /health/ready — probe-runner internal failure
// ---------------------------------------------------------------------------

describe("GET /health/ready — probe-runner internal failure", () => {
  it("returns HTTP 503 and a probe-runner error result when runProbes throws", async () => {
    const throwingProbes = async (): Promise<DependencyCheckResult[]> => {
      throw new Error("probe infrastructure crashed");
    };

    const { handle, port } = await startTestServer({ runProbes: throwingProbes });
    after(() => handle.close());

    const { statusCode, body } = await get(`http://localhost:${port}/health/ready`);

    assert.strictEqual(statusCode, 503);
    const b = body as Record<string, unknown>;
    assert.strictEqual(b["status"], "unavailable");

    const deps = b["dependencies"] as Array<Record<string, unknown>>;
    assert.strictEqual(deps.length, 1);
    assert.strictEqual(deps[0]!["name"], "probe-runner");
    assert.strictEqual(deps[0]!["ok"], false);
    assert.ok(
      typeof deps[0]!["message"] === "string" &&
        (deps[0]!["message"] as string).includes("probe infrastructure crashed"),
      "error message should propagate",
    );
  });

  it("returns HTTP 503 when runProbes throws a non-Error value", async () => {
    const throwingProbes = async (): Promise<DependencyCheckResult[]> => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string error value";
    };

    const { handle, port } = await startTestServer({ runProbes: throwingProbes });
    after(() => handle.close());

    const { statusCode, body } = await get(`http://localhost:${port}/health/ready`);

    assert.strictEqual(statusCode, 503);
    const b = body as Record<string, unknown>;
    assert.strictEqual(b["status"], "unavailable");
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown paths
// ---------------------------------------------------------------------------

describe("unknown paths", () => {
  it("returns 404 for an unrecognised path", async () => {
    const { handle, port } = await startTestServer();
    after(() => handle.close());

    const { statusCode } = await get(`http://localhost:${port}/unknown`);
    assert.strictEqual(statusCode, 404);
  });

  it("returns 404 for the root path", async () => {
    const { handle, port } = await startTestServer();
    after(() => handle.close());

    const { statusCode } = await get(`http://localhost:${port}/`);
    assert.strictEqual(statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// Startup failure — port already in use
// ---------------------------------------------------------------------------

describe("createHealthServer — startup failure", () => {
  it("rejects when the port is already in use", async () => {
    // Occupy a port first.
    const occupyingServer = http.createServer();
    const occupiedPort = await new Promise<number>((resolve, reject) => {
      occupyingServer.listen(0, () => {
        const addr = occupyingServer.address();
        resolve(addr && typeof addr === "object" ? addr.port : 0);
      });
      occupyingServer.on("error", reject);
    });

    try {
      // Attempting to bind the same port must reject.
      await assert.rejects(
        () =>
          createHealthServer({
            runtime: "test",
            port: occupiedPort,
            probeOptions: { postgres: {}, redis: {} },
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error, "rejection value should be an Error");
          // EADDRINUSE is the expected Node.js error code for a bound port.
          assert.ok(
            (err as NodeJS.ErrnoException).code === "EADDRINUSE" ||
              err.message.includes("EADDRINUSE") ||
              err.message.toLowerCase().includes("address already in use"),
            `Expected EADDRINUSE error, got: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await new Promise<void>((resolve) => { occupyingServer.close(() => resolve()); });
    }
  });
});

// ---------------------------------------------------------------------------
// MCP_HEALTH_PORT and WORKER_HEALTH_PORT — config defaulting and parsing
// ---------------------------------------------------------------------------

describe("health port config — MCP_HEALTH_PORT", () => {
  const BASE_ENV = { DATABASE_URL: "postgres://user:pass@localhost:5432/dive_planner" };

  it("defaults server.healthPort to 9000 when MCP_HEALTH_PORT is absent", () => {
    const cfg = loadConfig(BASE_ENV);
    assert.strictEqual(cfg.server.healthPort, 9000);
  });

  it("parses a custom MCP_HEALTH_PORT value", () => {
    const cfg = loadConfig({ ...BASE_ENV, MCP_HEALTH_PORT: "9100" });
    assert.strictEqual(cfg.server.healthPort, 9100);
  });

  it("throws ConfigError for a non-integer MCP_HEALTH_PORT", () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, MCP_HEALTH_PORT: "not-a-port" }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /MCP_HEALTH_PORT/);
        return true;
      },
    );
  });

  it("throws ConfigError for a non-positive MCP_HEALTH_PORT", () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, MCP_HEALTH_PORT: "0" }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /MCP_HEALTH_PORT/);
        return true;
      },
    );
  });
});

describe("health port config — WORKER_HEALTH_PORT", () => {
  const BASE_ENV = { DATABASE_URL: "postgres://user:pass@localhost:5432/dive_planner" };

  it("defaults worker.healthPort to 9001 when WORKER_HEALTH_PORT is absent", () => {
    const cfg = loadConfig(BASE_ENV);
    assert.strictEqual(cfg.worker.healthPort, 9001);
  });

  it("parses a custom WORKER_HEALTH_PORT value", () => {
    const cfg = loadConfig({ ...BASE_ENV, WORKER_HEALTH_PORT: "9200" });
    assert.strictEqual(cfg.worker.healthPort, 9200);
  });

  it("throws ConfigError for a non-integer WORKER_HEALTH_PORT", () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, WORKER_HEALTH_PORT: "abc" }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /WORKER_HEALTH_PORT/);
        return true;
      },
    );
  });

  it("throws ConfigError for a non-positive WORKER_HEALTH_PORT", () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, WORKER_HEALTH_PORT: "-1" }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /WORKER_HEALTH_PORT/);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Structured logger integration — startup log shape regression
// ---------------------------------------------------------------------------

describe("createHealthServer — structured startup logging", () => {
  /**
   * Captures a single process.stdout.write call synchronously.
   * Returns the captured lines as parsed JSON objects.
   */
  function captureStdout(fn: () => void): LogEntry[] {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: Uint8Array | string): boolean => {
      lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as never;
    try {
      fn();
    } finally {
      process.stdout.write = original;
    }
    return lines
      .flatMap((l) => l.split("\n"))
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as LogEntry);
  }

  it("emits a structured JSON startup log entry via the provided logger", async () => {
    const capturedEntries: LogEntry[] = [];

    // Create a logger and intercept its output synchronously.
    // We start the server, capture output during the startup promise, then close.
    const log = createLogger("info", { runtime: "test-runtime" });

    // Allocate an ephemeral port.
    const port = await new Promise<number>((resolve, reject) => {
      const probe = http.createServer();
      probe.listen(0, () => {
        const addr = probe.address();
        const p = addr && typeof addr === "object" ? addr.port : 0;
        probe.close((err) => (err ? reject(err) : resolve(p)));
      });
      probe.on("error", reject);
    });

    // Wrap createHealthServer in stdout capture so we intercept the logger's write.
    let handle: Awaited<ReturnType<typeof createHealthServer>> | undefined;
    const entries = await new Promise<LogEntry[]>((resolve, reject) => {
      const captured: LogEntry[] = [];
      const original = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: Uint8Array | string): boolean => {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        text
          .split("\n")
          .filter((l) => l.trim() !== "")
          .forEach((l) => {
            try { captured.push(JSON.parse(l) as LogEntry); } catch { /* ignore non-JSON */ }
          });
        return true;
      }) as never;

      createHealthServer({ runtime: "test-runtime", port, probeOptions: { postgres: {}, redis: {} }, logger: log })
        .then((h) => {
          process.stdout.write = original;
          handle = h;
          resolve(captured);
        })
        .catch((err) => {
          process.stdout.write = original;
          reject(err);
        });
    });

    after(() => handle?.close());

    assert.ok(entries.length >= 1, "expected at least one structured log entry on startup");
    const startupEntry = entries.find((e) => e.message === "health server listening");
    assert.ok(startupEntry !== undefined, "expected a 'health server listening' log entry");

    // Verify required structured fields.
    assert.strictEqual(startupEntry.level, "info");
    assert.strictEqual(typeof startupEntry.timestamp, "string");
    const d = new Date(startupEntry.timestamp);
    assert.ok(!isNaN(d.getTime()), "timestamp should be a valid ISO string");

    // Component and runtime context fields.
    assert.strictEqual((startupEntry as Record<string, unknown>)["component"], "health");
    assert.strictEqual((startupEntry as Record<string, unknown>)["runtime"], "test-runtime");
    assert.strictEqual((startupEntry as Record<string, unknown>)["port"], port);
  });

  it("falls back to plain stdout when no logger is provided", async () => {
    // Allocate an ephemeral port.
    const port = await new Promise<number>((resolve, reject) => {
      const probe = http.createServer();
      probe.listen(0, () => {
        const addr = probe.address();
        const p = addr && typeof addr === "object" ? addr.port : 0;
        probe.close((err) => (err ? reject(err) : resolve(p)));
      });
      probe.on("error", reject);
    });

    const plainLines: string[] = [];
    let handle: Awaited<ReturnType<typeof createHealthServer>> | undefined;

    const lines = await new Promise<string[]>((resolve, reject) => {
      const original = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: Uint8Array | string): boolean => {
        plainLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as never;

      createHealthServer({ runtime: "fallback-runtime", port, probeOptions: { postgres: {}, redis: {} } })
        .then((h) => {
          process.stdout.write = original;
          handle = h;
          resolve(plainLines);
        })
        .catch((err) => {
          process.stdout.write = original;
          reject(err);
        });
    });

    after(() => handle?.close());

    const combined = lines.join("");
    assert.ok(
      combined.includes("[health]") && combined.includes("fallback-runtime"),
      `expected plain-text fallback log, got: ${combined}`,
    );
  });
});
