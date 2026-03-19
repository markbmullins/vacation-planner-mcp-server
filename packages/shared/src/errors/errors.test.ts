/**
 * Tests for the structured error envelope module.
 *
 * Covers:
 * - buildErrorEnvelope: wrapping AppError, Error, non-Error thrown values
 * - correlationId is injected from async context when available
 * - validationEnvelope and sourceUnavailableEnvelope convenience factories
 * - toClientEnvelope strips stack and context
 * - ok: false is always set
 * - timestamp is a valid ISO 8601 string
 *
 * Uses Node.js built-in test runner (node:test).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildErrorEnvelope,
  validationEnvelope,
  sourceUnavailableEnvelope,
  toClientEnvelope,
  type ErrorEnvelope,
} from "./envelope.js";
import { installGlobalErrorHandlers } from "./handler.js";
import {
  AppError,
  ValidationError,
  NotFoundError,
  SourceUnavailableError,
  ConstraintViolationError,
} from "../types/errors.js";
import { runWithContext } from "../logging/context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertValidEnvelope(env: ErrorEnvelope): void {
  assert.strictEqual(env.ok, false, "ok should always be false");
  assert.ok(typeof env.code === "string" && env.code.length > 0, "code should be a non-empty string");
  assert.ok(typeof env.message === "string" && env.message.length > 0, "message should be a non-empty string");
  assert.ok(typeof env.timestamp === "string", "timestamp should be a string");
  const d = new Date(env.timestamp);
  assert.ok(!isNaN(d.getTime()), "timestamp should be a valid date");
}

// ---------------------------------------------------------------------------
// buildErrorEnvelope — AppError subclasses
// ---------------------------------------------------------------------------

describe("buildErrorEnvelope — AppError subclasses", () => {
  it("maps ValidationError to INVALID_INPUT code", () => {
    const err = new ValidationError("bad field");
    const env = buildErrorEnvelope(err);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INVALID_INPUT");
    assert.strictEqual(env.message, "bad field");
  });

  it("maps NotFoundError to NOT_FOUND code", () => {
    const err = new NotFoundError("resource missing");
    const env = buildErrorEnvelope(err);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "NOT_FOUND");
  });

  it("maps SourceUnavailableError to SOURCE_UNAVAILABLE code", () => {
    const err = new SourceUnavailableError("upstream down");
    const env = buildErrorEnvelope(err);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "SOURCE_UNAVAILABLE");
  });

  it("maps ConstraintViolationError to CONSTRAINT_VIOLATION code", () => {
    const err = new ConstraintViolationError("no fly rule");
    const env = buildErrorEnvelope(err);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "CONSTRAINT_VIOLATION");
  });

  it("preserves AppError context fields in the envelope", () => {
    const err = new ValidationError("bad value", { field: "budget", received: -1 });
    const env = buildErrorEnvelope(err);
    assert.ok(env.context !== undefined);
    assert.strictEqual(env.context["field"], "budget");
    assert.strictEqual(env.context["received"], -1);
  });

  it("merges AppError context with caller-supplied context", () => {
    const err = new ValidationError("bad", { fromError: true });
    const env = buildErrorEnvelope(err, { context: { fromCaller: true } });
    assert.ok(env.context !== undefined);
    assert.strictEqual(env.context["fromError"], true);
    assert.strictEqual(env.context["fromCaller"], true);
  });

  it("caller code option overrides the error's own code", () => {
    const err = new ValidationError("msg");
    const env = buildErrorEnvelope(err, { code: "INTERNAL_ERROR" });
    assert.strictEqual(env.code, "INTERNAL_ERROR");
  });

  it("includes stack trace by default", () => {
    const err = new ValidationError("with stack");
    const env = buildErrorEnvelope(err);
    assert.ok(typeof env.stack === "string" && env.stack.length > 0, "stack should be present");
  });

  it("omits stack trace when includeStack is false", () => {
    const err = new ValidationError("no stack");
    const env = buildErrorEnvelope(err, { includeStack: false });
    assert.strictEqual(env.stack, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildErrorEnvelope — plain Error
// ---------------------------------------------------------------------------

describe("buildErrorEnvelope — plain Error", () => {
  it("wraps a plain Error as INTERNAL_ERROR", () => {
    const err = new Error("plain failure");
    const env = buildErrorEnvelope(err);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    assert.strictEqual(env.message, "plain failure");
  });

  it("allows code override for a plain Error", () => {
    const err = new Error("external timeout");
    const env = buildErrorEnvelope(err, { code: "SOURCE_UNAVAILABLE" });
    assert.strictEqual(env.code, "SOURCE_UNAVAILABLE");
  });

  it("includes stack trace for a plain Error by default", () => {
    const err = new Error("stack error");
    const env = buildErrorEnvelope(err);
    assert.ok(typeof env.stack === "string" && env.stack.includes("Error:"), "stack should reference the error");
  });

  it("attaches caller context to a plain Error envelope", () => {
    const err = new Error("ctx error");
    const env = buildErrorEnvelope(err, { context: { source: "FlightAdapter" } });
    assert.ok(env.context !== undefined);
    assert.strictEqual(env.context["source"], "FlightAdapter");
  });
});

// ---------------------------------------------------------------------------
// buildErrorEnvelope — non-Error thrown values
// ---------------------------------------------------------------------------

describe("buildErrorEnvelope — non-Error thrown values", () => {
  it("wraps a thrown string as INTERNAL_ERROR with that string as message", () => {
    const env = buildErrorEnvelope("raw string error");
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    assert.strictEqual(env.message, "raw string error");
  });

  it("wraps null as INTERNAL_ERROR with a fallback message", () => {
    const env = buildErrorEnvelope(null);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    assert.ok(env.message.length > 0);
  });

  it("wraps undefined as INTERNAL_ERROR with a fallback message", () => {
    const env = buildErrorEnvelope(undefined);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    assert.ok(env.message.length > 0);
  });

  it("wraps a thrown number as INTERNAL_ERROR", () => {
    const env = buildErrorEnvelope(42);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    assert.ok(env.message.includes("42"));
  });

  it("non-Error values do not have a stack field", () => {
    const env = buildErrorEnvelope("string throw");
    assert.strictEqual(env.stack, undefined);
  });

  it("wraps a circular object without throwing", () => {
    // JSON.stringify throws a TypeError for circular references.
    // buildErrorEnvelope must never throw — it should always return a valid envelope.
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    let env: ErrorEnvelope | undefined;
    assert.doesNotThrow(() => {
      env = buildErrorEnvelope(circular);
    }, "buildErrorEnvelope must not throw for circular objects");

    assert.ok(env !== undefined);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    // The message should contain some representation of the value.
    assert.ok(typeof env.message === "string" && env.message.length > 0);
  });

  it("wraps a BigInt without throwing", () => {
    // JSON.stringify throws a TypeError for BigInt values.
    // buildErrorEnvelope must fall back to String() and return a valid envelope.
    const big = BigInt(9007199254740991);

    let env: ErrorEnvelope | undefined;
    assert.doesNotThrow(() => {
      env = buildErrorEnvelope(big);
    }, "buildErrorEnvelope must not throw for BigInt values");

    assert.ok(env !== undefined);
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INTERNAL_ERROR");
    assert.ok(env.message.includes("9007199254740991"));
  });
});

// ---------------------------------------------------------------------------
// correlationId injection from async context
// ---------------------------------------------------------------------------

describe("buildErrorEnvelope — correlationId from context", () => {
  it("injects correlationId when inside a runWithContext scope", () => {
    let env: ErrorEnvelope | undefined;
    runWithContext({ correlationId: "req-corr-id", contextType: "request" }, () => {
      env = buildErrorEnvelope(new Error("ctx error"));
    });
    assert.ok(env !== undefined);
    assert.strictEqual(env.correlationId, "req-corr-id");
  });

  it("does not include correlationId when outside any context", () => {
    // Not inside runWithContext so context store is empty.
    const env = buildErrorEnvelope(new Error("no ctx"));
    assert.strictEqual(env.correlationId, undefined);
  });

  it("injects correlationId from a job context", () => {
    let env: ErrorEnvelope | undefined;
    runWithContext(
      { correlationId: "job-corr-id", contextType: "job", jobId: "j1" },
      () => { env = buildErrorEnvelope(new Error("job error")); },
    );
    assert.ok(env !== undefined);
    assert.strictEqual(env.correlationId, "job-corr-id");
  });
});

// ---------------------------------------------------------------------------
// validationEnvelope
// ---------------------------------------------------------------------------

describe("validationEnvelope", () => {
  it("creates an INVALID_INPUT envelope with the given message", () => {
    const env = validationEnvelope("field is required");
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "INVALID_INPUT");
    assert.strictEqual(env.message, "field is required");
  });

  it("includes context when provided", () => {
    const env = validationEnvelope("bad input", { field: "budget" });
    assert.ok(env.context !== undefined);
    assert.strictEqual(env.context["field"], "budget");
  });

  it("omits context when not provided", () => {
    const env = validationEnvelope("simple error");
    assert.strictEqual(env.context, undefined);
  });

  it("injects correlationId from active context", () => {
    let env: ErrorEnvelope | undefined;
    runWithContext({ correlationId: "v-corr", contextType: "request" }, () => {
      env = validationEnvelope("bad");
    });
    assert.ok(env !== undefined);
    assert.strictEqual(env.correlationId, "v-corr");
  });
});

// ---------------------------------------------------------------------------
// sourceUnavailableEnvelope
// ---------------------------------------------------------------------------

describe("sourceUnavailableEnvelope", () => {
  it("creates a SOURCE_UNAVAILABLE envelope with the given message", () => {
    const env = sourceUnavailableEnvelope("flight API unreachable");
    assertValidEnvelope(env);
    assert.strictEqual(env.code, "SOURCE_UNAVAILABLE");
    assert.strictEqual(env.message, "flight API unreachable");
  });

  it("includes context when provided", () => {
    const env = sourceUnavailableEnvelope("down", { provider: "Skyscanner" });
    assert.ok(env.context !== undefined);
    assert.strictEqual(env.context["provider"], "Skyscanner");
  });
});

// ---------------------------------------------------------------------------
// toClientEnvelope
// ---------------------------------------------------------------------------

describe("toClientEnvelope", () => {
  it("strips stack from the envelope", () => {
    const err = new Error("internal");
    const full = buildErrorEnvelope(err);
    const client = toClientEnvelope(full);
    assert.ok(!("stack" in client), "stack should be removed");
  });

  it("strips context from the envelope", () => {
    const err = new ValidationError("bad", { sensitive: "data" });
    const full = buildErrorEnvelope(err);
    const client = toClientEnvelope(full);
    assert.ok(!("context" in client), "context should be removed");
  });

  it("preserves ok, code, message, correlationId, and timestamp for non-INTERNAL_ERROR codes", () => {
    let full: ErrorEnvelope | undefined;
    runWithContext({ correlationId: "client-corr", contextType: "request" }, () => {
      full = buildErrorEnvelope(new ValidationError("val error"));
    });
    assert.ok(full !== undefined);
    const client = toClientEnvelope(full);
    assert.strictEqual(client.ok, false);
    assert.strictEqual(client.code, "INVALID_INPUT");
    assert.strictEqual(client.message, "val error");
    assert.strictEqual(client.correlationId, "client-corr");
    assert.strictEqual(typeof client.timestamp, "string");
  });

  it("works when stack and context are already absent", () => {
    const env: ErrorEnvelope = {
      ok: false,
      code: "NOT_FOUND",
      message: "gone",
      timestamp: new Date().toISOString(),
    };
    const client = toClientEnvelope(env);
    assert.strictEqual(client.code, "NOT_FOUND");
    assert.strictEqual(client.message, "gone");
  });

  it("replaces the raw message with a generic safe string for INTERNAL_ERROR envelopes", () => {
    const err = new Error("ECONNREFUSED postgres://user:secret@db:5432/prod");
    const full = buildErrorEnvelope(err);
    // Server-side envelope retains the raw message for logs.
    assert.ok(full.message.includes("ECONNREFUSED"), "internal envelope should keep raw message");
    const client = toClientEnvelope(full);
    // Client envelope must NOT contain the raw message.
    assert.ok(
      !client.message.includes("ECONNREFUSED"),
      "client envelope must not expose raw internal error details",
    );
    assert.ok(
      !client.message.includes("secret"),
      "client envelope must not expose secrets from error messages",
    );
    // Should still be a non-empty, human-readable generic message.
    assert.ok(typeof client.message === "string" && client.message.length > 0);
    assert.strictEqual(client.code, "INTERNAL_ERROR");
  });

  it("sanitises INTERNAL_ERROR even when the raw envelope has no stack", () => {
    const env: ErrorEnvelope = {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "raw internal detail",
      timestamp: new Date().toISOString(),
    };
    const client = toClientEnvelope(env);
    assert.strictEqual(client.code, "INTERNAL_ERROR");
    assert.ok(
      !client.message.includes("raw internal detail"),
      "raw message must be replaced for INTERNAL_ERROR",
    );
  });

  it("does NOT sanitise messages for known safe error codes like SOURCE_UNAVAILABLE", () => {
    const env: ErrorEnvelope = {
      ok: false,
      code: "SOURCE_UNAVAILABLE",
      message: "Flight API is unreachable",
      timestamp: new Date().toISOString(),
    };
    const client = toClientEnvelope(env);
    assert.strictEqual(client.message, "Flight API is unreachable");
  });
});

// ---------------------------------------------------------------------------
// installGlobalErrorHandlers — global handler path
//
// These tests exercise handler.ts by installing global handlers, extracting
// the registered listener callbacks directly from process.listeners(), and
// invoking them without emitting process events (which would pollute the test
// runner's own unhandledRejection listener).
//
// This approach:
//   - tests the real handler logic (buildErrorEnvelope + logger.error + exit)
//   - avoids triggering Node's test runner on our deliberately thrown values
//   - cleans up all added listeners after each test
// ---------------------------------------------------------------------------

describe("installGlobalErrorHandlers", () => {
  /**
   * Creates a minimal mock logger that captures all calls to logger.error().
   * Returns the mock logger and the captured calls array.
   */
  function makeMockLogger() {
    const calls: Array<{ message: string; meta: Record<string, unknown> }> = [];
    // Build a minimal object that satisfies the Logger interface.
    // The `child` method returns the same mock so chained children also capture calls.
    const makeLogger = (): import("../logging/logger.js").Logger => {
      const inst: import("../logging/logger.js").Logger = {
        level: "error" as const,
        error: (message: string, meta: Record<string, unknown> = {}) => {
          calls.push({ message, meta });
        },
        info: () => {},
        warn: () => {},
        debug: () => {},
        child: () => inst,
      };
      return inst;
    };
    return { logger: makeLogger(), calls };
  }

  /**
   * Replaces process.exit with a no-op that records exit codes, runs `fn`,
   * then restores the original.  Returns the recorded exit codes.
   */
  function withMockedExit(fn: () => void): number[] {
    const codes: number[] = [];
    const original = process.exit.bind(process);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = (code?: number) => { codes.push(code ?? 0); };
    try {
      fn();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = original;
    }
    return codes;
  }

  /**
   * Installs global handlers, returns the registered listener functions, and
   * immediately removes those listeners from the process so they do not affect
   * subsequent tests.
   */
  function captureHandlerListeners(
    options: Parameters<typeof installGlobalErrorHandlers>[0],
  ): {
    rejectionHandler: (reason: unknown, promise: Promise<unknown>) => void;
    exceptionHandler: (error: Error, origin: string) => void;
  } {
    const rejectionsBefore = process.listeners("unhandledRejection").slice();
    const exceptionsBefore = process.listeners("uncaughtException").slice();

    installGlobalErrorHandlers(options);

    // The newly added handlers are any listeners not present before.
    const newRejection = process
      .listeners("unhandledRejection")
      .find((l) => !rejectionsBefore.includes(l)) as
      | ((reason: unknown, promise: Promise<unknown>) => void)
      | undefined;

    const newException = process
      .listeners("uncaughtException")
      .find((l) => !exceptionsBefore.includes(l)) as
      | ((error: Error, origin: string) => void)
      | undefined;

    // Remove both listeners immediately so they do not fire for other tests.
    if (newRejection) process.removeListener("unhandledRejection", newRejection);
    if (newException) process.removeListener("uncaughtException", newException);

    assert.ok(newRejection !== undefined, "installGlobalErrorHandlers should register an unhandledRejection listener");
    assert.ok(newException !== undefined, "installGlobalErrorHandlers should register an uncaughtException listener");

    return {
      rejectionHandler: newRejection!,
      exceptionHandler: newException!,
    };
  }

  it("logs a structured envelope and exits on unhandledRejection with a normal Error", () => {
    const { logger, calls } = makeMockLogger();
    const { rejectionHandler } = captureHandlerListeners({ logger, runtime: "test-runtime" });

    const exitCodes = withMockedExit(() => {
      rejectionHandler(new Error("promise rejected"), Promise.resolve());
    });

    assert.strictEqual(exitCodes[0], 1, "should exit with code 1");
    assert.strictEqual(calls.length, 1, "should log exactly one error");
    assert.ok(calls[0].message.includes("Unhandled Promise rejection"));
    assert.strictEqual(calls[0].meta["ok"], false);
    assert.strictEqual(calls[0].meta["code"], "INTERNAL_ERROR");
    assert.strictEqual(calls[0].meta["runtime"], "test-runtime");
    assert.ok(typeof calls[0].meta["timestamp"] === "string");
  });

  it("logs a structured envelope and exits on unhandledRejection with a circular object (non-serialisable)", () => {
    // Regression: buildErrorEnvelope must not throw when the rejected value is a
    // circular object that cannot be JSON.stringify'd.  The handler must still
    // log a valid structured envelope and exit cleanly.
    const { logger, calls } = makeMockLogger();
    const { rejectionHandler } = captureHandlerListeners({ logger, runtime: "test-runtime" });

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    let exitCodes: number[] = [];
    assert.doesNotThrow(() => {
      exitCodes = withMockedExit(() => {
        rejectionHandler(circular, Promise.resolve());
      });
    }, "the global handler must not throw for circular objects");

    assert.strictEqual(exitCodes[0], 1, "should exit with code 1 even for non-serialisable rejection");
    assert.strictEqual(calls.length, 1, "should log exactly one error");
    assert.strictEqual(calls[0].meta["ok"], false);
    assert.strictEqual(calls[0].meta["code"], "INTERNAL_ERROR");
    assert.ok(
      typeof calls[0].meta["message"] === "string" && (calls[0].meta["message"] as string).length > 0,
      "message must be a non-empty string",
    );
  });

  it("logs a structured envelope and exits on unhandledRejection with a BigInt (non-serialisable)", () => {
    const { logger, calls } = makeMockLogger();
    const { rejectionHandler } = captureHandlerListeners({ logger, runtime: "test-runtime" });

    const big = BigInt(42);

    let exitCodes: number[] = [];
    assert.doesNotThrow(() => {
      exitCodes = withMockedExit(() => {
        rejectionHandler(big, Promise.resolve());
      });
    }, "the global handler must not throw for BigInt values");

    assert.strictEqual(exitCodes[0], 1, "should exit with code 1 for BigInt rejection");
    assert.strictEqual(calls.length, 1, "should log exactly one error");
    assert.strictEqual(calls[0].meta["ok"], false);
    assert.strictEqual(calls[0].meta["code"], "INTERNAL_ERROR");
    assert.ok((calls[0].meta["message"] as string).includes("42"));
  });

  it("logs a structured envelope and exits on uncaughtException", () => {
    const { logger, calls } = makeMockLogger();
    const { exceptionHandler } = captureHandlerListeners({ logger, runtime: "test-runtime" });

    const exitCodes = withMockedExit(() => {
      exceptionHandler(new Error("sync crash"), "uncaughtException");
    });

    assert.strictEqual(exitCodes[0], 1, "should exit with code 1");
    assert.strictEqual(calls.length, 1, "should log exactly one error");
    assert.ok(calls[0].message.includes("Uncaught exception"));
    assert.strictEqual(calls[0].meta["ok"], false);
    assert.strictEqual(calls[0].meta["code"], "INTERNAL_ERROR");
    assert.strictEqual(calls[0].meta["message"], "sync crash");
    assert.ok(typeof calls[0].meta["stack"] === "string", "stack should be included in log");
  });
});
