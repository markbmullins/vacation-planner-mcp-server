import type { CurrencyCode, ServiceResult } from "@dive-planner/shared";
import type { CostEstimate } from "@dive-planner/domain";

export interface EstimateTripCostParams {
  tripRequestId: string;
  flightOptionId?: string;
  accommodationOptionId?: string;
  diveOperatorId?: string;
  tripLengthDays: number;
  currency?: CurrencyCode;
}

export interface EstimateTripCostResult {
  estimate: CostEstimate;
}

export interface CostEstimationService {
  estimateTripCost(params: EstimateTripCostParams): Promise<ServiceResult<EstimateTripCostResult>>;
}
