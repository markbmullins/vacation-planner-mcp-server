/**
 * Structured error envelope for the Dive Vacation Planner.
 *
 * All unhandled errors and explicit error responses should be serialised
 * using this envelope so that:
 *  - log consumers see consistent structure across all failure modes
 *  - MCP tool handlers can return a predictable error payload
 *  - downstream tooling (alerting, dashboards) can filter by error code
 *
 * The envelope is intentionally separate from the AppError class hierarchy
 * so it can be used to wrap any thrown value, including third-party errors
 * and plain strings thrown by poorly-written code.
 *
 * Error taxonomy (maps to ErrorCode in types/errors.ts):
 *
 *   INVALID_INPUT        — caller provided bad input; safe to return to client
 *   NOT_FOUND            — a requested resource does not exist
 *   SOURCE_UNAVAILABLE   — an external dependency (flight API, crawler, etc.) is unreachable
 *   NO_RESULTS           — query succeeded but returned an empty result set
 *   PARTIAL_RESULTS      — some sub-requests failed; a degraded result is returned
 *   STALE_DATA           — data exists but is outside its freshness window
 *   CONSTRAINT_VIOLATION — a domain rule (e.g. no-fly-after-diving) was violated
 *   UNAUTHORIZED         — the caller lacks permission for the requested action
 *   INTERNAL_ERROR       — unexpected server-side failure; not safe to expose detail to clients
 */

import type { ErrorCode } from "../types/errors.js";
import { AppError } from "../types/errors.js";
import { getCorrelationId } from "../logging/context.js";

// ---------------------------------------------------------------------------
// Envelope type
// ---------------------------------------------------------------------------

/** Structured error payload returned by tools and services on failure */
export interface ErrorEnvelope {
  /** Whether the operation succeeded — always false for an error envelope */
  ok: false;
  /** Machine-readable error category */
  code: ErrorCode;
  /** Human-readable error summary — safe to display to the MCP consumer */
  message: string;
  /**
   * Correlation ID of the request or job that produced this error.
   * Pulled automatically from the async context when available.
   */
  correlationId?: string;
  /**
   * ISO 8601 timestamp of when the error was captured.
   */
  timestamp: string;
  /**
   * Optional additional context about the error.
   * Should NOT contain secrets or raw stack traces in production.
   * Safe for structured logging; filtered before sending to MCP clients.
   */
  context?: Record<string, unknown>;
  /**
   * Stack trace of the original error.
   * Included in log payloads only — never forwarded to MCP clients.
   * Omit or redact when building client-facing responses.
   */
  stack?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely converts any value to a string representation without ever throwing.
 *
 * JSON.stringify is not safe for circular objects or non-JSON-serialisable
 * primitives (e.g. BigInt). This helper tries JSON.stringify first and falls
 * back to String() — which is always safe — if serialisation fails.
 */
function safeStringify(value: unknown): string {
  try {
    return `Unexpected thrown value: ${JSON.stringify(value)}`;
  } catch {
    return `Unexpected thrown value: ${String(value)}`;
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Builds a structured ErrorEnvelope from any thrown value.
 *
 * - AppError subclasses are mapped to their declared code and context.
 * - Plain Error instances are mapped to INTERNAL_ERROR.
 * - Non-Error values (strings, numbers, etc.) are stringified and wrapped
 *   in an INTERNAL_ERROR envelope.
 *
 * The correlationId is automatically populated from the active async context
 * when available.
 *
 * @param thrown  The value caught in a try/catch or unhandledRejection handler.
 * @param options Optional overrides for code and context.
 */
export function buildErrorEnvelope(
  thrown: unknown,
  options: {
    code?: ErrorCode;
    context?: Record<string, unknown>;
    /** Whether to include the stack trace in the envelope (default true). */
    includeStack?: boolean;
  } = {},
): ErrorEnvelope {
  const { includeStack = true } = options;
  const correlationId = getCorrelationId();

  if (thrown instanceof AppError) {
    const envelope: ErrorEnvelope = {
      ok: false,
      code: options.code ?? thrown.code,
      message: thrown.message,
      timestamp: new Date().toISOString(),
      ...(correlationId !== undefined && { correlationId }),
    };

    const mergedContext: Record<string, unknown> = {
      ...(thrown.context ?? {}),
      ...(options.context ?? {}),
    };
    if (Object.keys(mergedContext).length > 0) {
      envelope.context = mergedContext;
    }

    if (includeStack && thrown.stack !== undefined) {
      envelope.stack = thrown.stack;
    }

    return envelope;
  }

  if (thrown instanceof Error) {
    const envelope: ErrorEnvelope = {
      ok: false,
      code: options.code ?? "INTERNAL_ERROR",
      message: thrown.message,
      timestamp: new Date().toISOString(),
      ...(correlationId !== undefined && { correlationId }),
    };

    if (options.context !== undefined && Object.keys(options.context).length > 0) {
      envelope.context = options.context;
    }

    if (includeStack && thrown.stack !== undefined) {
      envelope.stack = thrown.stack;
    }

    return envelope;
  }

  // Non-Error thrown value — stringify and wrap.
  // Use a safe stringification path that never throws: JSON.stringify can fail
  // for circular objects and non-JSON-safe primitives (e.g. BigInt), so we
  // catch any serialisation error and fall back to String() which is always safe.
  const message =
    thrown === null || thrown === undefined
      ? "Unknown error (null or undefined thrown)"
      : typeof thrown === "string"
        ? thrown
        : safeStringify(thrown);

  return {
    ok: false,
    code: options.code ?? "INTERNAL_ERROR",
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId !== undefined && { correlationId }),
    ...(options.context !== undefined &&
      Object.keys(options.context).length > 0 && { context: options.context }),
  };
}

/**
 * Builds an ErrorEnvelope with INVALID_INPUT code.
 * Convenience wrapper for validation failures.
 */
export function validationEnvelope(
  message: string,
  context?: Record<string, unknown>,
): ErrorEnvelope {
  const correlationId = getCorrelationId();
  return {
    ok: false,
    code: "INVALID_INPUT",
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId !== undefined && { correlationId }),
    ...(context !== undefined && Object.keys(context).length > 0 && { context }),
  };
}

/**
 * Builds an ErrorEnvelope with SOURCE_UNAVAILABLE code.
 * Convenience wrapper for external dependency failures.
 */
export function sourceUnavailableEnvelope(
  message: string,
  context?: Record<string, unknown>,
): ErrorEnvelope {
  const correlationId = getCorrelationId();
  return {
    ok: false,
    code: "SOURCE_UNAVAILABLE",
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId !== undefined && { correlationId }),
    ...(context !== undefined && Object.keys(context).length > 0 && { context }),
  };
}

/**
 * Generic message substituted for INTERNAL_ERROR envelopes sent to clients.
 *
 * Raw Error.message values from unexpected failures must not be forwarded to
 * callers: they can contain connection strings, file paths, library internals,
 * or other operational detail that reveals server-side implementation.
 */
const INTERNAL_ERROR_CLIENT_MESSAGE =
  "An internal error occurred. Please try again or contact support if the problem persists.";

/**
 * Strips internal fields (stack, raw context) from an ErrorEnvelope before
 * returning it to an MCP client.
 *
 * The stripped envelope is still machine-readable but does not expose
 * implementation details or stack traces.
 *
 * For INTERNAL_ERROR envelopes the raw message is also replaced with a
 * generic safe string, because plain Error messages can contain dependency
 * internals (connection strings, file paths, library error text) that must
 * not be forwarded to clients.  The original message is retained in the
 * server-side envelope for log consumers.
 */
export function toClientEnvelope(
  envelope: ErrorEnvelope,
): Omit<ErrorEnvelope, "stack" | "context"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stack: _stack, context: _context, ...client } = envelope;

  // Sanitise INTERNAL_ERROR: the raw message is safe to log server-side but
  // must not reach the client because it can leak framework or dependency detail.
  if (client.code === "INTERNAL_ERROR") {
    return { ...client, message: INTERNAL_ERROR_CLIENT_MESSAGE };
  }

  return client;
}
