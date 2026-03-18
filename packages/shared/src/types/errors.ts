/**
 * Structured error types for the Dive Vacation Planner system.
 */

export type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "NO_RESULTS"
  | "PARTIAL_RESULTS"
  | "STALE_DATA"
  | "CONSTRAINT_VIOLATION"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.context = context;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("INVALID_INPUT", message, context);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("NOT_FOUND", message, context);
    this.name = "NotFoundError";
  }
}

export class SourceUnavailableError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("SOURCE_UNAVAILABLE", message, context);
    this.name = "SourceUnavailableError";
  }
}

export class ConstraintViolationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("CONSTRAINT_VIOLATION", message, context);
    this.name = "ConstraintViolationError";
  }
}
