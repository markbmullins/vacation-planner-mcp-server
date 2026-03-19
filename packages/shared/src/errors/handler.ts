/**
 * Process-level unhandled error handlers for MCP server and worker runtimes.
 *
 * Attaches listeners for:
 *   - `unhandledRejection` — a Promise was rejected with no .catch() handler
 *   - `uncaughtException`  — a synchronous throw reached the top of the call stack
 *
 * Both handlers:
 *   1. Build a structured ErrorEnvelope from the thrown value.
 *   2. Log the envelope at ERROR level (stderr) so log aggregators capture it.
 *   3. Exit the process with code 1 — unhandled errors are not recoverable.
 *
 * Usage (call once at process startup, before any async work):
 *   installGlobalErrorHandlers({ logger, runtime: "mcp-server" });
 *
 * Design notes:
 *   - These handlers are intentionally process-global because unhandled
 *     rejections can originate anywhere in the async graph.
 *   - The logger passed here should be the same instance used across the
 *     runtime so that the error log line has the same format.
 *   - Stack traces are included in the log payload but are never forwarded
 *     to MCP clients (see toClientEnvelope in envelope.ts).
 *   - We call process.exit(1) after logging rather than trying to recover,
 *     because an unhandled rejection may leave the process in an inconsistent
 *     state.  The orchestrator / PM2 / container runtime is responsible for
 *     restart logic.
 */

import type { Logger } from "../logging/logger.js";
import { buildErrorEnvelope } from "./envelope.js";

export interface GlobalErrorHandlerOptions {
  /** Logger instance to use for structured error output */
  logger: Logger;
  /** Runtime name for context in error log entries */
  runtime: string;
}

/**
 * Installs process-level handlers for unhandled Promise rejections and
 * uncaught exceptions.
 *
 * Should be called once at process startup, before any async work begins.
 */
export function installGlobalErrorHandlers(options: GlobalErrorHandlerOptions): void {
  const { logger, runtime } = options;

  // -------------------------------------------------------------------------
  // unhandledRejection
  // -------------------------------------------------------------------------

  process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
    const envelope = buildErrorEnvelope(reason, { includeStack: true });

    logger.error("Unhandled Promise rejection", {
      runtime,
      ...envelope,
      // Include the Promise object reference as a string for debugging.
      // We stringify it to avoid circular-reference issues during JSON serialisation.
      promise: String(promise),
    });

    // Give the logger a chance to flush before exiting.
    // In practice, process.stdout.write is synchronous for TTYs and files.
    process.exit(1);
  });

  // -------------------------------------------------------------------------
  // uncaughtException
  // -------------------------------------------------------------------------

  process.on("uncaughtException", (error: Error, origin: string) => {
    const envelope = buildErrorEnvelope(error, { includeStack: true });

    logger.error("Uncaught exception", {
      runtime,
      origin,
      ...envelope,
    });

    process.exit(1);
  });
}
