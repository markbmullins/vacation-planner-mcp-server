import type { CertificationLevel, ServiceResult } from "@dive-planner/shared";
import type { DiveOperator, OperatorPriceSnapshot, OperatorRequirement } from "@dive-planner/domain";

export interface FindDiveOperatorsParams {
  destinationId: string;
  budgetPerDiveUsd?: number;
  certificationLevel?: CertificationLevel;
  limit?: number;
}

export interface OperatorSummary {
  operator: DiveOperator;
  latestPrices: OperatorPriceSnapshot[];
  requirements: OperatorRequirement | null;
  certificationFit: "good" | "borderline" | "excluded";
  recommendationNotes: string[];
}

export interface FindDiveOperatorsResult {
  operators: OperatorSummary[];
}

export interface OperatorResearchService {
  findDiveOperators(params: FindDiveOperatorsParams): Promise<ServiceResult<FindDiveOperatorsResult>>;
  crawlOperatorPrices(operatorId: string): Promise<ServiceResult<{ status: "cached" | "queued" | "done"; snapshot?: OperatorPriceSnapshot[] }>>;
}
