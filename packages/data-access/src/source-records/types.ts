import type { ISODateTime } from "@dive-planner/shared";

export interface SourceRecord {
  id: string;
  sourceType: string;
  providerName: string;
  sourceUrl: string;
  externalId?: string;
  rawPayload: Record<string, unknown>;
  contentHash: string;
  fetchedAt: ISODateTime;
  expiresAt?: ISODateTime;
}

export interface CrawlJob {
  id: string;
  jobType: string;
  targetType: string;
  targetId?: string;
  targetUrl?: string;
  status: "queued" | "running" | "done" | "failed" | "dead_lettered";
  attemptCount: number;
  lastError?: string;
  queuedAt: ISODateTime;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
}

export interface ExtractionRun {
  id: string;
  sourceRecordId: string;
  extractorType: string;
  schemaVersion: string;
  status: "pending" | "success" | "failed";
  outputPayload: Record<string, unknown>;
  errorMessage?: string;
  createdAt: ISODateTime;
}
