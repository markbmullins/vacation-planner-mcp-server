/**
 * Tests for the structured logging and async context modules.
 *
 * Covers:
 * - createLogger: log level filtering, JSON output format, child logger
 * - logger.error writes to stderr; other levels write to stdout
 * - AsyncLocalStorage context: getContext, getCorrelationId, contextLogFields
 * - runWithContext: propagates context to nested calls and async continuations
 * - correlation ID is automatically injected into log entries when in context
 * - generateCorrelationId: returns a non-empty string UUID
 *
 * Uses Node.js built-in test runner (node:test) so no extra test deps needed.
 * Log output is captured by temporarily replacing process.stdout.write and
 * process.stderr.write for the duration of each test.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createLogger,
  logger as defaultLogger,
  type Logger,
} from "./logger.js";
import {
  runWithContext,
  getContext,
  getCorrelationId,
  contextLogFields,
  generateCorrelationId,
  type RequestContext,
} from "./context.js";

// ---------------------------------------------------------------------------
// Stream capture helpers
// ---------------------------------------------------------------------------

interface Captured {
  stdout: string[];
  stderr: string[];
}

/**
 * Replaces process.stdout.write and process.stderr.write for the duration of
 * the callback and returns the captured lines.
 */
function captureOutput<T>(fn: () => T): { result: T; captured: Captured } {
  const captured: Captured = { stdout: [], stderr: [] };

  // Save originals using the exact overloaded type from NodeJS.WriteStream.
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  // Cast to `never` to bypass TypeScript's overload union check when assigning
  // our simplified capture function.
  process.stdout.write = ((chunk: Uint8Array | string): boolean => {
    captured.stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as never;

  process.stderr.write = ((chunk: Uint8Array | string): boolean => {
    captured.stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as never;

  let result: T;
  try {
    result = fn();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return { result, captured };
}

/**
 * Parses NDJSON lines from captured output into an array of objects.
 */
function parseLines(lines: string[]): Record<string, unknown>[] {
  return lines
    .flatMap((l) => l.split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// createLogger — basic output
// ---------------------------------------------------------------------------

describe("createLogger — output format", () => {
  it("writes a JSON log line to stdout for info level", () => {
    const log = createLogger("info");
    const { captured } = captureOutput(() => {
      log.info("test message");
    });

    const entries = parseLines(captured.stdout);
    assert.strictEqual(entries.length, 1);
    const entry = entries[0]!;
    assert.strictEqual(entry["level"], "info");
    assert.strictEqual(entry["message"], "test message");
    assert.strictEqual(typeof entry["timestamp"], "string");
  });

  it("writes a JSON log line to stderr for error level", () => {
    const log = createLogger("error");
    const { captured } = captureOutput(() => {
      log.error("something broke");
    });

    assert.strictEqual(captured.stdout.length, 0);
    const entries = parseLines(captured.stderr);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]!["level"], "error");
    assert.strictEqual(entries[0]!["message"], "something broke");
  });

  it("includes extra data fields in the log entry", () => {
    const log = createLogger("info");
    const { captured } = captureOutput(() => {
      log.info("with data", { component: "TestService", count: 42 });
    });

    const entries = parseLines(captured.stdout);
    assert.strictEqual(entries[0]!["component"], "TestService");
    assert.strictEqual(entries[0]!["count"], 42);
  });

  it("timestamp is a valid ISO 8601 string", () => {
    const log = createLogger("info");
    const { captured } = captureOutput(() => { log.info("ts test"); });
    const entry = parseLines(captured.stdout)[0]!;
    const d = new Date(entry["timestamp"] as string);
    assert.ok(!isNaN(d.getTime()), "timestamp should be parseable as a Date");
  });
});

// ---------------------------------------------------------------------------
// createLogger — log level filtering
// ---------------------------------------------------------------------------

describe("createLogger — log level filtering", () => {
  it("suppresses debug entries when level is info", () => {
    const log = createLogger("info");
    const { captured } = captureOutput(() => {
      log.debug("hidden debug");
      log.info("visible info");
    });
    const entries = parseLines(captured.stdout);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]!["level"], "info");
  });

  it("suppresses info and debug entries when level is warn", () => {
    const log = createLogger("warn");
    const { captured } = captureOutput(() => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    });
    const stdoutEntries = parseLines(captured.stdout);
    const stderrEntries = parseLines(captured.stderr);

    assert.strictEqual(stdoutEntries.length, 1, "only warn should appear in stdout");
    assert.strictEqual(stdoutEntries[0]!["level"], "warn");
    assert.strictEqual(stderrEntries.length, 1, "only error should appear in stderr");
    assert.strictEqual(stderrEntries[0]!["level"], "error");
  });

  it("emits all levels when level is debug", () => {
    const log = createLogger("debug");
    const { captured } = captureOutput(() => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    });
    const stdoutEntries = parseLines(captured.stdout);
    const stderrEntries = parseLines(captured.stderr);
    // error goes to stderr, the rest to stdout
    assert.strictEqual(stdoutEntries.length, 3);
    assert.strictEqual(stderrEntries.length, 1);
  });

  it("suppresses everything when level is error and only emits error", () => {
    const log = createLogger("error");
    const { captured } = captureOutput(() => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    });
    assert.strictEqual(parseLines(captured.stdout).length, 0);
    assert.strictEqual(parseLines(captured.stderr).length, 1);
  });
});

// ---------------------------------------------------------------------------
// createLogger — child logger
// ---------------------------------------------------------------------------

describe("createLogger — child logger", () => {
  it("child logger includes default data from parent and its own defaults", () => {
    const parent = createLogger("info", { runtime: "worker" });
    const child = parent.child({ component: "CrawlService" });

    const { captured } = captureOutput(() => {
      child.info("child message");
    });

    const entry = parseLines(captured.stdout)[0]!;
    assert.strictEqual(entry["runtime"], "worker");
    assert.strictEqual(entry["component"], "CrawlService");
    assert.strictEqual(entry["message"], "child message");
  });

  it("child logger inherits parent level", () => {
    const parent = createLogger("warn");
    const child = parent.child({ sub: true });
    const { captured } = captureOutput(() => {
      child.info("should be suppressed");
      child.warn("should appear");
    });
    const entries = parseLines(captured.stdout);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]!["level"], "warn");
  });

  it("call-site data overrides child defaults", () => {
    const child = createLogger("info", { tag: "default" });
    const { captured } = captureOutput(() => {
      child.info("override", { tag: "override" });
    });
    const entry = parseLines(captured.stdout)[0]!;
    assert.strictEqual(entry["tag"], "override");
  });
});

// ---------------------------------------------------------------------------
// generateCorrelationId
// ---------------------------------------------------------------------------

describe("generateCorrelationId", () => {
  it("returns a non-empty string", () => {
    const id = generateCorrelationId();
    assert.ok(typeof id === "string" && id.length > 0, "should be a non-empty string");
  });

  it("returns unique values on successive calls", () => {
    const ids = Array.from({ length: 10 }, generateCorrelationId);
    const unique = new Set(ids);
    assert.strictEqual(unique.size, 10, "each call should return a unique ID");
  });

  it("returns a UUID-v4 format string", () => {
    const id = generateCorrelationId();
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(id, uuidPattern, `expected UUID v4, got: ${id}`);
  });
});

// ---------------------------------------------------------------------------
// AsyncLocalStorage context
// ---------------------------------------------------------------------------

describe("getContext / getCorrelationId — outside context", () => {
  // Ensure we are testing from outside any active context.
  it("getContext returns undefined outside a runWithContext scope", () => {
    // We might be inside a test runner context, but NOT inside a
    // runWithContext scope we own.  This is best-effort.
    // Run in a fresh async chain to be safe.
    const ctx = getContext();
    // Accept undefined — if test runner itself uses ALS the value
    // would be its own store, but since we use a module-private store
    // it should always be undefined here.
    assert.strictEqual(ctx, undefined);
  });

  it("getCorrelationId returns undefined outside a runWithContext scope", () => {
    assert.strictEqual(getCorrelationId(), undefined);
  });

  it("contextLogFields returns an empty object outside a runWithContext scope", () => {
    const fields = contextLogFields();
    assert.deepStrictEqual(fields, {});
  });
});

describe("runWithContext — synchronous propagation", () => {
  it("makes context visible within the callback via getContext()", () => {
    const ctx: RequestContext = {
      correlationId: "sync-test-id",
      contextType: "request",
    };

    let seenCtx: RequestContext | undefined;
    runWithContext(ctx, () => {
      seenCtx = getContext();
    });

    assert.deepStrictEqual(seenCtx, ctx);
  });

  it("getCorrelationId returns the correlationId from context", () => {
    let seenId: string | undefined;
    runWithContext({ correlationId: "abc-123", contextType: "request" }, () => {
      seenId = getCorrelationId();
    });
    assert.strictEqual(seenId, "abc-123");
  });

  it("context is not visible after the callback returns", () => {
    runWithContext({ correlationId: "transient", contextType: "request" }, () => {
      // inside
    });
    // outside — should no longer see the context
    assert.strictEqual(getCorrelationId(), undefined);
  });
});

describe("runWithContext — async propagation", () => {
  it("propagates context through an awaited Promise", async () => {
    const id = generateCorrelationId();
    let seenId: string | undefined;

    await runWithContext({ correlationId: id, contextType: "request" }, async () => {
      await Promise.resolve(); // yield to event loop
      seenId = getCorrelationId();
    });

    assert.strictEqual(seenId, id);
  });

  it("propagates context through nested async calls", async () => {
    const id = generateCorrelationId();
    const seen: string[] = [];

    async function inner() {
      await Promise.resolve();
      seen.push(getCorrelationId() ?? "none");
    }

    async function outer() {
      await inner();
      seen.push(getCorrelationId() ?? "none");
    }

    await runWithContext({ correlationId: id, contextType: "request" }, outer);

    assert.ok(seen.every((s) => s === id), `All calls should see ${id}, got: ${seen.join(", ")}`);
  });

  it("does not leak context between independent runWithContext calls", async () => {
    const id1 = "ctx-one";
    const id2 = "ctx-two";
    const seen: string[] = [];

    await Promise.all([
      runWithContext({ correlationId: id1, contextType: "request" }, async () => {
        await Promise.resolve();
        seen.push(getCorrelationId() ?? "none");
      }),
      runWithContext({ correlationId: id2, contextType: "job", jobId: "j1" }, async () => {
        await Promise.resolve();
        seen.push(getCorrelationId() ?? "none");
      }),
    ]);

    assert.ok(seen.includes(id1), "id1 should appear");
    assert.ok(seen.includes(id2), "id2 should appear");
    assert.strictEqual(seen.length, 2);
  });
});

describe("contextLogFields", () => {
  it("returns correlationId and contextType for a request context", () => {
    let fields: Record<string, unknown> = {};
    runWithContext(
      { correlationId: "req-id", contextType: "request" },
      () => { fields = contextLogFields(); },
    );
    assert.strictEqual(fields["correlationId"], "req-id");
    assert.strictEqual(fields["contextType"], "request");
  });

  it("includes jobId, queueName, and jobName for a job context", () => {
    let fields: Record<string, unknown> = {};
    runWithContext(
      {
        correlationId: "job-corr",
        contextType: "job",
        jobId: "j123",
        queueName: "crawl-fetch",
        jobName: "crawlOperator",
      },
      () => { fields = contextLogFields(); },
    );
    assert.strictEqual(fields["jobId"], "j123");
    assert.strictEqual(fields["queueName"], "crawl-fetch");
    assert.strictEqual(fields["jobName"], "crawlOperator");
  });

  it("spreads meta fields into the returned object", () => {
    let fields: Record<string, unknown> = {};
    runWithContext(
      {
        correlationId: "m",
        contextType: "request",
        meta: { tool: "searchDiveSites", version: 1 },
      },
      () => { fields = contextLogFields(); },
    );
    assert.strictEqual(fields["tool"], "searchDiveSites");
    assert.strictEqual(fields["version"], 1);
  });
});

// ---------------------------------------------------------------------------
// Logger + context integration
// ---------------------------------------------------------------------------

describe("logger automatically injects correlationId from context", () => {
  it("log entry includes correlationId when inside a runWithContext scope", () => {
    const log = createLogger("info");
    let captured: Captured = { stdout: [], stderr: [] };

    runWithContext({ correlationId: "injected-id", contextType: "request" }, () => {
      ({ captured } = captureOutput(() => {
        log.info("with context");
      }));
    });

    const entries = parseLines(captured.stdout);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]!["correlationId"], "injected-id");
    assert.strictEqual(entries[0]!["contextType"], "request");
  });

  it("log entry does not include correlationId outside a context scope", () => {
    const log = createLogger("info");
    const { captured } = captureOutput(() => {
      log.info("no context");
    });

    const entries = parseLines(captured.stdout);
    assert.strictEqual(entries.length, 1);
    assert.ok(!("correlationId" in entries[0]!), "correlationId should not be present outside context");
  });

  it("job context fields are injected into log entries", () => {
    const log = createLogger("info");
    let captured: Captured = { stdout: [], stderr: [] };

    runWithContext(
      {
        correlationId: "job-id-123",
        contextType: "job",
        jobId: "bq-job-456",
        queueName: "crawl-fetch",
        jobName: "crawlOperator",
      },
      () => {
        ({ captured } = captureOutput(() => {
          log.info("processing job");
        }));
      },
    );

    const entry = parseLines(captured.stdout)[0]!;
    assert.strictEqual(entry["correlationId"], "job-id-123");
    assert.strictEqual(entry["contextType"], "job");
    assert.strictEqual(entry["jobId"], "bq-job-456");
    assert.strictEqual(entry["queueName"], "crawl-fetch");
    assert.strictEqual(entry["jobName"], "crawlOperator");
  });
});

// ---------------------------------------------------------------------------
// Default logger export
// ---------------------------------------------------------------------------

describe("default logger export", () => {
  it("is a Logger instance with level 'info'", () => {
    assert.strictEqual(defaultLogger.level, "info");
    assert.ok(typeof defaultLogger.info === "function");
    assert.ok(typeof defaultLogger.error === "function");
    assert.ok(typeof defaultLogger.child === "function");
  });
});
