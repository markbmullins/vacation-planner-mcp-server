import type { CertificationLevel, ServiceResult } from "@dive-planner/shared";
import type { Destination } from "@dive-planner/domain";

export interface SearchDiveSitesParams {
  region?: string;
  month?: string;
  budgetUsd?: number;
  certificationLevel?: CertificationLevel;
  marineLife?: string[];
  tripLengthDays?: number;
  limit?: number;
}

export interface DestinationMatch {
  destination: Destination;
  certificationFit: "good" | "borderline" | "excluded";
  seasonalFit: "best" | "acceptable" | "avoid";
  indicativeCostRange?: { minUsd: number; maxUsd: number };
  whyItMatches: string[];
}

export interface SearchDiveSitesResult {
  matches: DestinationMatch[];
}

export interface DiveDiscoveryService {
  searchDiveSites(params: SearchDiveSitesParams): Promise<ServiceResult<SearchDiveSitesResult>>;
  getBestSeason(destinationId: string): Promise<ServiceResult<{ bestMonths: string[]; avoidMonths: string[]; rationale: string }>>;
}
