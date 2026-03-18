/**
 * Result type for operations that can produce warnings or partial data
 * without raising an exception. Used extensively in tool responses.
 */

export interface SourceSummary {
  /** Human-readable description of the data source(s) used */
  sources: string[];
  /** ISO datetime when data was last fetched or normalized */
  freshness?: string;
}

export interface ServiceResult<T> {
  data: T;
  sourceSummary: SourceSummary;
  /** Non-fatal warnings: stale data, missing coverage, partial failures */
  warnings: string[];
}

export function ok<T>(
  data: T,
  sources: string[],
  warnings: string[] = [],
  freshness?: string
): ServiceResult<T> {
  return {
    data,
    sourceSummary: { sources, freshness },
    warnings,
  };
}
