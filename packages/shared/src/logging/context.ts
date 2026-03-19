/**
 * Async context store for request and job correlation IDs.
 *
 * Uses Node.js AsyncLocalStorage so any code that runs within a
 * request or job handler — including downstream service calls — can
 * read the active correlation ID without explicit argument threading.
 *
 * Usage (MCP request handler):
 *   runWithContext({ correlationId: generateId(), contextType: "request" }, () => {
 *     // All log calls within this callback include the correlationId automatically.
 *     doWork();
 *   });
 *
 * Usage (BullMQ job processor):
 *   runWithContext({ correlationId: job.id ?? generateId(), contextType: "job", jobId: job.id }, () => {
 *     // Job-specific context propagates through all downstream calls.
 *     processJob(job);
 *   });
 *
 * Reading context in any service:
 *   const ctx = getContext();
 *   // ctx?.correlationId is the active correlation ID, or undefined when
 *   // called outside of a tracked request/job.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context type distinguishes interactive MCP requests from background jobs */
export type ContextType = "request" | "job";

/** The active async context stored per request or job execution */
export interface RequestContext {
  /** Unique identifier for this request or job execution */
  correlationId: string;
  /** Whether this context belongs to an interactive request or a background job */
  contextType: ContextType;
  /**
   * BullMQ job ID — only present when contextType is "job".
   * Allows log consumers to correlate log lines with queue entries.
   */
  jobId?: string;
  /**
   * BullMQ queue name — only present when contextType is "job".
   */
  queueName?: string;
  /**
   * BullMQ job name (the job type / processor key).
   * Only present when contextType is "job".
   */
  jobName?: string;
  /**
   * Additional key/value metadata to include in log entries.
   * Useful for tool name, route, or other call-site context.
   */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Internal AsyncLocalStorage instance — module-scoped singleton */
const _store = new AsyncLocalStorage<RequestContext>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a new, random UUID-v4 correlation ID.
 *
 * Use this when a request or job does not already carry its own identifier.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Runs `fn` within a new async context that carries the given RequestContext.
 *
 * All code that runs synchronously or asynchronously inside `fn` (including
 * awaited Promises, event callbacks, and setTimeout handlers that are
 * registered within `fn`) will see the same context when they call
 * `getContext()`.
 *
 * @param context The context to activate for the duration of `fn`.
 * @param fn      The function to run inside the context.
 * @returns       The return value of `fn`.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return _store.run(context, fn);
}

/**
 * Returns the active RequestContext for the current async execution, or
 * `undefined` when called outside of a `runWithContext` scope.
 *
 * Services, repositories, and adapters can call this to pick up the
 * correlation ID without having to accept it as a parameter.
 */
export function getContext(): RequestContext | undefined {
  return _store.getStore();
}

/**
 * Returns the active correlation ID, or `undefined` when outside a context.
 *
 * This is the most commonly needed shortcut — most callers only need the ID.
 */
export function getCorrelationId(): string | undefined {
  return _store.getStore()?.correlationId;
}

/**
 * Builds a partial log record from the active context.
 *
 * Returns an object suitable for spreading into a log entry so that every
 * log line automatically carries the correlation ID and any meta fields.
 *
 * Example:
 *   logger.info("doing work", { ...contextLogFields(), component: "ItineraryService" });
 */
export function contextLogFields(): Record<string, unknown> {
  const ctx = _store.getStore();
  if (!ctx) return {};

  const fields: Record<string, unknown> = {
    correlationId: ctx.correlationId,
    contextType: ctx.contextType,
  };

  if (ctx.jobId !== undefined) fields["jobId"] = ctx.jobId;
  if (ctx.queueName !== undefined) fields["queueName"] = ctx.queueName;
  if (ctx.jobName !== undefined) fields["jobName"] = ctx.jobName;
  if (ctx.meta !== undefined) {
    for (const [k, v] of Object.entries(ctx.meta)) {
      fields[k] = v;
    }
  }

  return fields;
}
