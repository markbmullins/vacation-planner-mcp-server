/**
 * Structured logger for the Dive Vacation Planner.
 *
 * Design decisions:
 *
 * 1. Output format is newline-delimited JSON (NDJSON) on stdout.
 *    Structured logs are parseable by all major log aggregators without
 *    a custom parser.  Errors go to stderr.
 *
 * 2. The logger automatically pulls the active correlation ID from the
 *    async context (see context.ts) and injects it into every log entry.
 *    Callers do not need to thread the ID through every function call.
 *
 * 3. Secrets are never logged.  The caller is responsible for not passing
 *    sensitive values in the `data` argument.  See packages/shared/config
 *    for redactConfig() / redactDsn() helpers.
 *
 * 4. Log level is controlled by the LOG_LEVEL environment variable (via
 *    AppConfig.server.logLevel).  The logger is created with a fixed level
 *    at startup; call createLogger() with the resolved config value.
 *
 * 5. The module exports a pre-configured default logger (level "info") for
 *    use before config is loaded.  Replace it with createLogger(config.server.logLevel)
 *    as soon as config is available.
 *
 * Log entry shape:
 * {
 *   "timestamp": "2026-04-12T14:00:00.000Z",
 *   "level": "info",
 *   "message": "human readable message",
 *   "correlationId": "...",   // injected from async context when available
 *   "contextType": "request", // "request" | "job" when in a context
 *   "jobId": "...",           // only present for job contexts
 *   "queueName": "...",       // only present for job contexts
 *   ...extra data fields
 * }
 */

import type { LogLevel } from "../config/index.js";
import { contextLogFields } from "./context.js";

// ---------------------------------------------------------------------------
// Log level ordering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// ---------------------------------------------------------------------------
// Log entry type
// ---------------------------------------------------------------------------

/** The shape of every log entry written to stdout/stderr */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  contextType?: string;
  jobId?: string;
  queueName?: string;
  jobName?: string;
  /** Any additional structured fields provided by the caller */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

/** A structured logger instance */
export interface Logger {
  /** Active log level — entries below this level are discarded */
  readonly level: LogLevel;

  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;

  /**
   * Creates a child logger that inherits this logger's level and always
   * includes the given `defaultData` fields in every log entry.
   *
   * Useful for component-scoped loggers:
   *   const log = logger.child({ component: "ItineraryService" });
   *   log.info("generating itinerary");
   *   // => { ..., component: "ItineraryService", message: "generating itinerary" }
   */
  child(defaultData: Record<string, unknown>): Logger;
}

// ---------------------------------------------------------------------------
// Internal write helpers
// ---------------------------------------------------------------------------

/**
 * Serialises a log entry to JSON and writes it to the appropriate stream.
 * Error-level entries go to stderr; all others go to stdout.
 *
 * We use process.stdout.write / process.stderr.write rather than console.*
 * to avoid the overhead of console's internal formatting and to ensure
 * synchronous writes (important for test assertions).
 */
function writeEntry(entry: LogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  if (entry.level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Logger instance with the given log level.
 *
 * @param level      Minimum level to emit.  Entries below this level are dropped.
 * @param defaultData Fields to include in every log entry (e.g. { runtime: "mcp-server" }).
 */
export function createLogger(
  level: LogLevel = "info",
  defaultData: Record<string, unknown> = {},
): Logger {
  const minOrder = LEVEL_ORDER[level];

  function log(
    entryLevel: LogLevel,
    message: string,
    data: Record<string, unknown> = {},
  ): void {
    if (LEVEL_ORDER[entryLevel] > minOrder) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message,
      // Pull correlation ID and other context fields automatically.
      // These are spread first so caller data can augment (but not
      // silently override) context fields.
      ...contextLogFields(),
      // Apply component-level defaults (e.g. { runtime: "mcp-server" }).
      ...defaultData,
      // Apply call-site data last so it has the highest precedence.
      ...data,
    };

    writeEntry(entry);
  }

  const logger: Logger = {
    level,

    error(message, data) { log("error", message, data); },
    warn(message, data)  { log("warn",  message, data); },
    info(message, data)  { log("info",  message, data); },
    debug(message, data) { log("debug", message, data); },

    child(childDefaultData) {
      return createLogger(level, { ...defaultData, ...childDefaultData });
    },
  };

  return logger;
}

// ---------------------------------------------------------------------------
// Default logger instance
// ---------------------------------------------------------------------------

/**
 * Pre-configured default logger at "info" level.
 *
 * Use this before AppConfig is loaded.  Once config is available, prefer:
 *   const logger = createLogger(config.server.logLevel, { runtime: "mcp-server" });
 *
 * The default logger is intentionally kept as a module-level singleton so
 * that it can be imported easily without dependency injection.
 */
export const logger: Logger = createLogger("info");
