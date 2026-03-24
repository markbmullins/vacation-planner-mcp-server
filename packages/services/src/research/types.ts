import type { ServiceResult } from "@dive-planner/shared";
import type { ResearchArtifact } from "@dive-planner/domain";

export interface RedditResearchParams {
  topic: string;
  destinationId?: string;
  operatorId?: string;
}

export interface RedditResearchResult {
  artifacts: ResearchArtifact[];
  summary: string;
  topThemes: string[];
}

export interface ResearchService {
  redditDiveSiteResearch(params: RedditResearchParams): Promise<ServiceResult<RedditResearchResult>>;
  redditDiveShopResearch(params: RedditResearchParams): Promise<ServiceResult<RedditResearchResult>>;
  summarizeOpinions(destinationId?: string, operatorId?: string): Promise<ServiceResult<RedditResearchResult>>;
}
