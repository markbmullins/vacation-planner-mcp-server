export interface CrawlRequest {
  url: string;
  /** Optional CSS selector or extraction hint for structured content */
  extractionHint?: string;
  /** Maximum wait time in ms for dynamic content */
  timeoutMs?: number;
}

export interface CrawlResponse {
  url: string;
  rawContent: string;
  extractedStructured?: Record<string, unknown>;
  fetchedAt: string;
  durationMs: number;
  error?: string;
}

export interface CrawlAdapter {
  readonly adapterName: string;
  crawl(request: CrawlRequest): Promise<CrawlResponse>;
}
