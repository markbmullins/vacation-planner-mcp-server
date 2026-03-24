import type { ServiceResult } from "@dive-planner/shared";
import type { TripPlan } from "@dive-planner/domain";

export interface AssembleTripPlanParams {
  tripRequestId: string;
  destinationId: string;
  selectedOperatorId?: string;
  selectedFlightOptionId?: string;
  selectedAccommodationOptionId?: string;
  itineraryId: string;
  costEstimateId: string;
  rationale: string;
}

export interface AssembleTripPlanResult {
  plan: TripPlan;
}

export interface TripPlanService {
  assembleTripPlan(params: AssembleTripPlanParams): Promise<ServiceResult<AssembleTripPlanResult>>;
  getTripPlan(tripPlanId: string): Promise<ServiceResult<AssembleTripPlanResult>>;
}
