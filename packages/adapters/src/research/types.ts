import type { ResearchArtifact } from "@dive-planner/domain";

export interface ResearchQuery {
  topic: string;
  destinationId?: string;
  operatorId?: string;
  limit?: number;
}

export interface ResearchResult {
  artifacts: ResearchArtifact[];
  providerName: string;
  warnings: string[];
}

export interface ResearchProvider {
  readonly providerName: string;
  research(query: ResearchQuery): Promise<ResearchResult>;
}
